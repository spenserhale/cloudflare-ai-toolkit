import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { registerRegistrarTools } from "./registrar.js";

function getTool(name: string): any {
  let tool: any;
  registerRegistrarTools({
    addTool: (candidate: any) => {
      if (candidate.name === name) tool = candidate;
    },
  } as Parameters<typeof registerRegistrarTools>[0]);
  return tool;
}

const CHECK = {
  domains: [
    {
      name: "acmecorp.com",
      registrable: true,
      tier: "standard",
      pricing: { currency: "USD", registration_cost: "10.46", renewal_cost: "10.46" },
    },
  ],
};

const WORKFLOW = {
  state: "succeeded",
  completed: true,
  created_at: "2026-11-09T20:31:50Z",
  updated_at: "2026-11-09T20:31:51Z",
  context: { domain_name: "acmecorp.com" },
  error: null,
  links: { self: "/accounts/acc-1/registrar/registrations/acmecorp.com/registration-status" },
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[] = [];
let originalFetch: typeof fetch;
const originalEnv = { ...process.env };

function respondWith(check: unknown = CHECK) {
  globalThis.fetch = (async (input: unknown, init: RequestInit) => {
    const path = new URL(String(input)).pathname;
    calls.push({
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const result = path.endsWith("/domain-check") ? check : WORKFLOW;
    return Response.json({ success: true, errors: [], messages: [], result });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  originalFetch = globalThis.fetch;
  process.env.CLOUDFLARE_API_TOKEN = "test-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acc-1";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe("register_domain", () => {
  it("is marked destructive and requires a price ceiling", () => {
    const tool = getTool("register_domain");
    expect(tool.annotations.destructiveHint).toBe(true);
    expect(() => tool.parameters.parse({ domainName: "acmecorp.com", currency: "USD" })).toThrow();
  });

  it("re-checks, then registers when the live price is within the approved ceiling", async () => {
    respondWith();
    const tool = getTool("register_domain");
    const args = tool.parameters.parse({
      domainName: "AcmeCorp.com",
      maxRegistrationCost: "10.46",
      currency: "usd",
      sandbox: true,
    });
    const result = JSON.parse(await tool.execute(args));

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /client/v4/accounts/acc-1/registrar-sandbox/domain-check",
      "POST /client/v4/accounts/acc-1/registrar-sandbox/registrations",
    ]);
    expect(calls[1]!.body).toEqual({ domain_name: "acmecorp.com" });
    expect(result).toMatchObject({
      registered: true,
      sandbox: true,
      status: { state: "succeeded", domain_name: "acmecorp.com" },
    });
  });

  it("refuses without registering when the live price exceeds the ceiling", async () => {
    respondWith();
    const tool = getTool("register_domain");
    const args = tool.parameters.parse({
      domainName: "acmecorp.com",
      maxRegistrationCost: "9.99",
      currency: "USD",
    });
    const result = JSON.parse(await tool.execute(args));

    expect(result).toMatchObject({ registered: false, refused: "price_above_limit" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toEndWith("/registrar/domain-check");
  });

  it("refuses an unavailable domain", async () => {
    respondWith({
      domains: [{ name: "acmecorp.com", registrable: false, reason: "domain_unavailable" }],
    });
    const tool = getTool("register_domain");
    const args = tool.parameters.parse({
      domainName: "acmecorp.com",
      maxRegistrationCost: "100",
      currency: "USD",
    });
    const result = JSON.parse(await tool.execute(args));
    expect(result).toMatchObject({ registered: false, refused: "domain_unavailable" });
    expect(calls).toHaveLength(1);
  });
});

describe("read-only registrar tools", () => {
  it("are annotated read-only", () => {
    for (const name of [
      "search_domains",
      "check_domains",
      "get_domain_registration_status",
      "get_domain_registration",
      "list_domain_registrations",
    ]) {
      expect(getTool(name).annotations.readOnlyHint).toBe(true);
    }
  });
});
