import { describe, expect, it } from "bun:test";
import { CloudflareClient, CloudflareError, describeError } from "../src/index.js";
import * as sdk from "../src/index.js";

function client(defaults: { zoneId?: string; accountId?: string } = { zoneId: "zone-1", accountId: "account-1" }) {
  return new CloudflareClient({ auth: { type: "apiToken", token: "test-token" }, baseUrl: "https://api.example.com", ...defaults });
}

function response(result: unknown, resultInfo?: unknown) {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...(resultInfo === undefined ? {} : { result_info: resultInfo }) }));
}

async function withFetch<T>(handler: (url: URL, init?: RequestInit) => Response, work: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => handler(new URL(String(input)), init)) as typeof fetch;
  try { return await work(); } finally { globalThis.fetch = original; }
}

const RULESET = {
  id: "rs-1", name: "Origin rules", kind: "zone", phase: "http_request_origin", version: "7",
  rules: [
    { id: "origin-1", action: "route", expression: "true", description: "Origin", action_parameters: { origin: { host: "origin.example.com", port: 8443 }, host_header: "example.com", future_parameter: { enabled: true } } },
    { id: "execute-1", action: "execute", enabled: false, action_parameters: { id: "managed-1", version: "3", overrides: { rules: [{ id: "managed-rule", enabled: false, action: "log" }], categories: [{ category: "wordpress", action: "block" }] } } },
  ],
};

describe("migration inventory final review regressions", () => {
  it.each(["Zone not found", "Account does not exist", "ruleset not found"])("keeps unrelated or ambiguous 404 as a failed read: %s", async (message) => {
    await withFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message }], result: null }), { status: 404 }), async () => {
      await expect(client().inventory.getPhaseEntrypoint("http_request_origin", { scope: "zone" })).rejects.toMatchObject({ statusCode: 404, message });
    });
  });

  it.each([{ page: 1, total_pages: 2 }, { total_pages: 2 }, { count: 2 }])("never silently completes known incomplete pagination: %j", async (info) => {
    await withFetch(() => response([{ id: "one" }], info), async () => {
      expect((await client().inventory.listRulesets({ scope: "zone" })).truncated).toBe(true);
      await expect(client().inventory.listRulesets({ scope: "zone" }, { all: true })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    });
  });

  it.each([
    'http.request.headers["x-api-key"][0] eq "origin-shared-key"',
    'any(http.request.headers["authorization"][*] == "Bearer origin-shared-key")',
    'http.request.cookies["wordpress_logged_in"][0] eq "origin-shared-key"',
    'http.request.uri.args["access_token"][0] eq "origin-shared-key"',
    'http.request.uri.query contains "access_token=origin-shared-key"',
  ])("redacts credential-bearing expressions through Rulesets and WAF reads: %s", async (expression) => {
    const ruleset = { ...RULESET, phase: "http_request_firewall_custom", rules: [{ id: "secret-rule", action: "block", expression }] };
    await withFetch(() => response(ruleset), async () => {
      const native = await client().inventory.getPhaseEntrypoint("http_request_firewall_custom", { scope: "zone" });
      const list = await client().listFirewallRules();
      const rule = await client().getFirewallRule("secret-rule");
      for (const result of [native, list, rule]) {
        expect(JSON.stringify(result)).not.toContain("origin-shared-key");
        expect(JSON.stringify(result)).toContain("[REDACTED]");
      }
    });
  });
});

describe("migration inventory rulesets", () => {
  it("exports the reader and exposes it on the client", () => {
    expect(sdk.InventoryReader).toBeFunction();
    expect(client().inventory).toBeInstanceOf(sdk.InventoryReader);
  });

  it("lists metadata with explicit scope, default size 50 and continuation", async () => {
    await withFetch((url, init) => {
      expect(init?.method).toBe("GET");
      expect(url.pathname).toBe("/client/v4/zones/zone-1/rulesets");
      expect(url.searchParams.get("per_page")).toBe("50");
      expect(url.searchParams.has("account_id")).toBe(false);
      return response([{ id: "rs-1", phase: "http_request_origin", future_metadata: true }], { cursors: { after: "next" } });
    }, async () => {
      const result = await client().inventory.listRulesets({ scope: "zone" });
      expect(result).toMatchObject({ scope: "zone", zoneId: "zone-1", rulesets: [{ id: "rs-1", future_metadata: true }], resultInfo: { cursors: { after: "next" } }, truncated: true });
      expect(result).not.toHaveProperty("accountId");
    });
  });

  it("follows cursors for --all and reports the last page metadata", async () => {
    const cursors: (string | null)[] = [];
    await withFetch((url) => {
      cursors.push(url.searchParams.get("cursor"));
      expect(url.pathname).toBe("/client/v4/accounts/account-1/rulesets");
      expect(url.searchParams.get("per_page")).toBe("2");
      return cursors.length === 1 ? response([{ id: "one" }], { cursors: { after: "second" } }) : response([{ id: "two" }], { cursors: {} });
    }, async () => {
      expect(await client().inventory.listRulesets({ scope: "account" }, { all: true, perPage: 2 })).toEqual({ scope: "account", accountId: "account-1", rulesets: [{ id: "one" }, { id: "two" }], resultInfo: { cursors: {} }, truncated: false });
      expect(cursors).toEqual([null, "second"]);
    });
  });

  it("rejects a repeated cursor rather than looping or returning partial output", async () => {
    let count = 0;
    await withFetch(() => { count++; return response([{ id: "one" }], { cursors: { after: "repeat" } }); }, async () => {
      await expect(client().inventory.listRulesets({ scope: "zone" }, { all: true })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", requestMethod: "GET", requestPath: "/client/v4/zones/zone-1/rulesets" });
      expect(count).toBe(2);
    });
  });

  it("rejects a later failed page without partial results", async () => {
    let count = 0;
    await withFetch(() => ++count === 1 ? response([{ id: "one" }], { cursors: { after: "next" } }) : new Response(JSON.stringify({ success: false, errors: [{ code: 999, message: "backend down" }], result: null }), { status: 500 }), async () => {
      await expect(client().inventory.listRulesets({ scope: "zone" }, { all: true })).rejects.toMatchObject({ code: "999", statusCode: 500 });
    });
  });

  it("reads pinned ruleset versions and preserves generic action parameters", async () => {
    await withFetch((url) => { expect(url.pathname).toBe("/client/v4/accounts/account-1/rulesets/rs-1/versions/7"); return response(RULESET); }, async () => {
      const result = await client().inventory.getRuleset("rs-1", { scope: "account" }, "7");
      expect(result.scope).toBe("account");
      expect(result.ruleset.rules[0]).toMatchObject({ order: 1, enabled: true, action_parameters: RULESET.rules[0]!.action_parameters });
      expect(result.ruleset.rules[1]).toMatchObject({ order: 2, enabled: false, action_parameters: RULESET.rules[1]!.action_parameters });
      expect(result.ruleset.rules[1]).not.toHaveProperty("expression");
    });
  });

  it("reads current ruleset detail and keeps an empty ruleset present", async () => {
    await withFetch((url) => { expect(url.pathname).toBe("/client/v4/zones/zone-1/rulesets/rs-1"); return response({ id: "rs-1", rules: [] }); }, async () => {
      expect((await client().inventory.getRuleset("rs-1", { scope: "zone" })).ruleset.rules).toEqual([]);
    });
  });

  it("distinguishes documented missing entrypoint from present empty entrypoint", async () => {
    await withFetch((url) => {
      expect(url.pathname).toEndWith("/rulesets/phases/http_request_origin/entrypoint");
      return new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: "entrypoint not found" }], result: null }), { status: 404 });
    }, async () => {
      expect(await client().inventory.getPhaseEntrypoint("http_request_origin", { scope: "zone" })).toMatchObject({ scope: "zone", zoneId: "zone-1", phase: "http_request_origin", status: "absent", diagnostic: { statusCode: 404, code: "10003", message: "entrypoint not found" } });
    });
    await withFetch(() => response({ id: "empty", rules: [] }), async () => {
      expect(await client().inventory.getPhaseEntrypoint("http_request_origin", { scope: "zone" })).toMatchObject({ status: "present", ruleset: { id: "empty", rules: [] } });
    });
  });

  it("keeps generic ruleset 404s as failures", async () => {
    await withFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: "not entitled to managed ruleset" }], result: null }), { status: 404 }), async () => {
      await expect(client().inventory.getRuleset("managed", { scope: "zone" })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  it.each([
    "<html>404 not found</html>",
    JSON.stringify({ success: false, errors: [{ code: 10003, message: "Managed ruleset not found: account is not entitled" }], result: null }),
    JSON.stringify({ success: false, errors: [{ code: 10003, message: "Not allowed to access this entrypoint" }], result: null }),
  ])("does not convert ambiguous or denied 404 into absence", async (body) => {
    await withFetch(() => new Response(body, { status: 404 }), async () => {
      await expect(client().inventory.getPhaseEntrypoint("http_request_origin", { scope: "zone" })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  it.each([
    {}, { scope: "invalid" }, { scope: "zone", accountId: "wrong" }, { scope: "account", zoneId: "wrong" }, { scope: "zone", zoneId: "" }, { scope: "account", accountId: " " },
  ])("rejects scope mistakes without issuing a request: %j", async (target) => {
    let count = 0;
    await withFetch(() => { count++; return response([]); }, async () => {
      await expect(client().inventory.listRulesets(target as never)).rejects.toThrow();
      expect(count).toBe(0);
    });
  });

  it("never uses the opposite configured default or infers a scope", async () => {
    await expect(client({ accountId: "account-only" }).inventory.listRulesets({ scope: "zone" })).rejects.toThrow("Zone ID");
    await expect(client({ zoneId: "zone-only" }).inventory.listRulesets({ scope: "account" })).rejects.toThrow("Account ID");
  });

  it.each([0, 51, 1.5])("rejects invalid ruleset page size %s", async (perPage) => {
    await expect(client().inventory.listRulesets({ scope: "zone" }, { perPage })).rejects.toThrow();
  });

  it("rejects empty IDs, phases and versions before request", async () => {
    await expect(client().inventory.getRuleset("", { scope: "zone" })).rejects.toThrow();
    await expect(client().inventory.getRuleset("rs", { scope: "zone" }, " ")).rejects.toThrow();
    await expect(client().inventory.getPhaseEntrypoint("", { scope: "zone" })).rejects.toThrow();
  });
});

describe("migration inventory strict responses", () => {
  it.each([null, {}, { result: [] }, { success: true, result: null }, { success: true, result: [{}] }, { success: true, result: [], errors: "broken" }, { success: true, result: [], result_info: { cursors: { after: 4 } } }])("rejects malformed rulesets envelope %j", async (body) => {
    await withFetch(() => new Response(JSON.stringify(body)), async () => {
      await expect(client().inventory.listRulesets({ scope: "zone" })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", requestMethod: "GET", requestPath: "/client/v4/zones/zone-1/rulesets" });
    });
  });

  it("preserves API failures even under HTTP 200", async () => {
    await withFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 1234, message: "API denied request" }], result: null })), async () => {
      await expect(client().inventory.listRulesets({ scope: "zone" })).rejects.toMatchObject({ code: "1234", message: "API denied request", requestMethod: "GET" });
    });
  });

  it.each([403, 410, 500])("never treats phase HTTP %s as absence", async (status) => {
    await withFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "API failure" }], result: null }), { status }), async () => {
      try { await client().inventory.getPhaseEntrypoint("http_request_firewall_custom", { scope: "zone" }); throw new Error("expected failure"); }
      catch (error) {
        expect(error).toBeInstanceOf(CloudflareError);
        expect((error as CloudflareError).statusCode).toBe(status);
        expect((error as CloudflareError).requestPath).toEndWith("/rulesets/phases/http_request_firewall_custom/entrypoint");
        const explanation = describeError(error);
        if (status === 410) { expect(explanation).toContain("retired"); expect(explanation).not.toContain("Required permission"); }
        if (status === 403) { expect(explanation).toContain("Zone WAF Read"); expect(explanation).toContain("entitlement"); }
      }
    });
  });

  it("uses scoped, verified account ruleset permission alternatives", async () => {
    await withFetch(() => new Response("{}", { status: 403 }), async () => {
      try { await client().inventory.listRulesets({ scope: "account" }); } catch (error) {
        expect((error as CloudflareError).requiredPermissions).toEqual(["Account Rulesets Read", "Account WAF Read"]);
        expect(describeError(error)).not.toContain("'Rulesets Read'");
      }
    });
  });
});

describe("migration inventory zone and Worker configuration", () => {
  it("gets individual settings without using the deprecated bulk route", async () => {
    await withFetch((url) => { expect(url.pathname).toBe("/client/v4/zones/override/settings/security_level"); return response({ id: "security_level", value: "medium", editable: true }); }, async () => {
      expect(await client().inventory.getZoneSetting("security_level", "override")).toEqual({ scope: "zone", zoneId: "override", setting: { id: "security_level", value: "medium", editable: true } });
    });
  });

  it("gets meaningful Bot Management settings with forward-compatible fields", async () => {
    await withFetch((url) => { expect(url.pathname).toEndWith("/bot_management"); return response({ fight_mode: true, enable_js: false, auto_update_model: true, future_bot_setting: "keep" }); }, async () => {
      expect(await client().inventory.getBotManagement()).toMatchObject({ scope: "zone", zoneId: "zone-1", settings: { fight_mode: true, enable_js: false, future_bot_setting: "keep" } });
    });
  });

  it("lists Worker routes, retaining scriptless exclusions", async () => {
    await withFetch((url) => { expect(url.pathname).toEndWith("/workers/routes"); expect(url.search).toBe(""); return response([{ id: "route-1", pattern: "example.com/*", script: "worker", future: 1 }, { id: "exclude", pattern: "example.com/private/*" }]); }, async () => {
      const result = await client().inventory.listWorkerRoutes();
      expect(result).toMatchObject({ scope: "zone", zoneId: "zone-1", routes: [{ id: "route-1", future: 1 }, { id: "exclude" }] });
      expect(result.routes[1]).not.toHaveProperty("script");
    });
  });

  it("lists Worker domains in account scope with an optional zone filter", async () => {
    await withFetch((url) => { expect(url.pathname).toBe("/client/v4/accounts/account-1/workers/domains"); expect(url.searchParams.get("zone_id")).toBe("filter-zone"); return response([{ id: "domain-1", hostname: "worker.example.com", service: "worker", environment: "production", zone_id: "filter-zone", zone_name: "example.com", enabled: true, future: "keep" }]); }, async () => {
      expect(await client().inventory.listWorkerDomains({ zoneId: "filter-zone" })).toMatchObject({ scope: "account", accountId: "account-1", zoneId: "filter-zone", domains: [{ hostname: "worker.example.com", service: "worker", future: "keep" }] });
    });
  });

  it("does not use the configured zone as an implicit Worker domain filter", async () => {
    await withFetch((url) => { expect(url.searchParams.has("zone_id")).toBe(false); return response([]); }, async () => {
      expect(await client().inventory.listWorkerDomains({})).not.toHaveProperty("zoneId");
    });
  });

  it("sorts Page Rules by descending native priority and preserves actions and targets", async () => {
    const rule = { id: "p1", priority: 2, status: "active", actions: [{ id: "forwarding_url", value: { status_code: 302, url: "https://example.com/$1" } }, { id: "cache_level", value: "cache_everything" }], targets: [{ target: "url", constraint: { operator: "matches", value: "*example.com/*" } }] };
    await withFetch((url) => { expect(url.pathname).toEndWith("/pagerules"); expect(url.searchParams.get("order")).toBe("priority"); expect(url.searchParams.get("direction")).toBe("desc"); return response([rule, { ...rule, id: "p2", priority: 100, status: "disabled" }]); }, async () => {
      expect(await client().inventory.listPageRules()).toMatchObject({ scope: "zone", zoneId: "zone-1", rules: [{ id: "p2", priority: 100, order: 1, status: "disabled" }, { ...rule, order: 2 }] });
    });
  });

  it("gets managed transform conflicts", async () => {
    const settings = { managed_request_headers: [{ id: "add_true_client_ip_headers", enabled: false, has_conflict: true, conflicts_with: ["add_visitor_location_headers"] }], managed_response_headers: [] };
    await withFetch((url) => { expect(url.pathname).toEndWith("/managed_headers"); return response(settings); }, async () => {
      expect(await client().inventory.getManagedTransforms()).toEqual({ scope: "zone", zoneId: "zone-1", settings });
    });
  });

  it("gets URL normalization enums", async () => {
    await withFetch((url) => { expect(url.pathname).toEndWith("/url_normalization"); return response({ scope: "both", type: "rfc3986" }); }, async () => {
      expect(await client().inventory.getUrlNormalization()).toEqual({ scope: "zone", zoneId: "zone-1", settings: { scope: "both", type: "rfc3986" } });
    });
  });

  it.each([
    ["getRuleset", { id: "rs" }], ["getZoneSetting", { id: "test" }], ["getBotManagement", {}], ["getBotManagement", { fight_mode: "yes" }], ["listWorkerRoutes", [{}]], ["listWorkerDomains", [{ id: "d", hostname: "host" }]], ["listPageRules", [{ id: "p", priority: 1 }]], ["getManagedTransforms", {}], ["getManagedTransforms", { managed_request_headers: [{ id: "bad", enabled: "yes" }], managed_response_headers: [] }], ["getUrlNormalization", {}], ["getUrlNormalization", { scope: "wrong", type: "cloudflare" }],
  ])("rejects malformed %s results", async (method, result) => {
    await withFetch(() => response(result), async () => {
      const inventory = client().inventory;
      const call = method === "getRuleset" ? inventory.getRuleset("rs", { scope: "zone" }) : method === "getZoneSetting" ? inventory.getZoneSetting("test") : (inventory[method as keyof typeof inventory] as () => Promise<unknown>).call(inventory);
      await expect(call).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", requestMethod: "GET" });
    });
  });

  it.each(["listWorkerRoutes", "listWorkerDomains", "listPageRules"])("rejects known truncation on %s rather than claiming completeness", async (method) => {
    await withFetch(() => response([], { count: 0, total_count: 2, page: 1, total_pages: 2 }), async () => {
      const inventory = client().inventory;
      await expect(inventory[method as "listWorkerRoutes"]()).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    });
  });

  it("redacts recursively without stripping origin settings, expressions or overrides", async () => {
    const secrets = {
      ...RULESET,
      api_token: "top-secret-token",
      rules: [{ ...RULESET.rules[0], action_parameters: { origin: { host: "origin.example.com", port: 443 }, headers: { "X-Api-Key": { operation: "set", value: "header-secret" }, Authorization: { operation: "set", expression: '"header-value"' } }, url: "https://alice:password@example.com/path?token=url-secret&language=en", nested: { password: "nested-secret", client_secret: "client-secret", enabled: true } } }],
    };
    await withFetch(() => response(secrets), async () => {
      const result = await client().inventory.getRuleset("rs", { scope: "zone" });
      const json = JSON.stringify(result);
      for (const secret of ["top-secret-token", "header-secret", "header-value", "alice", "password@", "url-secret", "nested-secret", "client-secret"]) expect(json).not.toContain(secret);
      expect(json).toContain("[REDACTED]");
      expect(json).toContain("origin.example.com");
      expect(json).toContain("language=en");
      expect(result.ruleset.rules[0]?.expression).toBe("true");
      expect(secrets.api_token).toBe("top-secret-token");
    });
  });

  it("does not include sensitive invalid response payloads in validation errors", async () => {
    await withFetch(() => response({ id: "rs", rules: [{ action: 42, expression: "DO_NOT_LEAK_SECRET" }] }), async () => {
      try { await client().inventory.getRuleset("rs", { scope: "zone" }); throw new Error("expected failure"); } catch (error) {
        expect(error).toBeInstanceOf(CloudflareError);
        expect(describeError(error)).not.toContain("DO_NOT_LEAK_SECRET");
        expect(describeError(error)).toContain("GET /client/v4/zones/zone-1/rulesets/rs");
      }
    });
  });

  it("redacts reflected configured credentials from API errors and absence diagnostics", async () => {
    for (const status of [403, 404]) {
      await withFetch(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10003, message: "Entrypoint not found for test-token at https://user:pass@example.com?token=hidden" }], result: null }), { status }), async () => {
        try {
          const result = await client().inventory.getPhaseEntrypoint("http_request_origin", { scope: "zone" });
          expect(JSON.stringify(result)).not.toContain("test-token");
          expect(JSON.stringify(result)).not.toContain("hidden");
        } catch (error) {
          expect((error as CloudflareError).statusCode).toBe(403);
          expect(describeError(error)).not.toContain("test-token");
          expect(describeError(error)).not.toContain("hidden");
          expect(describeError(error)).not.toContain("user:pass");
        }
      });
    }
  });

  it("redacts header arrays and Page Rules header action values", async () => {
    const rule = { id: "p", priority: 1, status: "active", targets: [], actions: [
      { id: "response_headers", value: [{ name: "X-Api-Key", value: "array-secret" }] },
      { id: "request_headers", value: { Authorization: { value: "wrapped-secret", operation: "set" } } },
    ] };
    await withFetch(() => response([rule]), async () => {
      const json = JSON.stringify(await client().inventory.listPageRules());
      expect(json).not.toContain("array-secret");
      expect(json).not.toContain("wrapped-secret");
      expect(json).toContain("X-Api-Key");
      expect(json).toContain("operation");
    });
  });

  it("preserves ordinary header transforms and cache cookie-name configuration", async () => {
    const parameters = { headers: { Host: { operation: "set", value: "origin.example.com" }, Location: { operation: "set", value: "https://example.com/path?language=en" }, "Cache-Control": { operation: "set", value: "max-age=3600" }, Authorization: { operation: "set", value: "Bearer secret" } }, cache_key: { custom_key: { cookie: { include: ["language", "session_type"], check_presence: ["logged_in"] } } } };
    await withFetch(() => response({ id: "rs", rules: [{ id: "r", action: "set_cache_settings", expression: "true", action_parameters: parameters }] }), async () => {
      const result = await client().inventory.getRuleset("rs", { scope: "zone" });
      expect(result.ruleset.rules[0]?.action_parameters).toMatchObject({ headers: { Host: { value: "origin.example.com" }, Location: { value: "https://example.com/path?language=en" }, "Cache-Control": { value: "max-age=3600" }, Authorization: { value: "[REDACTED]" } }, cache_key: parameters.cache_key });
    });
  });

  it("redacts direct X-Auth headers and auth/session URL query values", async () => {
    await withFetch(() => response({ id: "rs", rules: [{ id: "r", action: "rewrite", expression: "true", action_parameters: { headers: { "X-Auth": "direct-auth-secret", "Cache-Control": "max-age=60" }, uri: "https://example.com/path?auth=query-auth-secret&session=query-session-secret&safe=visible" } }] }), async () => {
      const json = JSON.stringify(await client().inventory.getRuleset("rs", { scope: "zone" }));
      for (const secret of ["direct-auth-secret", "query-auth-secret", "query-session-secret"]) expect(json).not.toContain(secret);
      expect(json).toContain("max-age=60");
      expect(json).toContain("safe=visible");
    });
  });
});
