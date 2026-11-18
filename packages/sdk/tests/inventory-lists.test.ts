import { describe, expect, it } from "bun:test";
import { CloudflareClient, CloudflareError, describeError } from "../src/index.js";
import * as sdk from "../src/index.js";

const target = { scope: "account" as const, accountId: "account-1" };
const root = "/client/v4/accounts/account-1/rules/lists";
const list = { id: "list-1", name: "office", kind: "ip", num_items: 2, num_referencing_filters: 1, description: "Office IPs", created_on: "2026-01-01T00:00:00Z", modified_on: "2026-01-02T00:00:00Z", future: { keep: true } };
const ip = { id: "item-1", ip: "192.0.2.1", comment: "Office", created_on: "2026-01-01T00:00:00Z" };
const redirect = { id: "item-r", comment: "Legacy URLs", redirect: { source_url: "old.example.com/docs/", target_url: "https://new.example.com/docs/", include_subdomains: true, subpath_matching: true, preserve_path_suffix: false, preserve_query_string: true, status_code: 308, future_behavior: "keep" } };

function client(defaults: { accountId?: string; zoneId?: string } = { accountId: "default-account", zoneId: "default-zone" }) {
  return new CloudflareClient({ auth: { type: "apiToken", token: "synthetic-list-token" }, baseUrl: "https://api.example.test", ...defaults });
}
function envelope(result: unknown, result_info?: unknown) {
  return { success: true, errors: [], messages: [], result, ...(result_info === undefined ? {} : { result_info }) };
}
type Route = { path: string; query?: Record<string, string>; result?: unknown; info?: unknown; body?: unknown; raw?: string; status?: number };
async function withRoutes<T>(routes: Route[], work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const route = routes[calls++];
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(route, `Unexpected GET ${url.pathname}`).toBeDefined();
    expect(url.pathname).toBe(route!.path);
    expect(Object.fromEntries(url.searchParams)).toEqual(route!.query ?? {});
    return new Response(route!.raw ?? JSON.stringify(route!.body ?? envelope(route!.result, route!.info)), { status: route!.status ?? 200 });
  }) as typeof fetch;
  try {
    const result = await work();
    expect(calls).toBe(routes.length);
    return result;
  } finally { globalThis.fetch = original; }
}
function metadata(result = list): Route { return { path: `${root}/${result.id}`, result }; }
function items(result: unknown, info?: unknown): Route { return { path: `${root}/list-1/items`, query: { per_page: "100" }, result, info }; }

describe("account Lists inventory metadata", () => {
  it("exports native list schemas and returns explicit account identity", async () => {
    expect(sdk.InventoryListSchema).toBeDefined();
    expect(sdk.InventoryListItemSchema).toBeDefined();
    await withRoutes([{ path: root, result: [list] }], async () => {
      expect(await client().inventory.listLists(target)).toEqual({ scope: "account", accountId: "account-1", lists: [list], resultInfo: { page: 1, per_page: 100, count: 1, total_count: 1, total_pages: 1 }, truncated: false });
    });
  });

  it("filters metadata locally before paging and never sends undocumented queries", async () => {
    const lists = [{ ...list, id: "r", kind: "redirect" }, { ...list, id: "i1" }, { ...list, id: "other", name: "office_extra" }, { ...list, id: "i2" }];
    await withRoutes([{ path: root, result: lists }], async () => {
      expect(await client().inventory.listLists(target, { kind: "ip", name: "office", perPage: 1, page: 2 })).toMatchObject({ lists: [{ id: "i2" }], resultInfo: { page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 }, truncated: false });
    });
  });

  it("bounds default metadata output and optionally returns all matches", async () => {
    const lists = Array.from({ length: 101 }, (_, i) => ({ ...list, id: `l-${i}` }));
    await withRoutes([{ path: root, result: lists }, { path: root, result: lists }], async () => {
      const page = await client().inventory.listLists(target);
      expect(page.lists).toHaveLength(100);
      expect(page.truncated).toBe(true);
      const all = await client().inventory.listLists(target, { all: true });
      expect(all.lists).toHaveLength(101);
      expect(all.truncated).toBe(false);
      expect(all.resultInfo).toMatchObject({ page: 1, per_page: 101, count: 101, total_count: 101, total_pages: 1 });
    });
  });

  it("returns empty account metadata and filter matches without inventing lists", async () => {
    await withRoutes([{ path: root, result: [] }, { path: root, result: [list] }], async () => {
      expect((await client().inventory.listLists(target)).lists).toEqual([]);
      expect((await client().inventory.listLists(target, { name: "missing" })).lists).toEqual([]);
    });
  });

  it("reads metadata detail and configured account only after explicit account scope", async () => {
    await withRoutes([metadata(), { path: "/client/v4/accounts/default-account/rules/lists", result: [] }], async () => {
      expect(await client().inventory.getList("list-1", target)).toEqual({ scope: "account", accountId: "account-1", list });
      expect(await client().inventory.listLists({ scope: "account" })).toMatchObject({ accountId: "default-account" });
    });
    await expect(client({ zoneId: "zone-only" }).inventory.listLists({ scope: "account" })).rejects.toThrow("Account ID");
  });

  it.each([{}, { scope: "zone" }, { scope: "account", zoneId: "wrong" }, { scope: "account", accountId: " " }])("rejects invalid account scope without requests: %j", async (scope) => {
    await withRoutes([], async () => {
      for (const read of [() => client().inventory.listLists(scope as never), () => client().inventory.getList("list-1", scope as never), () => client().inventory.listListItems("list-1", scope as never)]) {
        await expect(read()).rejects.toMatchObject({ code: "CONFIG_ERROR" });
      }
    });
  });

  it.each([{ perPage: 0 }, { perPage: 501 }, { perPage: 1.5 }, { page: 0 }, { page: 1.5 }, { page: 2, all: true }, { kind: "managed" }, { name: " " }])("rejects metadata options before requests: %j", async (options) => {
    await withRoutes([], async () => { await expect(client().inventory.listLists(target, options as never)).rejects.toMatchObject({ code: "CONFIG_ERROR" }); });
  });

  it.each([{ cursors: { after: "next" } }, { total_count: 3 }, { page: 2 }, { has_more: true }])("rejects upstream metadata incompleteness: %j", async (info) => {
    await withRoutes([{ path: root, result: [list], info }], async () => { await expect(client().inventory.listLists(target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("rejects detail identity mismatch", async () => {
    await withRoutes([{ path: `${root}/list-1`, result: { ...list, id: "wrong-list" } }], async () => { await expect(client().inventory.getList("list-1", target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });
});

describe("typed Lists items and pagination", () => {
  it("returns one bounded page with list metadata and explicit continuation", async () => {
    await withRoutes([metadata(), items([ip], { cursors: { after: "opaque next", before: "previous" } })], async () => {
      expect(await client().inventory.listListItems("list-1", target)).toEqual({ scope: "account", accountId: "account-1", list, items: [ip], resultInfo: { cursors: { after: "opaque next", before: "previous" } }, truncated: true });
    });
  });

  it("collects multiple pages in native order and preserves IPs and comments", async () => {
    const second = { id: "item-2", ip: "2001:db8::/32", comment: "IPv6 network", future: "keep" };
    await withRoutes([metadata(), { ...items([ip], { cursors: { after: "next" } }), query: { per_page: "1" } }, { ...items([second], { cursors: { before: "previous" } }), query: { per_page: "1", cursor: "next" } }], async () => {
      const result = await client().inventory.listListItems("list-1", target, { all: true, perPage: 1 });
      expect(result.items).toEqual([ip, second]);
      expect(result.truncated).toBe(false);
      expect(result.resultInfo).toEqual({ cursors: { before: "previous" } });
    });
  });

  it("preserves all redirect behavior parameters and scheme-less source URLs", async () => {
    const redirectList = { ...list, kind: "redirect", num_items: 1 };
    await withRoutes([metadata(redirectList), items([redirect])], async () => {
      expect(await client().inventory.listListItems("list-1", target, { all: true })).toMatchObject({ list: redirectList, items: [redirect], truncated: false });
    });
  });

  it.each([
    ["hostname", { id: "h1", hostname: { url_hostname: "*.example.com", exclude_exact_hostname: false }, comment: "Subdomains" }],
    ["asn", { id: "a1", asn: 64500, comment: "Network" }],
  ])("reads documented %s kind rather than calling it empty", async (kind, item) => {
    await withRoutes([metadata({ ...list, kind: String(kind), num_items: 1 }), items([item])], async () => {
      expect((await client().inventory.listListItems("list-1", target)).items).toEqual([item]);
    });
  });

  it("preserves search and opaque initial cursor on every page; all collects suffix", async () => {
    await withRoutes([metadata(), { ...items([ip], { cursors: { after: "second" } }), query: { search: "192.0.", cursor: " opaque cursor ", per_page: "500" } }, { ...items([], {}), query: { search: "192.0.", cursor: "second", per_page: "500" } }], async () => {
      const result = await client().inventory.listListItems("list-1", target, { search: "192.0.", cursor: " opaque cursor ", perPage: 500, all: true });
      expect(result.items).toEqual([ip]);
      expect(result.truncated).toBe(false);
    });
  });

  it("distinguishes a known empty list from an empty search result", async () => {
    await withRoutes([metadata({ ...list, num_items: 0 }), items([]), metadata(), { ...items([]), query: { per_page: "100", search: "203.0.113." } }], async () => {
      expect(await client().inventory.listListItems("list-1", target)).toMatchObject({ list: { id: "list-1", num_items: 0 }, items: [], truncated: false });
      expect(await client().inventory.listListItems("list-1", target, { search: "203.0.113." })).toMatchObject({ list: { num_items: 2 }, items: [], truncated: false });
    });
  });

  it.each([[], [ip], [ip, ip, ip]])("fails unfiltered terminal count mismatch rather than silently completing %j", async (page) => {
    await withRoutes([metadata(), items(page)], async () => { await expect(client().inventory.listListItems("list-1", target, { all: true })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it.each([{ perPage: 0 }, { perPage: 501 }, { perPage: 1.5 }, { cursor: "" }, { search: "" }])("validates item options before any request: %j", async (options) => {
    await withRoutes([], async () => { await expect(client().inventory.listListItems("list-1", target, options)).rejects.toMatchObject({ code: "CONFIG_ERROR" }); });
  });

  it("rejects repeated cursors including an initial cursor", async () => {
    await withRoutes([metadata(), { ...items([ip], { cursors: { after: "same" } }), query: { per_page: "100", cursor: "same" } }], async () => { await expect(client().inventory.listListItems("list-1", target, { all: true, cursor: "same" })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("rejects cycles after multiple pages", async () => {
    await withRoutes([metadata(), items([ip], { cursors: { after: "a" } }), { ...items([ip], { cursors: { after: "b" } }), query: { per_page: "100", cursor: "a" } }, { ...items([ip], { cursors: { after: "a" } }), query: { per_page: "100", cursor: "b" } }], async () => { await expect(client().inventory.listListItems("list-1", target, { all: true })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it.each([{ has_more: true }, { truncated: true }, { count: 2 }, { total_count: 3 }, { total_pages: 2 }])("requires a cursor for complete collection when more is advertised: %j", async (info) => {
    await withRoutes([metadata(), items([ip], info)], async () => { await expect(client().inventory.listListItems("list-1", target, { all: true })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it.each([{ has_more: true }, { truncated: true }, { count: 2 }, { total_count: 3 }, { total_pages: 2 }, { cursors: { after: "" }, has_more: true }])("rejects unusable bounded continuation when more is advertised: %j", async (info) => {
    await withRoutes([metadata(), items([ip], info)], async () => { await expect(client().inventory.listListItems("list-1", target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("never returns partial results after a later failed page", async () => {
    await withRoutes([metadata(), items([ip], { cursors: { after: "next" } }), { ...items(null), query: { per_page: "100", cursor: "next" }, status: 500, body: { success: false, errors: [{ code: 999, message: "Backend failure" }], result: null } }], async () => { await expect(client().inventory.listListItems("list-1", target, { all: true })).rejects.toMatchObject({ statusCode: 500, code: "999" }); });
  });

  it.each([false, true])("does not compare a resumed suffix to the collection-wide total (all=%s)", async (all) => {
    await withRoutes([metadata(), { ...items([{ ...ip, id: "second" }], { total_count: 2 }), query: { per_page: "100", cursor: "after-first" } }], async () => {
      const result = await client().inventory.listListItems("list-1", target, { cursor: "after-first", all });
      expect(result.items).toEqual([{ ...ip, id: "second" }]);
      expect(result.truncated).toBe(false);
    });
  });

  it.each(["   ", "synthetic-list-token-next", "https://alice:password@example.com/?token=cursor-secret"])("fails bounded continuation that cannot round-trip safely: %s", async (after) => {
    await withRoutes([metadata(), items([ip], { cursors: { after } })], async () => {
      await expect(client().inventory.listListItems("list-1", target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE", message: expect.stringContaining("--all") });
    });
  });

  it("follows a credential-bearing cursor internally with all instead of exporting it for reuse", async () => {
    const after = "synthetic-list-token-next";
    await withRoutes([metadata(), items([ip], { cursors: { after } }), { ...items([{ ...ip, id: "second" }]), query: { per_page: "100", cursor: after } }], async () => {
      const result = await client().inventory.listListItems("list-1", target, { all: true });
      expect(result.items).toHaveLength(2);
      expect(result.truncated).toBe(false);
      expect(JSON.stringify(result)).not.toContain("synthetic-list-token");
    });
  });
});

describe("Lists failures and redaction", () => {
  it.each([403, 404, 410, 500])("preserves HTTP %s and documented permission hints", async (status) => {
    const body = { success: false, errors: [{ code: 10000, message: "List read failed" }], result: null };
    await withRoutes([{ path: `${root}/list-1`, status, body }], async () => {
      try { await client().inventory.getList("list-1", target); throw new Error("expected error"); }
      catch (error) {
        expect(error).toBeInstanceOf(CloudflareError);
        expect(error).toMatchObject({ code: "10000", statusCode: status, requestMethod: "GET", requestPath: `${root}/list-1` });
        if (status === 403) expect(describeError(error)).toContain("Account Filter Lists Read");
        if (status === 410) expect(describeError(error)).toContain("retired");
      }
    });
  });

  it("missing list metadata fails before an items read", async () => {
    await withRoutes([{ path: `${root}/missing`, status: 404, body: { success: false, errors: [{ code: 10002, message: "List not found" }], result: null } }], async () => { await expect(client().inventory.listListItems("missing", target)).rejects.toMatchObject({ statusCode: 404 }); });
  });

  it("preserves HTML upstream failure status", async () => {
    await withRoutes([{ path: root, status: 524, raw: "<html>Gateway timeout</html>" }], async () => { await expect(client().inventory.listLists(target)).rejects.toMatchObject({ statusCode: 524 }); });
  });

  it.each([null, {}, { success: true, result: null }, { success: true, result: [{}] }, { success: true, result: [{ ...list, kind: "managed" }] }, { success: true, result: [{ ...list, num_items: -1 }] }, { success: true, result: [], errors: "broken" }])("rejects malformed metadata successes without payload disclosure: %j", async (body) => {
    await withRoutes([{ path: root, body }], async () => { await expect(client().inventory.listLists(target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it.each([
    ["ip", { id: "bad", ip: 1 }], ["ip", redirect], ["redirect", { ...redirect, redirect: { source_url: "old.example.com" } }],
    ["redirect", { ...redirect, redirect: { ...redirect.redirect, status_code: 300 } }], ["redirect", { ...redirect, redirect: { ...redirect.redirect, preserve_path_suffix: "true" } }],
    ["hostname", { id: "h", hostname: "example.com" }], ["asn", { id: "a", asn: -1 }],
  ])("rejects malformed %s items", async (kind, item) => {
    await withRoutes([metadata({ ...list, kind: String(kind), num_items: 1 }), items([item])], async () => { await expect(client().inventory.listListItems("list-1", target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("rejects malformed cursors and HTTP-200 API failures", async () => {
    await withRoutes([metadata(), items([ip], { cursors: { after: 1 } }), { path: root, body: { success: false, result: null, errors: [{ code: 1234, message: "Denied" }] } }], async () => {
      await expect(client().inventory.listListItems("list-1", target)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
      await expect(client().inventory.listLists(target)).rejects.toMatchObject({ code: "1234", message: "Denied" });
    });
  });

  it.each(["https://alice:password@old.example.com/path?token=query-secret&lang=en", "//alice:password@old.example.com/path?token=query-secret&lang=en", "alice:password@old.example.com/path?token=query-secret&lang=en"])("redacts redirect URL credentials and secret query values: %s", async (source_url) => {
    const sensitive = { ...redirect, api_token: "field-secret", comment: "synthetic-list-token", redirect: { ...redirect.redirect, source_url, target_url: "https://new.example.com/?access_token=target-secret&lang=en" } };
    await withRoutes([metadata({ ...list, kind: "redirect", num_items: 1 }), items([sensitive])], async () => {
      const result = await client().inventory.listListItems("list-1", target);
      const json = JSON.stringify(result);
      for (const secret of ["alice", "password", "query-secret", "target-secret", "synthetic-list-token", "field-secret"]) expect(json).not.toContain(secret);
      expect(json).toContain("old.example.com");
      expect(json).toContain("lang=en");
      expect(sensitive.redirect.source_url).toBe(source_url);
    });
  });

  it("redacts reflected credentials and URL secrets from diagnostic messages", async () => {
    await withRoutes([{ path: root, status: 403, body: { success: false, result: null, errors: [{ code: 1234, message: "Denied synthetic-list-token at https://alice:password@example.com/?token=error-secret" }] } }], async () => {
      try { await client().inventory.listLists(target); throw new Error("expected error"); }
      catch (error) {
        const text = describeError(error);
        for (const secret of ["synthetic-list-token", "alice", "password", "error-secret"]) expect(text).not.toContain(secret);
        expect(text).toContain("Denied");
      }
    });
  });

  it.each([
    "alice:password@old.example.com/path?token=error-secret&lang=en",
    "//alice:password@old.example.com/path?token=error-secret&lang=en",
    "old.example.com/path?access_token=error-secret&lang=en",
  ])("redacts a scheme-less redirect URL reflected in diagnostics: %s", async (source) => {
    const message = `Invalid source_url: ${source}. Keep list name office_networks, status 301 and safe.example.com/path?lang=en unchanged.`;
    await withRoutes([{ path: root, status: 403, body: { success: false, result: null, errors: [{ code: 1234, message }] } }], async () => {
      try { await client().inventory.listLists(target); throw new Error("expected error"); }
      catch (error) {
        const text = describeError(error);
        for (const secret of ["alice", "password", "error-secret"]) expect(text).not.toContain(secret);
        expect(text).toContain("old.example.com/path");
        expect(text).toContain("lang=en");
        expect(text).toContain("Keep list name office_networks, status 301 and safe.example.com/path?lang=en unchanged.");
      }
    });
  });

  it.each(["https://old.example.com/O'Brien?token=apostrophe-secret", "old.example.com/O'Brien?token=apostrophe-secret", "//old.example.com/O'Brien?token=apostrophe-secret"])("redacts complete URL fields containing a legal apostrophe: %s", async (source_url) => {
    await withRoutes([metadata({ ...list, kind: "redirect", num_items: 1 }), items([{ ...redirect, redirect: { ...redirect.redirect, source_url, target_url: "https://new.example.com/O'Brien?api_key=target-apostrophe-secret&lang=en" } }])], async () => {
      const result = await client().inventory.listListItems("list-1", target);
      const json = JSON.stringify(result);
      expect(json).not.toContain("apostrophe-secret");
      expect(result.items[0]?.redirect).toMatchObject({ preserve_path_suffix: false, status_code: 308 });
      expect(json).toContain("O'Brien");
      expect(json).toContain("lang=en");
    });
  });

  it.each(["https://old.example.com/O'Brien?token=diagnostic-secret", "old.example.com/O'Brien?token=diagnostic-secret"])("redacts apostrophe-bearing URLs reflected in diagnostics: %s", async (source) => {
    await withRoutes([{ path: root, status: 403, body: { success: false, result: null, errors: [{ code: 1234, message: `Failed URL ${source} for list office_networks` }] } }], async () => {
      try { await client().inventory.listLists(target); throw new Error("expected error"); }
      catch (error) {
        const text = describeError(error);
        expect(text).not.toContain("diagnostic-secret");
        expect(text).toContain("O'Brien");
        expect(text).toContain("for list office_networks");
      }
    });
  });

  it("preserves bare email addresses in comments and existing Rulesets fields", async () => {
    const comment = "Contact owner@example.test or help@example.test.";
    await withRoutes([metadata({ ...list, num_items: 1 }), items([{ ...ip, comment }]), { path: "/client/v4/accounts/account-1/rulesets/ruleset-1", result: { id: "ruleset-1", description: comment, rules: [{ id: "rule-1", action: "block", description: comment }] } }], async () => {
      const result = await client().inventory.listListItems("list-1", target);
      expect(result.items[0]?.comment).toBe(comment);
      const ruleset = await client().inventory.getRuleset("ruleset-1", target);
      expect(ruleset.ruleset.description).toBe(comment);
      expect(ruleset.ruleset.rules[0]?.description).toBe(comment);
    });
  });
});
