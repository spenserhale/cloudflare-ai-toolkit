import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = join(PACKAGE_ROOT, "src/bin.ts");
const BUN_BIN = process.env.BUN_BIN ?? "bun";
const ZONE_ID = "93ee0111ed54e0cd50ee68173b7f3307";
const ACCOUNT_ID = "inventory-account";
const CUSTOM_PHASE = "http_request_firewall_custom";
const ZONE_PATH = `/client/v4/zones/${ZONE_ID}`;
const ACCOUNT_PATH = `/client/v4/accounts/${ACCOUNT_ID}`;

interface MockRoute {
  readonly pathname: string;
  readonly query?: Record<string, string>;
  readonly status?: number;
  readonly body?: unknown;
  readonly rawBody?: string;
}

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

// Every response is sequential and GET-only. A wrong query, extra request, or
// retired endpoint is a test failure even if the CLI would treat its 404 as absent.
const PRELOAD_SCRIPT = `
import { writeFileSync } from "node:fs";
const routes = JSON.parse(process.env.MOCK_ROUTES ?? "[]");
const report = { consumed: 0, violations: [] };
const saveReport = () => writeFileSync(process.env.MOCK_REQUEST_REPORT, JSON.stringify(report));
const sortedQuery = (entries) => JSON.stringify([...entries].sort(([a], [b]) => a.localeCompare(b)));
saveReport();

globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const route = routes[report.consumed];
  let violation;

  if (request.method !== "GET") violation = "Inventory attempted " + request.method;
  else if (url.origin !== "https://mock.cloudflare.test") violation = "Unexpected request origin " + url.origin;
  else if (url.pathname.includes("/firewall/rules")) violation = "Retired firewall/rules endpoint requested";
  else if (!route) violation = "Unexpected request " + url.pathname + url.search;
  else if (route.pathname !== url.pathname) violation = "Expected " + route.pathname + ", received " + url.pathname;
  else if (route.query && sortedQuery(Object.entries(route.query)) !== sortedQuery(url.searchParams.entries())) {
    violation = "Unexpected query for " + url.pathname + ": " + url.search;
  } else if (request.headers.get("authorization") !== "Bearer inventory-test-token") {
    violation = "Missing isolated test token";
  }

  if (violation) {
    report.violations.push(violation);
    saveReport();
    return new Response(JSON.stringify({ success: false, errors: [{ code: 599, message: violation }], messages: [], result: null }), { status: 599 });
  }

  report.consumed += 1;
  saveReport();
  return new Response(route.rawBody ?? JSON.stringify(route.body), {
    status: route.status ?? 200,
    headers: { "Content-Type": route.rawBody === undefined ? "application/json" : "text/html" },
  });
};
`;

async function runCli(
  args: readonly string[],
  routes: readonly MockRoute[] = [],
  authenticated = true
): Promise<RunResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "cf-inventory-e2e-"));
  const preloadPath = join(tempDir, "mock-fetch.mjs");
  const reportPath = join(tempDir, "requests.json");
  writeFileSync(preloadPath, PRELOAD_SCRIPT, "utf8");

  try {
    // A fresh working directory and no inherited Cloudflare variables prevent
    // local .env files, account defaults, or real credentials affecting results.
    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_"))
    );
    const result = await new Promise<RunResult>((resolvePromise, rejectPromise) => {
      const child = spawn(BUN_BIN, ["--preload", preloadPath, CLI_ENTRY, ...args], {
        cwd: tempDir,
        env: {
          ...inheritedEnv,
          ...(authenticated ? { CLOUDFLARE_API_TOKEN: "inventory-test-token" } : {}),
          CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
          // Never read or write the developer's OS keychain in a subprocess.
          CLOUDFLARE_KEYCHAIN: "0",
          MOCK_ROUTES: JSON.stringify(routes),
          MOCK_REQUEST_REPORT: reportPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        rejectPromise(new Error(`Inventory CLI timed out: ${args.join(" ")}`));
      }, 10_000);
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => { clearTimeout(timeout); rejectPromise(error); });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolvePromise({ code, stdout, stderr });
      });
    });

    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      consumed: number;
      violations: string[];
    };
    expect(report.violations, result.stderr).toEqual([]);
    expect(report.consumed, result.stderr).toBe(routes.length);
    return result;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function envelope(result: unknown, resultInfo?: unknown): unknown {
  return { success: true, errors: [], messages: [], result, ...(resultInfo ? { result_info: resultInfo } : {}) };
}

function ruleset(phase: string, rules: readonly unknown[], id = "ruleset-1") {
  return {
    id,
    name: `Inventory ${phase}`,
    description: "Migration inventory fixture",
    kind: "zone",
    phase,
    version: "3",
    last_updated: "2026-11-18T12:00:00Z",
    rules,
  };
}

function parseSuccess(result: RunResult, diagnostics = false) {
  expect(result.code, result.stderr).toBe(0);
  if (!diagnostics) expect(result.stderr).toBe("");
  // JSON.parse also rejects banners or diagnostics accidentally sent to stdout.
  return JSON.parse(result.stdout);
}

function expectFailure(result: RunResult, message: RegExp | string) {
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  if (typeof message === "string") expect(result.stderr).toContain(message);
  else expect(result.stderr).toMatch(message);
}

describe("CLI migration inventory e2e", () => {
  it("the exact reported WAF command reads only the modern custom-rule entrypoint", async () => {
    const nativeRules = [
      { id: "waf-block", action: "block", expression: "ip.src eq 192.0.2.1", description: "Block old origin", enabled: true },
      { id: "waf-skip", action: "skip", expression: "http.host eq \"vip.example.com\"", enabled: false, action_parameters: { ruleset: "current", phases: ["http_ratelimit"] } },
    ];
    const result = await runCli([
      "waf", "rules", "list", "--zone-id", ZONE_ID, "--per-page", "100", "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/${CUSTOM_PHASE}/entrypoint`, query: {}, body: envelope(ruleset(CUSTOM_PHASE, nativeRules)) }]);

    const output = parseSuccess(result);
    expect(output).toMatchObject({ scope: "zone", zoneId: ZONE_ID, phase: CUSTOM_PHASE, rulesetId: "ruleset-1", status: "present", truncated: false });
    expect(output.rules).toMatchObject([
      { id: "waf-block", action: "block", enabled: true, paused: false, order: 1, filter: { expression: "ip.src eq 192.0.2.1" } },
      { id: "waf-skip", action: "skip", enabled: false, paused: true, order: 2, filter: { expression: "http.host eq \"vip.example.com\"" }, action_parameters: { ruleset: "current", phases: ["http_ratelimit"] } },
    ]);
  });

  it("WAF skip filters run before numeric paging and preserve native order", async () => {
    const nativeRules = [
      { id: "block", action: "block", expression: "true" },
      { id: "skip-first", action: "skip", expression: "true", description: "VIP first", action_parameters: { ruleset: "current" } },
      { id: "skip-disabled", action: "skip", expression: "true", description: "VIP disabled", enabled: false },
      { id: "skip-second", action: "skip", expression: "true", description: "VIP second", action_parameters: { phases: ["http_ratelimit"] } },
    ];
    const result = await runCli([
      "waf", "rules", "list", "--zone-id", ZONE_ID, "--action", "skip", "--description", "vip",
      "--paused", "false", "--page", "2", "--per-page", "1", "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/${CUSTOM_PHASE}/entrypoint`, query: {}, body: envelope(ruleset(CUSTOM_PHASE, nativeRules)) }]);

    const output = parseSuccess(result);
    expect(output.rules).toMatchObject([{ id: "skip-second", action: "skip", order: 4, enabled: true, paused: false, action_parameters: { phases: ["http_ratelimit"] } }]);
    expect(output.rules).toHaveLength(1);
    expect(output.resultInfo).toMatchObject({ page: 2, per_page: 1, total_count: 2, total_pages: 2 });
    expect(output.truncated).toBe(false);
  });

  it("WAF get finds a modern rule without requesting a legacy rule ID", async () => {
    const result = await runCli([
      "waf", "rules", "get", "waf-target", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/${CUSTOM_PHASE}/entrypoint`, query: {}, body: envelope(ruleset(CUSTOM_PHASE, [
      { id: "other", action: "block", expression: "true" },
      { id: "waf-target", action: "managed_challenge", expression: "cf.bot_management.score lt 30", enabled: false },
    ])) }]);

    expect(parseSuccess(result)).toMatchObject({ id: "waf-target", action: "managed_challenge", order: 2, enabled: false, paused: true, rulesetId: "ruleset-1", filter: { expression: "cf.bot_management.score lt 30" } });
  });

  it("rulesets --all follows opaque cursor pages within explicit account scope", async () => {
    const cursor = "next/page=2";
    const result = await runCli([
      "rulesets", "list", "--scope", "account", "--account-id", ACCOUNT_ID, "--per-page", "2", "--all", "--json",
    ], [
      { pathname: `${ACCOUNT_PATH}/rulesets`, query: { per_page: "2" }, body: envelope([
        { id: "account-first", name: "Account custom rules", kind: "root", phase: CUSTOM_PHASE, version: "1" },
      ], { cursors: { after: cursor } }) },
      { pathname: `${ACCOUNT_PATH}/rulesets`, query: { per_page: "2", cursor }, body: envelope([
        { id: "account-second", name: "Account managed rules", kind: "root", phase: "http_request_firewall_managed", version: "2" },
      ], { cursors: {} }) },
    ]);

    const output = parseSuccess(result);
    expect(output).toMatchObject({ scope: "account", accountId: ACCOUNT_ID, truncated: false });
    expect(output.rulesets.map((item: { id: string }) => item.id)).toEqual(["account-first", "account-second"]);
    expect(output.rulesets[0]).not.toHaveProperty("rules");
  });

  it("a single rulesets page exposes continuation in JSON and warns on stderr", async () => {
    const result = await runCli([
      "rulesets", "list", "--scope", "zone", "--zone-id", ZONE_ID, "--cursor", "start", "--per-page", "1", "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets`, query: { cursor: "start", per_page: "1" }, body: envelope([
      { id: "partial", name: "Origin rules", kind: "zone", phase: "http_request_origin", version: "4" },
    ], { cursors: { after: "continue-here" } }) }]);

    expect(parseSuccess(result, true)).toMatchObject({ scope: "zone", zoneId: ZONE_ID, truncated: true, resultInfo: { cursors: { after: "continue-here" } } });
    expect(result.stderr).toMatch(/--all|--cursor/u);
  });

  it("origin entrypoints retain evaluation order, Host, SNI and DNS overrides", async () => {
    const phase = "http_request_origin";
    const params = {
      host_header: "vip.example.com",
      origin: { host: "vip-origin.example.net", port: 443 },
      sni: { value: "vip-origin.example.net" },
    };
    const result = await runCli([
      "rulesets", "phases", "get", phase, "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/${phase}/entrypoint`, query: {}, body: envelope(ruleset(phase, [
      { id: "origin-first", action: "route", expression: "http.host eq \"vip.example.com\"", action_parameters: params },
      { id: "origin-second", action: "route", expression: "true", enabled: false, action_parameters: { origin: { host: "fallback.example.net", port: 8443 } } },
    ])) }]);

    const output = parseSuccess(result);
    expect(output).toMatchObject({ scope: "zone", zoneId: ZONE_ID, phase, status: "present" });
    expect(output.ruleset.rules).toMatchObject([
      { id: "origin-first", action: "route", order: 1, enabled: true, action_parameters: params },
      { id: "origin-second", order: 2, enabled: false, action_parameters: { origin: { host: "fallback.example.net", port: 8443 } } },
    ]);
  });

  it("managed execute rules retain ruleset references and category/rule overrides", async () => {
    const phase = "http_request_firewall_managed";
    const params = {
      id: "cloudflare-managed-ruleset",
      version: "latest",
      overrides: {
        enabled: true,
        categories: [{ category: "wordpress", action: "managed_challenge", enabled: true }],
        rules: [{ id: "managed-child", action: "log", enabled: false }],
      },
    };
    const result = await runCli([
      "rulesets", "phases", "get", phase, "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/${phase}/entrypoint`, body: envelope(ruleset(phase, [
      { id: "execute-managed", action: "execute", expression: "true", action_parameters: params },
    ])) }]);

    expect(parseSuccess(result).ruleset.rules).toMatchObject([{ id: "execute-managed", action: "execute", order: 1, enabled: true, action_parameters: params }]);
  });

  it("pinned account managed rules may omit expression without losing definitions", async () => {
    const detail = { ...ruleset("http_request_firewall_managed", [
      { id: "managed-child", action: "block", description: "Managed WordPress signature" },
    ], "managed-id"), kind: "managed", version: "7" };
    const result = await runCli([
      "rulesets", "get", "managed-id", "--version", "7", "--scope", "account", "--account-id", ACCOUNT_ID, "--json",
    ], [{ pathname: `${ACCOUNT_PATH}/rulesets/managed-id/versions/7`, query: {}, body: envelope(detail) }]);

    const output = parseSuccess(result);
    expect(output).toMatchObject({ scope: "account", accountId: ACCOUNT_ID, ruleset: { id: "managed-id", kind: "managed", version: "7" } });
    expect(output.ruleset.rules).toMatchObject([{ id: "managed-child", action: "block", order: 1, enabled: true }]);
    expect(output.ruleset.rules[0]).not.toHaveProperty("expression");
  });

  it("phase 404 is explicit absence while a configured empty entrypoint remains present", async () => {
    const phase = "http_request_origin";
    const args = ["rulesets", "phases", "get", phase, "--scope", "zone", "--zone-id", ZONE_ID, "--json"];
    const pathname = `${ZONE_PATH}/rulesets/phases/${phase}/entrypoint`;
    const absent = parseSuccess(await runCli(args, [{ pathname, status: 404, body: {
      success: false, errors: [{ code: 10007, message: "Ruleset not found" }], messages: [], result: null,
    } }]));
    expect(absent).toMatchObject({ scope: "zone", zoneId: ZONE_ID, phase, status: "absent", diagnostic: { statusCode: 404, code: "10007", message: "Ruleset not found" } });
    expect(absent).not.toHaveProperty("ruleset");

    const present = parseSuccess(await runCli(args, [{ pathname, body: envelope(ruleset(phase, [])) }]));
    expect(present).toMatchObject({ phase, status: "present", ruleset: { rules: [] } });
  });

  it("redacts credential fields, sensitive headers and URL secrets without losing ordinary headers", async () => {
    const result = await runCli([
      "rulesets", "get", "transform-id", "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/transform-id`, body: envelope(ruleset("http_request_late_transform", [
      { id: "headers", action: "rewrite", expression: "true", action_parameters: {
        headers: {
          Authorization: { operation: "set", value: "Bearer header-secret" },
          Cookie: { operation: "set", value: "sid=cookie-secret" },
          "X-Origin-Host": { operation: "set", value: "vip.internal" },
        },
        api_token: "credential-secret",
        diagnostic_url: "https://inventory-user:url-password@origin.example.net/path?token=query-secret&mode=full",
      } },
    ], "transform-id")) }]);

    const output = parseSuccess(result);
    expect(output.ruleset.rules[0].action_parameters.headers["X-Origin-Host"]).toEqual({ operation: "set", value: "vip.internal" });
    for (const secret of ["header-secret", "cookie-secret", "credential-secret", "inventory-user", "url-password", "query-secret"]) {
      expect(result.stdout).not.toContain(secret);
      expect(result.stderr).not.toContain(secret);
    }
    expect(result.stdout).toContain("origin.example.net");
    expect(result.stdout).toContain("mode=full");
  });

  it("Worker routes retain exclusions that have no script", async () => {
    const result = await runCli([
      "workers", "routes", "list", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/workers/routes`, query: {}, body: envelope([
      { id: "exclude-static", pattern: "static.example.com/*" },
      { id: "vip-worker", pattern: "www.example.com/*", script: "vip-router" },
    ]) }]);

    const output = parseSuccess(result);
    expect(output).toMatchObject({ scope: "zone", zoneId: ZONE_ID, routes: [
      { id: "exclude-static", pattern: "static.example.com/*" },
      { id: "vip-worker", pattern: "www.example.com/*", script: "vip-router" },
    ] });
    expect(output.routes[0]).not.toHaveProperty("script");
  });

  it("Worker custom domains use account scope and pass the requested zone filter", async () => {
    const domain = { id: "worker-domain", hostname: "vip.example.com", service: "vip-router", environment: "production", zone_id: ZONE_ID, zone_name: "example.com" };
    const result = await runCli([
      "workers", "domains", "list", "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ACCOUNT_PATH}/workers/domains`, query: { zone_id: ZONE_ID }, body: envelope([domain]) }]);

    expect(parseSuccess(result)).toMatchObject({ scope: "account", accountId: ACCOUNT_ID, domains: [domain] });
  });

  it("Page Rules expose highest priority first with targets and action parameters", async () => {
    const pageRules = [
      { id: "page-high", status: "active", priority: 30, targets: [{ target: "url", constraint: { operator: "matches", value: "*example.com/private/*" } }], actions: [{ id: "cache_level", value: "bypass" }] },
      { id: "page-low", status: "disabled", priority: 10, targets: [{ target: "url", constraint: { operator: "matches", value: "http://example.com/*" } }], actions: [{ id: "forwarding_url", value: { url: "https://vip.example.com/$1", status_code: 301 } }] },
    ];
    const result = await runCli([
      "page-rules", "list", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/pagerules`, query: { order: "priority", direction: "desc" }, body: envelope(pageRules) }]);

    expect(parseSuccess(result)).toMatchObject({ scope: "zone", zoneId: ZONE_ID, rules: [
      { ...pageRules[0], order: 1 },
      { ...pageRules[1], order: 2 },
    ] });
  });

  const settingsCases = [
    {
      label: "targeted SSL setting",
      args: ["zones", "settings", "get", "ssl"],
      path: "/settings/ssl",
      wrapper: "setting",
      value: { id: "ssl", value: "strict", editable: true, modified_on: "2026-11-18T12:00:00Z" },
    },
    {
      label: "Bot Management configuration",
      args: ["waf", "bot-management", "get"],
      path: "/bot_management",
      wrapper: "settings",
      value: { fight_mode: true, enable_js: true, sbfm_definitely_automated: "managed_challenge", sbfm_likely_automated: "block", sbfm_verified_bots: "allow", sbfm_static_resource_protection: true },
    },
    {
      label: "managed request and response headers",
      args: ["zones", "managed-transforms", "get"],
      path: "/managed_headers",
      wrapper: "settings",
      value: { managed_request_headers: [{ id: "add_true_client_ip_headers", enabled: true }], managed_response_headers: [{ id: "remove_x_powered_by_header", enabled: true }, { id: "add_security_headers", enabled: false }] },
    },
    {
      label: "URL normalization configuration",
      args: ["zones", "url-normalization", "get"],
      path: "/url_normalization",
      wrapper: "settings",
      value: { type: "cloudflare", scope: "both" },
    },
  ];

  it.each(settingsCases)("reads $label as JSON", async ({ args, path, wrapper, value }) => {
    const result = await runCli([...args, "--zone-id", ZONE_ID, "--json"], [
      { pathname: `${ZONE_PATH}${path}`, query: {}, body: envelope(value) },
    ]);
    expect(parseSuccess(result)).toMatchObject({ scope: "zone", zoneId: ZONE_ID, [wrapper]: value });
  });

  const failures = [
    { label: "permission denial", status: 403, code: 9109, message: "Unauthorized to access requested resource" },
    { label: "managed ruleset entitlement", status: 403, code: 10000, message: "Account is not entitled to this managed ruleset" },
    { label: "retired endpoint", status: 410, code: 10020, message: "This API endpoint is no longer supported" },
    { label: "upstream failure", status: 500, code: 10001, message: "Upstream service unavailable" },
    { label: "generic ruleset absence", status: 404, code: 10007, message: "Ruleset not found" },
  ];

  it.each(failures)("$label fails with stderr diagnostics and no stdout", async ({ status, code, message }) => {
    const result = await runCli([
      "rulesets", "get", "managed-id", "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/managed-id`, status, body: { success: false, errors: [{ code, message }], messages: [], result: null } }]);

    expectFailure(result, message);
    expect(result.stderr).toContain(`HTTP ${status}`);
    expect(result.stderr).toContain(String(code));
    expect(result.stderr).toContain(`${ZONE_PATH}/rulesets/managed-id`);
    if (status === 410) expect(result.stderr).not.toMatch(/Required permission|insufficient permission|verify.*token/iu);
  });

  it("HTML 524 remains an upstream failure with an empty stdout stream", async () => {
    const result = await runCli([
      "rulesets", "list", "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets`, status: 524, rawBody: "<html><title>524 A timeout occurred</title></html>" }]);
    expectFailure(result, "524");
  });

  it.each([
    { label: "HTML 404", rawBody: "<html><title>404 Not Found</title></html>" },
    { label: "entitlement 404", body: { success: false, errors: [{ code: 10007, message: "Account is not entitled to this managed ruleset" }], messages: [], result: null } },
  ])("phase $label cannot become a successful empty inventory", async ({ body, rawBody }) => {
    const result = await runCli([
      "rulesets", "phases", "get", "http_request_firewall_managed", "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/phases/http_request_firewall_managed/entrypoint`, status: 404, ...(rawBody ? { rawBody } : { body }) }]);
    expectFailure(result, "404");
  });

  it.each([
    { label: "null result", body: envelope(null) },
    { label: "missing resource fields", body: envelope({}) },
    { label: "missing success envelope", body: {} },
  ])("malformed 200 $label cannot become an empty inventory", async ({ body }) => {
    const result = await runCli([
      "rulesets", "get", "invalid-id", "--scope", "zone", "--zone-id", ZONE_ID, "--json",
    ], [{ pathname: `${ZONE_PATH}/rulesets/invalid-id`, body }]);
    expectFailure(result, /invalid|malformed|response|result/iu);
  });

  it.each([
    { label: "requires explicit scope", args: ["rulesets", "list", "--json"], diagnostic: /scope/iu },
    { label: "rejects account ID for zone scope", args: ["rulesets", "list", "--scope", "zone", "--zone-id", ZONE_ID, "--account-id", ACCOUNT_ID, "--json"], diagnostic: /account.?id|scope|conflict/iu },
    { label: "rejects per-page zero", args: ["rulesets", "list", "--scope", "zone", "--zone-id", ZONE_ID, "--per-page", "0", "--json"], diagnostic: /50|positive|per.?page/iu },
    { label: "rejects per-page over 50", args: ["rulesets", "list", "--scope", "zone", "--zone-id", ZONE_ID, "--per-page", "51", "--json"], diagnostic: /50/iu },
  ])("parser $label before credentials or network access", async ({ args, diagnostic }) => {
    expectFailure(await runCli(args, [], false), diagnostic);
  });

  const helpCommands = [
    ["rulesets", "list"],
    ["rulesets", "get"],
    ["rulesets", "phases", "get"],
    ["workers", "routes", "list"],
    ["workers", "domains", "list"],
    ["zones", "settings", "get"],
    ["waf", "bot-management", "get"],
    ["page-rules", "list"],
    ["zones", "managed-transforms", "get"],
    ["zones", "url-normalization", "get"],
  ].map((args) => ({ command: args.join(" "), args }));

  it.each(helpCommands)("$command --help works without credentials", async ({ args }) => {
    const result = await runCli([...args, "--help"], [], false);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/usage/iu);
  });
});
