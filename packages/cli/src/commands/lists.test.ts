import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { run, type StricliProcess } from "@stricli/core";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";

const sdk = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  inventory: { listLists: vi.fn(), getList: vi.fn(), listListItems: vi.fn() },
}));

vi.mock("@cloudflare-ai-toolkit/sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@cloudflare-ai-toolkit/sdk")>(),
  loadConfig: sdk.loadConfig,
  CloudflareClient: class { inventory = sdk.inventory; },
}));

let app: typeof import("../app.js").app;
let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;
let exit: MockInstance<typeof process.exit>;

beforeAll(async () => {
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  app = (await import("../app.js")).app;
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const method of Object.values(sdk.inventory)) method.mockReset();
  sdk.loadConfig.mockResolvedValue({
    auth: { type: "apiToken", token: "test-token" },
    baseUrl: "https://api.cloudflare.com",
    accountId: "ambient-account",
    zoneId: "ambient-zone",
  });
});

afterAll(() => { log.mockRestore(); error.mockRestore(); exit.mockRestore(); });

async function invoke(args: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const context: StricliProcess = {
    stdout: { write: (value) => { stdout.push(value); } },
    stderr: { write: (value) => { stderr.push(value); } },
    env: { STRICLI_NO_COLOR: "1", STRICLI_SKIP_VERSION_CHECK: "1" },
    exitCode: 0,
  };
  await run(app, args, { process: context });
  return {
    stdout: [...stdout, ...log.mock.calls.map((call) => String(call[0]))].join("\n"),
    stderr: [...stderr, ...error.mock.calls.map((call) => String(call[0]))].join("\n"),
    code: Number(exit.mock.calls.at(-1)?.[0] ?? context.exitCode),
  };
}

const list = { id: "ip-list", name: "office", kind: "ip", num_items: 0 };

describe("account Lists inventory commands", () => {
  it("forwards exact metadata filters and local paging in explicit account scope", async () => {
    const result = { scope: "account", accountId: "a", lists: [list], resultInfo: { page: 2, per_page: 3, count: 1, total_count: 4, total_pages: 2 }, truncated: false };
    sdk.inventory.listLists.mockResolvedValueOnce(result);
    const output = await invoke(["lists", "list", "--scope", "account", "--account-id", "a", "--name", "office", "--kind", "ip", "--page", "2", "--per-page", "3", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual(result);
    expect(output.stderr).toBe("");
    expect(sdk.inventory.listLists).toHaveBeenCalledWith({ scope: "account", accountId: "a" }, { name: "office", kind: "ip", page: 2, perPage: 3, all: false });
  });

  it("leaves default account resolution to SDK and never forwards ambient zone", async () => {
    sdk.inventory.listLists.mockResolvedValueOnce({ scope: "account", accountId: "ambient-account", lists: [], resultInfo: {}, truncated: false });
    const output = await invoke(["lists", "list", "--scope", "account", "--all", "--json"]);
    expect(output.code).toBe(0);
    expect(sdk.inventory.listLists).toHaveBeenCalledWith({ scope: "account", accountId: undefined }, { name: undefined, kind: undefined, page: undefined, perPage: undefined, all: true });
    expect(output.stderr).toBe("");
  });

  it("forwards item search, opaque cursor and optional complete suffix collection", async () => {
    const result = { scope: "account", accountId: "a", list, items: [], resultInfo: {}, truncated: false };
    sdk.inventory.listListItems.mockResolvedValueOnce(result);
    const output = await invoke(["lists", "items", "list", "ip-list", "--scope", "account", "--accountId", "a", "--search", "192.0.2.", "--cursor", "opaque+/=cursor", "--perPage", "500", "--all", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual(result);
    expect(output.stderr).toBe("");
    expect(sdk.inventory.listListItems).toHaveBeenCalledWith("ip-list", { scope: "account", accountId: "a" }, { search: "192.0.2.", cursor: "opaque+/=cursor", perPage: 500, all: true });
  });

  it("returns detail with list identity and preserves native fields", async () => {
    const result = { scope: "account", accountId: "a", list: { ...list, description: "Office access", future: true } };
    sdk.inventory.getList.mockResolvedValueOnce(result);
    const output = await invoke(["lists", "get", "ip-list", "--scope", "account", "--account-id", "a", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual(result);
    expect(sdk.inventory.getList).toHaveBeenCalledWith("ip-list", { scope: "account", accountId: "a" });
  });

  it("preserves redirect parameters in readable output", async () => {
    sdk.inventory.listListItems.mockResolvedValueOnce({ scope: "account", accountId: "a", list: { id: "redirects", name: "old_paths", kind: "redirect", num_items: 1 }, items: [{ id: "item", redirect: { source_url: "example.com/old", target_url: "https://example.com/new", status_code: 308, include_subdomains: true, subpath_matching: true, preserve_path_suffix: false, preserve_query_string: true } }], resultInfo: {}, truncated: false });
    const output = await invoke(["lists", "items", "list", "redirects", "--scope", "account"]);
    expect(output.code).toBe(0);
    expect(output.stdout).toContain("example.com/old");
    expect(output.stdout).toContain('"preserve_path_suffix": false');
    expect(output.stdout).toContain('"status_code": 308');
  });

  for (const kind of ["ip", "redirect", "hostname", "asn"]) {
    it(`accepts documented list kind ${kind}`, async () => {
      sdk.inventory.listLists.mockResolvedValueOnce({ lists: [], resultInfo: {}, truncated: false });
      const output = await invoke(["lists", "list", "--scope", "account", "--kind", kind, "--json"]);
      expect(output.code).toBe(0);
      expect(sdk.inventory.listLists).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind }));
    });
  }

  for (const route of [["list"], ["get", "id"], ["items", "list", "id"]]) {
    it(`requires account scope for ${route.join(" ")}`, async () => {
      const output = await invoke(["lists", ...route, "--json"]);
      expect(output.code).not.toBe(0);
      expect(output.stderr).toContain("scope");
      expect(sdk.loadConfig).not.toHaveBeenCalled();
    });
  }

  for (const flags of [["--scope", "zone"], ["--scope", "global"], ["--scope", "account", "--zone-id", "z"]]) {
    it(`rejects non-account targeting ${flags.join(" ")}`, async () => {
      const output = await invoke(["lists", "list", ...flags, "--json"]);
      expect(output.code).not.toBe(0);
      expect(output.stdout).toBe("");
      expect(sdk.loadConfig).not.toHaveBeenCalled();
    });
  }

  for (const route of [["list"], ["items", "list", "id"]]) {
    for (const perPage of ["0", "501", "1.5", "1oops", "-1"]) {
      it(`rejects invalid page size ${perPage} on ${route.join(" ")}`, async () => {
        const output = await invoke(["lists", ...route, "--scope", "account", "--per-page", perPage]);
        expect(output.code).not.toBe(0);
        expect(output.stderr).toContain("1-500");
        expect(sdk.loadConfig).not.toHaveBeenCalled();
      });
    }
  }

  for (const page of ["0", "1.5", "1oops", "9007199254740992"]) {
    it(`rejects invalid local metadata page ${page}`, async () => {
      const output = await invoke(["lists", "list", "--scope", "account", "--page", page]);
      expect(output.code).not.toBe(0);
      expect(sdk.loadConfig).not.toHaveBeenCalled();
    });
  }

  it("enumerates supported kinds without reading configuration", async () => {
    const output = await invoke(["lists", "list", "--scope", "account", "--kind", "managed"]);
    expect(output.code).not.toBe(0);
    expect(output.stderr).toMatch(/ip.*redirect.*hostname.*asn/u);
    expect(sdk.loadConfig).not.toHaveBeenCalled();
  });

  it("rejects all with a later metadata page before loading credentials", async () => {
    const output = await invoke(["lists", "list", "--scope", "account", "--page", "2", "--all", "--json"]);
    expect(output.code).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toMatch(/--all.*--page/u);
    expect(sdk.loadConfig).not.toHaveBeenCalled();
  });

  it("keeps metadata truncation diagnostic on stderr", async () => {
    sdk.inventory.listLists.mockResolvedValueOnce({ lists: [list], resultInfo: { page: 1, total_pages: 2 }, truncated: true });
    const output = await invoke(["lists", "list", "--scope", "account", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout).truncated).toBe(true);
    expect(output.stderr).toContain("--page");
    expect(output.stderr).toContain("--all");
  });

  it("never reflects opaque continuation contents into stderr", async () => {
    sdk.inventory.listListItems.mockResolvedValueOnce({ list, items: [], resultInfo: { cursors: { after: "opaque-secret-cursor" } }, truncated: true });
    const output = await invoke(["lists", "items", "list", "id", "--scope", "account", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout).resultInfo.cursors.after).toBe("opaque-secret-cursor");
    expect(output.stderr).toContain("--cursor");
    expect(output.stderr).toContain("--all");
    expect(output.stderr).not.toContain("opaque-secret-cursor");
  });

  it.each([403, 404, 410, 500])("reports HTTP %s as failure, never empty inventory", async (status) => {
    sdk.inventory.listListItems.mockRejectedValueOnce(new CloudflareError("Upstream list read failed", "1234", status));
    const output = await invoke(["lists", "items", "list", "id", "--scope", "account", "--json"]);
    expect(output.code).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("Upstream list read failed");
    expect(output.stderr).toContain("1234");
  });

  it("reports configuration errors with no result", async () => {
    sdk.loadConfig.mockRejectedValueOnce(new Error("No Cloudflare credentials configured"));
    const output = await invoke(["lists", "get", "id", "--scope", "account", "--json"]);
    expect(output.code).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("No Cloudflare credentials configured");
    expect(sdk.inventory.getList).not.toHaveBeenCalled();
  });

  it("help explains bounded defaults, search semantics and continuation", async () => {
    const output = await invoke(["lists", "items", "list", "--help"]);
    expect(output.code).toBe(0);
    expect(output.stdout).toMatch(/read.only/iu);
    expect(output.stdout).toContain("1-500");
    expect(output.stdout).toContain("100");
    expect(output.stdout).toContain("prefix");
    expect(output.stdout).toContain("substring");
    expect(output.stdout).toContain("remaining");
    expect(sdk.loadConfig).not.toHaveBeenCalled();
  });
});
