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
  it("GETs firewall rules with filters", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [RULE],
          result_info: { page: 1, per_page: 25, count: 1, total_count: 1, total_pages: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const result = await client.listFirewallRules({ action: "block", paused: false });
      const url = new URL(capturedUrl);
      expect(url.pathname).toBe("/client/v4/zones/zone-1/firewall/rules");
      expect(url.searchParams.get("action")).toBe("block");
      expect(url.searchParams.get("paused")).toBe("false");
      expect(result.rules.length).toBe(1);
      expect(result.rules[0]?.id).toBe("rule-1");
      expect(result.resultInfo?.total_count).toBe(1);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getFirewallRule", () => {
  it("GETs a single rule", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(envelope(RULE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const rule = await client.getFirewallRule("rule-1");
      expect(capturedUrl).toContain("/zones/zone-1/firewall/rules/rule-1");
      expect(rule.filter?.expression).toContain("wp-login");
    } finally {
      restore();
    }
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
