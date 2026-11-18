import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = join(PACKAGE_ROOT, "src/bin.ts");
const BUN_BIN = process.env.BUN_BIN ?? "bun";
const ACCOUNT_ID = "list-inventory-account";
const ACCOUNT_PATH = `/client/v4/accounts/${ACCOUNT_ID}/rules/lists`;

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
  const tempDir = mkdtempSync(join(tmpdir(), "cf-list-inventory-e2e-"));
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

const scope = ["--scope", "account", "--account-id", ACCOUNT_ID, "--json"];
const listPath = `${ACCOUNT_PATH}/list-one`;
const itemsPath = `${listPath}/items`;

function list(kind = "ip", numItems = 0, extra: Record<string, unknown> = {}) {
  return {
    id: "list-one", name: "office_networks", kind, num_items: numItems,
    num_referencing_filters: 2, description: "Synthetic migration list",
    created_on: "2026-11-18T00:00:00Z", modified_on: "2026-11-18T01:00:00Z",
    ...extra,
  };
}

function metadataRoute(metadata: unknown = list()): MockRoute {
  return { pathname: listPath, query: {}, body: envelope(metadata) };
}

function itemsRoute(items: unknown, info?: unknown, query: Record<string, string> = { per_page: "100" }): MockRoute {
  return { pathname: itemsPath, query, body: envelope(items, info) };
}

describe("CLI account list inventory through mocked HTTP", () => {
  it("reads account metadata with no invented API filters or paging parameters", async () => {
    const metadata = list("redirect", 3, { future_field: { retained: true } });
    const result = await runCli(["lists", "list", ...scope], [
      { pathname: ACCOUNT_PATH, query: {}, body: envelope([metadata]) },
    ]);
    expect(parseSuccess(result)).toMatchObject({
      scope: "account", accountId: ACCOUNT_ID, lists: [metadata], truncated: false,
      resultInfo: { page: 1, count: 1, total_count: 1 },
    });
  });

  it("filters kind before local numeric paging and exposes local continuation", async () => {
    const lists = [
      list("redirect", 1),
      list("ip", 2, { id: "first-ip", name: "first_networks" }),
      list("ip", 3, { id: "second-ip", name: "second_networks" }),
      list("hostname", 1, { id: "hostnames", name: "hostnames" }),
    ];
    const result = await runCli(["lists", "list", ...scope, "--kind", "ip", "--page", "2", "--per-page", "1"], [
      { pathname: ACCOUNT_PATH, query: {}, body: envelope(lists) },
    ]);
    expect(parseSuccess(result)).toMatchObject({
      lists: [lists[2]], truncated: false,
      resultInfo: { page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 },
    });
  });

  it("matches an exact list name rather than a name substring", async () => {
    const exact = list("ip", 0, { id: "exact", name: "office" });
    const result = await runCli(["lists", "list", ...scope, "--name", "office"], [
      { pathname: ACCOUNT_PATH, query: {}, body: envelope([list("ip", 0), exact, list("ip", 0, { id: "case", name: "Office" })]) },
    ]);
    expect(parseSuccess(result)).toMatchObject({ lists: [exact], truncated: false });
  });

  it("bounds metadata output to 100 and sends continuation diagnostics only to stderr", async () => {
    const lists = Array.from({ length: 101 }, (_, index) => list("ip", 0, { id: `list-${index}`, name: `networks_${index}` }));
    const result = await runCli(["lists", "list", ...scope], [
      { pathname: ACCOUNT_PATH, query: {}, body: envelope(lists) },
    ]);
    const output = parseSuccess(result, true);
    expect(output.lists).toHaveLength(100);
    expect(output).toMatchObject({ truncated: true, resultInfo: { page: 1, per_page: 100, count: 100, total_count: 101, total_pages: 2 } });
    expect(result.stderr).toContain("--page");
    expect(result.stderr).toContain("--all");
  });

  it("collects every matching metadata entry with --all", async () => {
    const lists = [list("ip", 0), list("ip", 0, { id: "other", name: "other_networks" }), list("asn", 1, { id: "asn", name: "autonomous_systems" })];
    const result = await runCli(["lists", "list", ...scope, "--kind", "ip", "--all", "--per-page", "1"], [
      { pathname: ACCOUNT_PATH, query: {}, body: envelope(lists) },
    ]);
    expect(parseSuccess(result)).toMatchObject({ lists: lists.slice(0, 2), truncated: false, resultInfo: { count: 2, total_count: 2 } });
  });

  it("distinguishes successful empty metadata and no matching filter from a failed read", async () => {
    for (const lists of [[], [list("ip", 0)]]) {
      const result = await runCli(["lists", "list", ...scope, "--name", "not_here"], [
        { pathname: ACCOUNT_PATH, query: {}, body: envelope(lists) },
      ]);
      expect(parseSuccess(result)).toMatchObject({ lists: [], truncated: false, resultInfo: { count: 0, total_count: 0 } });
    }
  });

  it("reads list identity and native metadata without fetching items", async () => {
    const metadata = list("redirect", 100, { future_metadata: ["keep"] });
    const result = await runCli(["lists", "get", "list-one", ...scope], [metadataRoute(metadata)]);
    expect(parseSuccess(result)).toEqual({ scope: "account", accountId: ACCOUNT_ID, list: metadata });
  });

  it("collects all IP pages with IDs, CIDRs, comments, and original item order", async () => {
    const items = [
      { id: "first", ip: "192.0.2.0/24", comment: "Documentation subnet", created_on: "2026-11-18T00:00:00Z" },
      { id: "second", ip: "2001:db8::/32", comment: "IPv6 documentation", future_item: { retained: true } },
      { id: "third", ip: "198.51.100.7", comment: "Single address" },
    ];
    const metadata = list("ip", items.length);
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--all", "--per-page", "2"], [
      metadataRoute(metadata),
      itemsRoute(items.slice(0, 2), { cursors: { after: "next/IP?&opaque=" } }, { per_page: "2" }),
      itemsRoute(items.slice(2), { cursors: { before: "previous" } }, { per_page: "2", cursor: "next/IP?&opaque=" }),
    ]);
    expect(parseSuccess(result)).toMatchObject({ scope: "account", accountId: ACCOUNT_ID, list: metadata, items, truncated: false });
  });

  it("preserves every Bulk Redirect behavior field across multiple pages", async () => {
    const items = [
      { id: "redirect-one", comment: "Redirect with all behavior flags", redirect: {
        source_url: "old.example.test/folder/", target_url: "https://new.example.test/new-folder/?language=en",
        status_code: 308, include_subdomains: true, subpath_matching: true,
        preserve_path_suffix: false, preserve_query_string: true, future_parameter: "keep",
      } },
      { id: "redirect-two", redirect: {
        source_url: "https://other.example.test/", target_url: "https://new.example.test/",
        status_code: 302, include_subdomains: false, subpath_matching: false,
        preserve_path_suffix: true, preserve_query_string: false,
      } },
    ];
    const metadata = list("redirect", items.length, { name: "vip_redirects" });
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--per-page", "1", "--all"], [
      metadataRoute(metadata),
      itemsRoute(items.slice(0, 1), { cursors: { after: "second-page" } }, { per_page: "1" }),
      itemsRoute(items.slice(1), {}, { per_page: "1", cursor: "second-page" }),
    ]);
    expect(parseSuccess(result)).toMatchObject({ list: metadata, items, truncated: false });
  });

  it.each([
    ["hostname", { id: "hostname", hostname: { url_hostname: "*.example.test", exclude_exact_hostname: false }, comment: "Wildcard" }],
    ["asn", { id: "asn", asn: 64496, comment: "Documentation ASN" }],
  ])("reads documented %s kinds without treating them as empty", async (kind, item) => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list(kind as string, 1)), itemsRoute([item]),
    ]);
    expect(parseSuccess(result)).toMatchObject({ list: { kind }, items: [item], truncated: false });
  });

  it("forwards opaque cursor and search, collecting only the remaining filtered suffix", async () => {
    const query = { per_page: "500", cursor: "already/seen?after=1", search: "192.0.2." };
    const items = [{ id: "one", ip: "192.0.2.1" }];
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--cursor", query.cursor, "--search", query.search, "--perPage", "500", "--all"], [
      metadataRoute(list("ip", 800)), itemsRoute(items, {}, query),
    ]);
    expect(parseSuccess(result)).toMatchObject({ items, truncated: false });
  });

  it("returns a bounded item page and exposes a usable opaque cursor without logging its value", async () => {
    const cursor = "next-opaque?&=+/%";
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--per-page", "1"], [
      metadataRoute(list("ip", 2)),
      itemsRoute([{ id: "first", ip: "192.0.2.1" }], { cursors: { after: cursor } }, { per_page: "1" }),
    ]);
    const output = parseSuccess(result, true);
    expect(output).toMatchObject({ truncated: true, resultInfo: { cursors: { after: cursor } } });
    expect(output.items).toHaveLength(1);
    expect(result.stderr).toContain("--cursor");
    expect(result.stderr).toContain("--all");
    expect(result.stdout + result.stderr).not.toContain("inventory-test-token");
    expect(result.stderr).not.toContain("next-");
  });

  it("represents an existing empty list with its identity and zero items", async () => {
    const metadata = list("ip", 0);
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [metadataRoute(metadata), itemsRoute([])]);
    expect(parseSuccess(result)).toEqual({ scope: "account", accountId: ACCOUNT_ID, list: metadata, items: [], resultInfo: {}, truncated: false });
  });

  it("allows an empty search result for a populated list", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--search", "203.0.113."], [
      metadataRoute(list("ip", 10)), itemsRoute([], {}, { per_page: "100", search: "203.0.113." }),
    ]);
    expect(parseSuccess(result)).toMatchObject({ list: { num_items: 10 }, items: [], truncated: false });
  });

  it("fails a missing list before requesting items", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [{
      pathname: listPath, query: {}, status: 404,
      body: { success: false, result: null, errors: [{ code: 10003, message: "List not found" }] },
    }]);
    expectFailure(result, "List not found");
    expect(result.stderr).toContain("404");
  });

  it.each([
    ["lists", "list", "--json"],
    ["lists", "list", "--scope", "zone", "--json"],
    ["lists", "get", "list-one", "--scope", "account", "--zone-id", "zone-one", "--json"],
    ["lists", "list", ...scope, "--kind", "managed"],
    ["lists", "list", ...scope, "--page", "0"],
    ["lists", "list", ...scope, "--page", "1.5"],
    ["lists", "list", ...scope, "--all", "--page", "2"],
    ["lists", "list", ...scope, "--per-page", "0"],
    ["lists", "list", ...scope, "--per-page", "501"],
    ["lists", "items", "list", "list-one", ...scope, "--per-page", "1.5"],
    ["lists", "items", "list", "list-one", ...scope, "--per-page", "501"],
    ["lists", "items", "list", "list-one", ...scope, "--cursor", ""],
  ])("rejects invalid scope/filter/paging without HTTP: %j", async (...args) => {
    const result = await runCli(args);
    expectFailure(result, /scope|zone-id|kind|page|cursor/iu);
  });

  it("does not infer account identity from missing configuration", async () => {
    const result = await runCli(["lists", "list", "--scope", "account", "--json"]);
    expectFailure(result, /account id/iu);
  });

  it("fails missing credentials without HTTP or a successful empty result", async () => {
    const result = await runCli(["lists", "list", ...scope], [], false);
    expectFailure(result, /credential|api.token|authentication/iu);
  });

  it.each([403, 404, 410, 500])("preserves HTTP %s as failed metadata inventory", async (status) => {
    const result = await runCli(["lists", "list", ...scope], [{
      pathname: ACCOUNT_PATH, query: {}, status,
      body: { success: false, errors: [{ code: 12000, message: "Synthetic list access failure" }], result: null },
    }]);
    expectFailure(result, "Synthetic list access failure");
    expect(result.stderr).toContain(String(status));
    expect(result.stderr).toContain("12000");
    if (status === 403) expect(result.stderr).toContain("Account Filter Lists Read");
    if (status === 410) expect(result.stderr).toContain("retired");
  });

  it.each([403, 404, 410, 503])("preserves HTTP %s from item reads without emitting metadata as partial success", async (status) => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("ip", 3)),
      { pathname: itemsPath, query: { per_page: "100" }, status, body: { success: false, errors: [{ code: 12001, message: "Synthetic item access failure" }], result: null } },
    ]);
    expectFailure(result, "Synthetic item access failure");
    expect(result.stderr).toContain(String(status));
    if (status === 403) expect(result.stderr).toContain("Account Filter Lists Read");
  });

  it("keeps HTML 524 upstream timeout distinct from an empty list", async () => {
    const result = await runCli(["lists", "list", ...scope], [{ pathname: ACCOUNT_PATH, query: {}, status: 524, rawBody: "<html>Upstream timeout</html>" }]);
    expectFailure(result, /524/iu);
  });

  it("preserves an API denial inside HTTP 200", async () => {
    const result = await runCli(["lists", "get", "list-one", ...scope], [{
      pathname: listPath, query: {}, body: { success: false, errors: [{ code: 10000, message: "Token cannot access this list" }], result: null },
    }]);
    expectFailure(result, "Token cannot access this list");
  });

  it.each([
    null,
    {},
    { success: true, result: null },
    { success: true, result: [{}] },
    { success: true, result: [list("unsupported", 0)] },
    { success: true, result: [list("ip", -1)] },
    { success: true, errors: "invalid", result: [] },
    { success: true, result: [], result_info: { cursors: { after: "unexpected-continuation" } } },
  ])("fails malformed or incomplete successful metadata: %j", async (body) => {
    const result = await runCli(["lists", "list", ...scope], [{ pathname: ACCOUNT_PATH, query: {}, body }]);
    expectFailure(result, /malformed|incomplete/iu);
  });

  it.each([
    ["ip", [{ id: "wrong-kind", redirect: { source_url: "old.example.test", target_url: "https://new.example.test" } }], undefined],
    ["ip", [{ id: "bad", ip: 12 }], undefined],
    ["ip", [{}], undefined],
    ["ip", null, undefined],
    ["ip", [], { cursors: { after: 42 } }],
    ["redirect", [{ id: "bad-status", redirect: { source_url: "old.example.test", target_url: "https://new.example.test", status_code: 200 } }], undefined],
    ["redirect", [{ id: "bad-flag", redirect: { source_url: "old.example.test", target_url: "https://new.example.test", preserve_query_string: "true" } }], undefined],
    ["redirect", [{ id: "bad-target", redirect: { source_url: "old.example.test" } }], undefined],
  ])("fails malformed successful %s item content", async (kind, items, info) => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list(kind as string, 1)), itemsRoute(items, info),
    ]);
    expectFailure(result, /malformed/iu);
  });

  it("rejects silent empty results for a populated unfiltered list", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [metadataRoute(list("ip", 2)), itemsRoute([])]);
    expectFailure(result, /malformed|incomplete|count/iu);
  });

  it("rejects repeated item continuation cursors", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--all", "--per-page", "1"], [
      metadataRoute(list("ip", 3)),
      itemsRoute([{ id: "one", ip: "192.0.2.1" }], { cursors: { after: "repeated" } }, { per_page: "1" }),
      itemsRoute([{ id: "two", ip: "192.0.2.2" }], { cursors: { after: "repeated" } }, { per_page: "1", cursor: "repeated" }),
    ]);
    expectFailure(result, /cursor/iu);
  });

  it("rejects an API claim of more items without a continuation cursor", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--all"], [
      metadataRoute(list("ip", 2)),
      itemsRoute([{ id: "one", ip: "192.0.2.1" }], { has_more: true }),
    ]);
    expectFailure(result, /cursor|incomplete|malformed/iu);
  });

  it("rejects a bounded item page advertising more without a usable continuation cursor", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("ip", 2)),
      itemsRoute([{ id: "one", ip: "192.0.2.1" }], { cursors: { after: "" }, has_more: true }),
    ]);
    expectFailure(result, /cursor|incomplete|malformed/iu);
  });

  it("fails a later item page without printing the earlier page as success", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--all", "--per-page", "1"], [
      metadataRoute(list("ip", 2)),
      itemsRoute([{ id: "one", ip: "192.0.2.1" }], { cursors: { after: "next" } }, { per_page: "1" }),
      { pathname: itemsPath, query: { per_page: "1", cursor: "next" }, status: 500, body: { success: false, errors: [{ code: 12002, message: "Later page failed" }], result: null } },
    ]);
    expectFailure(result, "Later page failed");
  });

  it("redacts reflected credentials, URL userinfo, and secret query values while preserving redirect behavior", async () => {
    const items = [{ id: "secret-redirect", comment: "Configured inventory-test-token", redirect: {
      source_url: "alice:source-password@old.example.test/path?token=source-query-secret&language=en",
      target_url: "https://bob:target-password@new.example.test/path?api_key=target-query-secret&safe=visible",
      status_code: 301, include_subdomains: true, subpath_matching: true,
      preserve_path_suffix: false, preserve_query_string: true,
    } }];
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("redirect", 1, { description: "inventory-test-token" })), itemsRoute(items),
    ]);
    const output = parseSuccess(result);
    for (const secret of ["inventory-test-token", "alice", "source-password", "source-query-secret", "bob", "target-password", "target-query-secret"]) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
    expect(output.items[0].redirect).toMatchObject({ status_code: 301, include_subdomains: true, subpath_matching: true, preserve_path_suffix: false, preserve_query_string: true });
    expect(result.stdout).toContain("old.example.test/path");
    expect(result.stdout).toContain("new.example.test/path");
    expect(result.stdout).toContain("language=en");
    expect(result.stdout).toContain("safe=visible");
    expect(result.stdout).toContain("[REDACTED]");
  });

  it("redacts configured credentials and URL credentials reflected in upstream errors", async () => {
    const result = await runCli(["lists", "list", ...scope], [{
      pathname: ACCOUNT_PATH, query: {}, status: 403,
      body: { success: false, errors: [{ code: 12003, message: "Denied inventory-test-token at https://alice:password@example.test/?token=query-secret&safe=visible" }], result: null },
    }]);
    expectFailure(result, "Denied");
    for (const secret of ["inventory-test-token", "alice", "password", "query-secret"]) expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stderr).toContain("safe=visible");
  });

  it("redacts scheme-less redirect URLs from later-page diagnostics without printing partial JSON", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--all"], [
      metadataRoute(list("redirect", 2)),
      itemsRoute([{ id: "first", redirect: { source_url: "old.example.test/old", target_url: "https://new.example.test/new", preserve_query_string: false } }], { cursors: { after: "next" } }),
      { pathname: itemsPath, query: { per_page: "100", cursor: "next" }, status: 500, body: { success: false, errors: [{ code: 12004, message: "Invalid source URL alice:password@old.example.test/path?token=unconfigured-secret&safe=visible for list office_networks" }], result: null } },
    ]);
    expectFailure(result, "Invalid source URL");
    for (const secret of ["alice", "password", "unconfigured-secret"]) expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stderr).toContain("old.example.test/path");
    expect(result.stderr).toContain("safe=visible");
    expect(result.stderr).toContain("for list office_networks");
  });

  it("does not include invalid upstream values in schema failure diagnostics", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("redirect", 1)),
      itemsRoute([{ id: "bad", redirect: { source_url: "old.example.test?token=do-not-leak", target_url: 123 } }]),
    ]);
    expectFailure(result, /malformed/iu);
    expect(result.stderr).not.toContain("do-not-leak");
  });

  it("preserves comments and redacts apostrophe-bearing redirect URLs in JSON", async () => {
    const comment = "Contact owner@example.test";
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("redirect", 1)),
      itemsRoute([{ id: "apostrophe", comment, redirect: { source_url: "old.example.test/O'Brien?token=path-secret", target_url: "https://new.example.test/O'Brien?api_key=target-secret", preserve_query_string: false } }]),
    ]);
    const output = parseSuccess(result);
    expect(output.items[0].comment).toBe(comment);
    expect(output.items[0].redirect.preserve_query_string).toBe(false);
    expect(result.stdout).toContain("O'Brien");
    expect(result.stdout).not.toContain("path-secret");
    expect(result.stdout).not.toContain("target-secret");
  });

  it("redacts apostrophe-bearing URLs in error diagnostics", async () => {
    const result = await runCli(["lists", "list", ...scope], [{
      pathname: ACCOUNT_PATH, query: {}, status: 500,
      body: { success: false, errors: [{ code: 12005, message: "Failed old.example.test/O'Brien?token=diagnostic-path-secret for office_networks" }], result: null },
    }]);
    expectFailure(result, "Failed");
    expect(result.stderr).not.toContain("diagnostic-path-secret");
    expect(result.stderr).toContain("O'Brien");
  });

  it.each(["   ", "inventory-test-token-next"])("fails a bounded cursor that cannot be reused safely: %s", async (after) => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope], [
      metadataRoute(list("ip", 2)), itemsRoute([{ id: "one", ip: "192.0.2.1" }], { cursors: { after } }),
    ]);
    expectFailure(result, "--all");
    expect(result.stderr).not.toContain("inventory-test-token");
  });

  it("resumes a final item page with a collection-wide total", async () => {
    const result = await runCli(["lists", "items", "list", "list-one", ...scope, "--cursor", "after-first"], [
      metadataRoute(list("ip", 2)), itemsRoute([{ id: "two", ip: "192.0.2.2" }], { total_count: 2 }, { per_page: "100", cursor: "after-first" }),
    ]);
    expect(parseSuccess(result)).toMatchObject({ items: [{ id: "two" }], truncated: false });
  });

  it.each([
    ["lists", "list"], ["lists", "get"], ["lists", "items", "list"],
  ])("documents account scope and JSON in command help: %j", async (...command) => {
    const result = await runCli([...command, "--help"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("--scope");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--account");
  });
});
