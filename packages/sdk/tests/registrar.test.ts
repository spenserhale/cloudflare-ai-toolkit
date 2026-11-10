import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";
import {
  assessRegistration,
  parsePriceMicros,
  prepareDomainRegistration,
  waitForRegistration,
} from "../src/registrar.js";
import type { RegistrationWorkflowStatus } from "../src/types.js";

function tokenConfig() {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
    accountId: "acc-1",
  };
}

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(respond: (captured: Captured) => Response) {
  const calls: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const captured: Captured = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(captured);
    return respond(captured);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function envelope(result: unknown, status = 200, resultInfo?: unknown): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], messages: [], result, result_info: resultInfo }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

const AVAILABLE = {
  name: "acmecorp.dev",
  registrable: true,
  tier: "standard",
  pricing: { currency: "USD", registration_cost: "10.11", renewal_cost: "10.11" },
};

const SUCCEEDED: RegistrationWorkflowStatus = {
  domain_name: "acmecorp.dev",
  state: "succeeded",
  completed: true,
  created_at: "2026-11-09T10:00:00Z",
  updated_at: "2026-11-09T10:00:03Z",
  context: {
    registration: {
      domain_name: "acmecorp.dev",
      status: "active",
      expires_at: "2027-11-09T10:00:00Z",
      auto_renew: false,
      privacy_mode: "redaction",
      locked: true,
    },
  },
  links: {
    self: "/accounts/acc-1/registrar/registrations/acmecorp.dev/registration-status",
    resource: "/accounts/acc-1/registrar/registrations/acmecorp.dev",
  },
};

describe("CloudflareClient registrar requests", () => {
  it("searchDomains sends q, repeated extensions, and limit", async () => {
    const mock = mockFetch(() => envelope({ domains: [AVAILABLE] }));
    try {
      const client = new CloudflareClient(tokenConfig());
      const result = await client.searchDomains({
        query: "acme corp",
        extensions: ["dev", "com"],
        limit: 5,
      });
      expect(result.domains[0]?.name).toBe("acmecorp.dev");
      const url = new URL(mock.calls[0]!.url);
      expect(url.pathname).toBe("/client/v4/accounts/acc-1/registrar/domain-search");
      expect(url.searchParams.get("q")).toBe("acme corp");
      expect(url.searchParams.getAll("extensions")).toEqual(["dev", "com"]);
      expect(url.searchParams.get("limit")).toBe("5");
    } finally {
      mock.restore();
    }
  });

  it("checkDomains posts the domain list and keeps the reason field", async () => {
    const mock = mockFetch(() =>
      envelope({
        domains: [{ name: "foo.sh", registrable: false, tier: "standard", reason: "extension_not_supported_via_api" }],
      })
    );
    try {
      const client = new CloudflareClient(tokenConfig());
      const result = await client.checkDomains({ domains: ["foo.sh"] });
      expect(mock.calls[0]!.method).toBe("POST");
      expect(mock.calls[0]!.body).toEqual({ domains: ["foo.sh"] });
      expect(result.domains[0]?.reason).toBe("extension_not_supported_via_api");
    } finally {
      mock.restore();
    }
  });

  it("checkDomains rejects more than 20 domains before calling the API", async () => {
    const client = new CloudflareClient(tokenConfig());
    const domains = Array.from({ length: 21 }, (_, i) => `d${i}.com`);
    await expect(client.checkDomains({ domains })).rejects.toThrow();
  });

  it("sandbox routes to /registrar-sandbox", async () => {
    const mock = mockFetch(() => envelope({ domains: [] }));
    try {
      const client = new CloudflareClient(tokenConfig());
      await client.checkDomains({ domains: ["acmecorp.dev"], sandbox: true });
      expect(new URL(mock.calls[0]!.url).pathname).toBe(
        "/client/v4/accounts/acc-1/registrar-sandbox/domain-check"
      );
    } finally {
      mock.restore();
    }
  });

  it("registerDomain maps camelCase params to the snake_case body", async () => {
    const mock = mockFetch(() => envelope(SUCCEEDED, 201));
    try {
      const client = new CloudflareClient(tokenConfig());
      const status = await client.registerDomain({
        domainName: "acmecorp.dev",
        years: 2,
        autoRenew: true,
        privacyMode: "off",
      });
      expect(status.state).toBe("succeeded");
      expect(mock.calls[0]!.body).toEqual({
        domain_name: "acmecorp.dev",
        years: 2,
        auto_renew: true,
        privacy_mode: "off",
      });
      expect(mock.calls[0]!.headers.Prefer).toBeUndefined();
    } finally {
      mock.restore();
    }
  });

  it("registerDomain sends Prefer: respond-async and accepts a 202 in-progress result", async () => {
    const inProgress = { ...SUCCEEDED, state: "in_progress", completed: false, context: undefined };
    delete (inProgress as { domain_name?: string }).domain_name;
    const mock = mockFetch(() => envelope(inProgress, 202));
    try {
      const client = new CloudflareClient(tokenConfig());
      const status = await client.registerDomain({ domainName: "acmecorp.dev", respondAsync: true });
      expect(mock.calls[0]!.headers.Prefer).toBe("respond-async");
      expect(status.completed).toBe(false);
      // The formal schema omits domain_name; the client fills it from the request.
      expect(status.domain_name).toBe("acmecorp.dev");
    } finally {
      mock.restore();
    }
  });

  it("lifts context.domain_name, where the live API puts it, to the top level", async () => {
    const live = { state: "succeeded", completed: true, context: { domain_name: "live.com" }, links: { self: "/x" } };
    const mock = mockFetch(() => envelope(live));
    try {
      const client = new CloudflareClient(tokenConfig());
      const status = await client.getRegistrationStatus("requested.com");
      expect(status.domain_name).toBe("live.com");
    } finally {
      mock.restore();
    }
  });

  it("registerDomain surfaces API errors as CloudflareError", async () => {
    const mock = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10001, message: "No default registrant contact" }],
            messages: [],
            result: null,
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
    );
    try {
      const client = new CloudflareClient(tokenConfig());
      const err = await client.registerDomain({ domainName: "acmecorp.dev" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CloudflareError);
      expect((err as CloudflareError).message).toBe("No default registrant contact");
    } finally {
      mock.restore();
    }
  });

  it("listRegistrations returns the next cursor, and none on the last page", async () => {
    const registration = SUCCEEDED.context!.registration!;
    const mock = mockFetch((captured) =>
      new URL(captured.url).searchParams.get("cursor") === "abc"
        ? envelope([], 200, { cursor: "", per_page: 1, count: 0 })
        : envelope([registration], 200, { cursor: "abc", per_page: 1, count: 1 })
    );
    try {
      const client = new CloudflareClient(tokenConfig());
      const first = await client.listRegistrations({ perPage: 1, sortBy: "name" });
      expect(first.registrations).toHaveLength(1);
      expect(first.nextCursor).toBe("abc");
      const url = new URL(mock.calls[0]!.url);
      expect(url.searchParams.get("per_page")).toBe("1");
      expect(url.searchParams.get("sort_by")).toBe("name");

      const second = await client.listRegistrations({ cursor: "abc" });
      expect(second.nextCursor).toBeUndefined();
    } finally {
      mock.restore();
    }
  });

  it("getRegistrationStatus and getRegistration hit the per-domain paths", async () => {
    const mock = mockFetch((captured) =>
      captured.url.endsWith("/registration-status")
        ? envelope(SUCCEEDED)
        : envelope(SUCCEEDED.context!.registration)
    );
    try {
      const client = new CloudflareClient(tokenConfig());
      await client.getRegistrationStatus("acmecorp.dev");
      const reg = await client.getRegistration("acmecorp.dev");
      expect(reg.status).toBe("active");
      expect(new URL(mock.calls[0]!.url).pathname).toBe(
        "/client/v4/accounts/acc-1/registrar/registrations/acmecorp.dev/registration-status"
      );
      expect(new URL(mock.calls[1]!.url).pathname).toBe(
        "/client/v4/accounts/acc-1/registrar/registrations/acmecorp.dev"
      );
    } finally {
      mock.restore();
    }
  });
});

describe("parsePriceMicros", () => {
  it("parses plain decimals exactly", () => {
    expect(parsePriceMicros("8.50")).toBe(8_500_000n);
    expect(parsePriceMicros("10")).toBe(10_000_000n);
    expect(parsePriceMicros("0.1")).toBe(100_000n);
  });

  it("rejects non-decimal input", () => {
    expect(parsePriceMicros("-1")).toBeUndefined();
    expect(parsePriceMicros("$10")).toBeUndefined();
    expect(parsePriceMicros("1e3")).toBeUndefined();
    expect(parsePriceMicros("")).toBeUndefined();
  });
});

describe("assessRegistration", () => {
  it("accepts a registrable standard domain within the limit", () => {
    const result = assessRegistration("acmecorp.dev", AVAILABLE, { maxRegistrationCost: "10.11" });
    expect(result.ok).toBe(true);
  });

  it("refuses when the price is above the limit", () => {
    const result = assessRegistration("acmecorp.dev", AVAILABLE, { maxRegistrationCost: "10.10" });
    expect(result).toMatchObject({ ok: false, code: "price_above_limit" });
  });

  it("refuses an unregistrable domain with Cloudflare's reason", () => {
    const result = assessRegistration("google.com", {
      name: "google.com",
      registrable: false,
      reason: "domain_unavailable",
    });
    expect(result).toMatchObject({ ok: false, code: "domain_unavailable" });
  });

  it("refuses premium domains even when registrable", () => {
    const result = assessRegistration("x.dev", { ...AVAILABLE, name: "x.dev", tier: "premium" });
    expect(result).toMatchObject({ ok: false, code: "domain_premium" });
  });

  it("refuses when no price is returned", () => {
    const { pricing: _pricing, ...noPrice } = AVAILABLE;
    expect(assessRegistration("acmecorp.dev", noPrice)).toMatchObject({ ok: false, code: "price_unknown" });
  });

  it("refuses a currency mismatch and an unparseable limit", () => {
    expect(assessRegistration("acmecorp.dev", AVAILABLE, { currency: "EUR" })).toMatchObject({
      ok: false,
      code: "currency_mismatch",
    });
    expect(
      assessRegistration("acmecorp.dev", AVAILABLE, { maxRegistrationCost: "ten" })
    ).toMatchObject({ ok: false, code: "invalid_price_limit" });
  });
});

describe("prepareDomainRegistration", () => {
  it("checks the normalized domain and assesses the matching entry", async () => {
    let requested: string[] = [];
    const client = {
      checkDomains: async (params: { domains: string[] }) => {
        requested = params.domains;
        return { domains: [AVAILABLE] };
      },
    };
    const result = await prepareDomainRegistration(client, " AcmeCorp.dev ");
    expect(requested).toEqual(["acmecorp.dev"]);
    expect(result.ok).toBe(true);
  });
});

describe("waitForRegistration", () => {
  it("polls until a terminal state without re-submitting", async () => {
    const states = ["pending", "in_progress", "succeeded"];
    let polls = 0;
    const client = {
      getRegistrationStatus: async () => {
        const state = states[Math.min(polls, states.length - 1)]!;
        polls += 1;
        return { ...SUCCEEDED, state, completed: state === "succeeded" };
      },
    };
    const result = await waitForRegistration(client, "acmecorp.dev", { sleep: async () => {} });
    expect(result.timedOut).toBe(false);
    expect(result.status.state).toBe("succeeded");
    expect(polls).toBe(3);
  });

  it("stops on action_required", async () => {
    const client = {
      getRegistrationStatus: async () => ({ ...SUCCEEDED, state: "action_required", completed: false }),
    };
    const result = await waitForRegistration(client, "acmecorp.dev", { sleep: async () => {} });
    expect(result).toMatchObject({ timedOut: false, status: { state: "action_required" } });
  });

  it("reports a timeout while the workflow is still running", async () => {
    let clock = 0;
    const client = {
      getRegistrationStatus: async () => ({ ...SUCCEEDED, state: "in_progress", completed: false }),
    };
    const result = await waitForRegistration(client, "acmecorp.dev", {
      intervalMs: 1_000,
      timeoutMs: 2_500,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    expect(result.timedOut).toBe(true);
    expect(result.status.state).toBe("in_progress");
  });
});
