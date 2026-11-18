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

const RULE = {
  id: "rule-1",
  action: "block",
  description: "Block wp-login",
  filter: {
    id: "filter-1",
    expression: 'http.request.uri.path contains "/wp-login.php"',
    paused: false,
  },
  paused: false,
  priority: 50,
  products: ["waf"],
};

describe("CloudflareClient.listFirewallRules", () => {
  it("GETs custom rules entrypoint and filters locally", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "entrypoint", rules: [
            { id: "unrelated", action: "skip", expression: "true", description: "Other" },
            { id: "rule-1", action: "block", expression: 'http.request.uri.path contains "/wp-login.php"', description: "Block wp-login" },
          ] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const result = await client.listFirewallRules({ action: "block", paused: false });
      const url = new URL(capturedUrl);
      expect(url.pathname).toBe("/client/v4/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint");
      expect(url.search).toBe("");
      expect(result.rules.length).toBe(1);
      expect(result.rules[0]?.id).toBe("rule-1");
      expect(result.resultInfo?.total_count).toBe(1);
      expect(result).toMatchObject({ scope: "zone", zoneId: "zone-1", phase: "http_request_firewall_custom", status: "present", rulesetId: "entrypoint", truncated: false });
      expect(result.rules[0]).toMatchObject({ order: 2, enabled: true, paused: false, expression: 'http.request.uri.path contains "/wp-login.php"' });
      expect(result.rules[0]).not.toHaveProperty("priority");
    } finally {
      restore();
    }
  });

  it("keeps native order through local filters and numeric paging", async () => {
    const nativeRules = [
      { id: "first", action: "skip", expression: "true", description: "Skip bots", enabled: false, action_parameters: { ruleset: "current" } },
      { id: "second", action: "execute", expression: "true", description: "Execute managed" },
      { id: "third", action: "skip", expression: "true", description: "SKIP API", enabled: false, action_parameters: { phases: ["http_ratelimit"] } },
    ];
    const restore = mockFetch(() => new Response(envelope({ id: "entrypoint", rules: nativeRules })));
    try {
      const result = await new CloudflareClient(tokenConfig({ zoneId: "zone-1" })).listFirewallRules({ action: "skip", description: "skip", paused: true, page: 2, perPage: 1 });
      expect(result.rules).toMatchObject([{ id: "third", order: 3, paused: true, enabled: false, filter: { expression: "true" }, action_parameters: { phases: ["http_ratelimit"] } }]);
      expect(result.resultInfo).toEqual({ page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 });
      expect(result.truncated).toBe(false);
      const first = await new CloudflareClient(tokenConfig({ zoneId: "zone-1" })).listFirewallRules({ action: "skip", page: 1, perPage: 1 });
      expect(first.truncated).toBe(true);
      const beyond = await new CloudflareClient(tokenConfig({ zoneId: "zone-1" })).listFirewallRules({ action: "skip", page: 3, perPage: 1 });
      expect(beyond.truncated).toBe(false);
    } finally { restore(); }
  });

  it("returns explicit absence metadata instead of conflating absent and empty", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: "entrypoint missing" }], result: null }), { status: 404 }));
    try {
      const result = await new CloudflareClient(tokenConfig({ zoneId: "zone-1" })).listFirewallRules();
      expect(result).toMatchObject({ rules: [], scope: "zone", zoneId: "zone-1", status: "absent", diagnostic: { statusCode: 404 }, truncated: false });
    } finally { restore(); }
  });
});

describe("CloudflareClient.getFirewallRule", () => {
  it("GETs a single rule", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(envelope({ id: "entrypoint", rules: [{ id: "rule-1", action: "block", expression: 'http.request.uri.path contains "/wp-login.php"', enabled: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.getFirewallRule("rule-1");
      expect(capturedUrl).toContain("/zones/zone-1/rulesets/phases/http_request_firewall_custom/entrypoint");
      expect(rule.filter?.expression).toContain("wp-login");
      expect(rule).toMatchObject({ order: 1, paused: true, enabled: false, scope: "zone", zoneId: "zone-1", phase: "http_request_firewall_custom", rulesetId: "entrypoint" });
    } finally {
      restore();
    }
  });

  it("matches IDs locally and rejects missing IDs", async () => {
    const restore = mockFetch(() => new Response(envelope({ id: "entrypoint", rules: [{ id: "second", action: "execute", expression: "true" }] })));
    try {
      const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
      expect((await client.getFirewallRule("second")).action).toBe("execute");
      await expect(client.getFirewallRule("missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally { restore(); }
  });

  it("redacts secrets from WAF action parameters", async () => {
    const restore = mockFetch(() => new Response(envelope({ id: "entrypoint", rules: [{ id: "secret", action: "skip", expression: "true", action_parameters: { password: "hidden", origin: { host: "origin.example.com" } } }] })));
    try {
      const rule = await new CloudflareClient(tokenConfig({ zoneId: "zone-1" })).getFirewallRule("secret");
      expect(JSON.stringify(rule)).not.toContain("hidden");
      expect(JSON.stringify(rule)).toContain("origin.example.com");
    } finally { restore(); }
  });
});

describe("CloudflareClient.createFirewallRule", () => {
  it("POSTs the rule with the expression wrapped in a filter", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedBody = "";
    const restore = mockFetch((_input, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(envelope(RULE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.createFirewallRule({
        expression: 'ip.src.country eq "CN"',
        action: "managed_challenge",
        description: "Challenge CN",
      });
      expect(JSON.parse(capturedBody)).toEqual({
        action: "managed_challenge",
        description: "Challenge CN",
        filter: { expression: 'ip.src.country eq "CN"' },
      });
      expect(rule.id).toBe("rule-1");
    } finally {
      restore();
    }
  });

  it("rejects an invalid action locally", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    await expect(
      client.createFirewallRule({
        // @ts-expect-error deliberately invalid
        expression: "true",
        action: "deny",
      })
    ).rejects.toThrow();
    await expect(client.createFirewallRule({ expression: "true", action: "skip" as never })).rejects.toThrow();
    await expect(client.updateFirewallRule("rule-1", { expression: "true", action: "execute" as never })).rejects.toThrow();
  });
});

describe("CloudflareClient.updateFirewallRule", () => {
  it("PUTs the rule id and filter expression", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(envelope({ ...RULE, paused: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.updateFirewallRule("rule-1", {
        expression: 'ip.src.country eq "RU"',
        action: "block",
        paused: true,
      });
      expect(capturedMethod).toBe("PUT");
      expect(capturedUrl).toContain("/zones/zone-1/firewall/rules/rule-1");
      expect(JSON.parse(capturedBody)).toEqual({
        id: "rule-1",
        action: "block",
        paused: true,
        filter: { expression: 'ip.src.country eq "RU"' },
      });
      expect(rule.paused).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.deleteFirewallRule", () => {
  it("DELETEs the rule", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    const restore = mockFetch((input, init) => {
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      return new Response(envelope({ id: "rule-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await client.deleteFirewallRule("rule-1");
      expect(capturedMethod).toBe("DELETE");
      expect(capturedUrl).toContain("/zones/zone-1/firewall/rules/rule-1");
    } finally {
      restore();
    }
  });

  it("propagates API failures as CloudflareError", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    const restore = mockFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10001, message: "firewallrules.api.firewall_rule_not_exists" }],
          messages: [],
          result: null,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await expect(client.deleteFirewallRule("missing")).rejects.toBeInstanceOf(
        CloudflareError
      );
    } finally {
      restore();
    }
  });
});
