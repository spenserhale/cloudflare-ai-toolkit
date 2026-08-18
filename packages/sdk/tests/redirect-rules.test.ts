import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";

function tokenConfig(overrides: Partial<{ accountId: string; zoneId: string }> = {}) {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
    ...overrides,
  };
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function envelope(result: unknown) {
  return JSON.stringify({ success: true, errors: [], messages: [], result });
}

function notFound() {
  return new Response(
    JSON.stringify({
      success: false,
      errors: [{ code: 10001, message: "ruleset not found" }],
      messages: [],
      result: null,
    }),
    { status: 404, headers: { "Content-Type": "application/json" } }
  );
}

const RULESET = {
  id: "rs-1",
  name: "Zone-level dynamic redirect ruleset",
  kind: "zone",
  phase: "http_request_dynamic_redirect",
  version: "8",
  last_updated: "2026-08-01T00:00:00Z",
  rules: [
    {
      id: "rule-1",
      action: "redirect",
      expression: 'http.request.uri.path eq "/old"',
      description: "Move /old",
      enabled: true,
      action_parameters: {
        from_value: {
          target_url: { value: "https://example.com/new" },
          status_code: 301,
          preserve_query_string: false,
        },
      },
    },
  ],
};

describe("CloudflareClient.listRedirectRules", () => {
  it("returns rules from the phase entrypoint", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(envelope(RULESET), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const result = await client.listRedirectRules();
      expect(capturedUrl).toContain(
        "/zones/zone-1/rulesets/phases/http_request_dynamic_redirect/entrypoint"
      );
      expect(result.rulesetId).toBe("rs-1");
      expect(result.rules.length).toBe(1);
      expect(result.rules[0]?.action_parameters?.from_value?.status_code).toBe(301);
    } finally {
      restore();
    }
  });

  it("returns an empty list when no entrypoint ruleset exists (404)", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    const restore = mockFetch(() => notFound());

    try {
      const result = await client.listRedirectRules();
      expect(result).toEqual({ rules: [] });
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getRedirectRule", () => {
  it("finds a rule by id", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    const restore = mockFetch(() =>
      new Response(envelope(RULESET), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    try {
      const rule = await client.getRedirectRule("rule-1");
      expect(rule.expression).toBe('http.request.uri.path eq "/old"');
    } finally {
      restore();
    }
  });

  it("throws NOT_FOUND for an unknown rule", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    const restore = mockFetch(() =>
      new Response(envelope(RULESET), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    try {
      await expect(client.getRedirectRule("missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.createRedirectRule", () => {
  it("POSTs to the entrypoint ruleset with a nested from_value", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      const url = String(input);
      if (url.includes("entrypoint")) {
        return new Response(envelope(RULESET), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      capturedUrl = url;
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(envelope(RULESET.rules[0]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.createRedirectRule({
        expression: 'http.request.uri.path eq "/old"',
        targetUrl: "https://example.com/new",
        statusCode: 301,
      });
      expect(capturedUrl).toContain("/zones/zone-1/rulesets/rs-1/rules");
      expect(JSON.parse(capturedBody)).toEqual({
        action: "redirect",
        expression: 'http.request.uri.path eq "/old"',
        description: undefined,
        enabled: true,
        action_parameters: {
          from_value: {
            target_url: { value: "https://example.com/new" },
            status_code: 301,
            preserve_query_string: undefined,
          },
        },
      });
      expect(rule.id).toBe("rule-1");
    } finally {
      restore();
    }
  });

  it("creates the entrypoint via PUT when none exists", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    const calls: { method: string; url: string; body: string }[] = [];
    const restore = mockFetch((input, init) => {
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (calls.length === 1) return notFound();
      return new Response(envelope(RULESET), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.createRedirectRule({
        expression: "true",
        targetUrl: "https://example.com",
      });
      expect(calls.length).toBe(2);
      expect(calls[1]?.method).toBe("PUT");
      expect(calls[1]?.url).toContain(
        "/rulesets/phases/http_request_dynamic_redirect/entrypoint"
      );
      const body = JSON.parse(calls[1]?.body ?? "{}");
      expect(body.rules[0].action).toBe("redirect");
      expect(rule.id).toBe("rule-1");
    } finally {
      restore();
    }
  });

  it("passes dry_run and returns the built rule when the result is null", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      const url = String(input);
      if (url.includes("entrypoint")) {
        return new Response(envelope(RULESET), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      capturedUrl = url;
      return new Response(envelope(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.createRedirectRule({
        expression: "true",
        targetUrl: "https://example.com",
        dryRun: true,
      });
      expect(capturedUrl).toContain("dry_run=true");
      expect(rule.id).toBeUndefined();
      expect(rule.action).toBe("redirect");
    } finally {
      restore();
    }
  });

  it("rejects params missing both target fields", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    await expect(
      client.createRedirectRule({ expression: "true" })
    ).rejects.toThrow(/targetUrl/u);
  });
});

describe("CloudflareClient.updateRedirectRule", () => {
  it("merges action params with the current rule on PATCH", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      const url = String(input);
      if (url.includes("entrypoint")) {
        return new Response(envelope(RULESET), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      capturedMethod = init?.method ?? "";
      capturedUrl = url;
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        envelope({
          ...RULESET.rules[0],
          action_parameters: {
            from_value: {
              target_url: { value: "https://example.com/new" },
              status_code: 302,
              preserve_query_string: false,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const rule = await client.updateRedirectRule("rule-1", { statusCode: 302 });
      expect(capturedMethod).toBe("PATCH");
      expect(capturedUrl).toContain("/zones/zone-1/rulesets/rs-1/rules/rule-1");
      // target_url carried over from the current rule; status_code replaced
      expect(JSON.parse(capturedBody)).toEqual({
        action_parameters: {
          from_value: {
            target_url: { value: "https://example.com/new" },
            status_code: 302,
            preserve_query_string: false,
          },
        },
      });
      expect(rule.action_parameters?.from_value?.status_code).toBe(302);
    } finally {
      restore();
    }
  });

  it("sends only plain fields when no action fields change", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      if (String(input).includes("entrypoint")) {
        return new Response(envelope(RULESET), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(envelope(RULESET.rules[0]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await client.updateRedirectRule("rule-1", { enabled: false });
      expect(JSON.parse(capturedBody)).toEqual({ enabled: false });
    } finally {
      restore();
    }
  });

  it("throws NOT_FOUND when no ruleset exists", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    const restore = mockFetch(() => notFound());

    try {
      await expect(
        client.updateRedirectRule("rule-1", { enabled: false })
      ).rejects.toBeInstanceOf(CloudflareError);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.deleteRedirectRule", () => {
  it("DELETEs via the entrypoint ruleset", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    const restore = mockFetch((input, init) => {
      if (String(input).includes("entrypoint")) {
        return new Response(envelope(RULESET), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      return new Response(envelope({ id: "rule-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await client.deleteRedirectRule("rule-1");
      expect(capturedMethod).toBe("DELETE");
      expect(capturedUrl).toContain("/zones/zone-1/rulesets/rs-1/rules/rule-1");
    } finally {
      restore();
    }
  });
});
