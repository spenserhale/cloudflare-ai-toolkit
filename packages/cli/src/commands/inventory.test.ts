import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { run, type StricliProcess } from "@stricli/core";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";

const sdk = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  inventory: {
    listRulesets: vi.fn(),
    getRuleset: vi.fn(),
    getPhaseEntrypoint: vi.fn(),
    getZoneSetting: vi.fn(),
    getBotManagement: vi.fn(),
    listWorkerRoutes: vi.fn(),
    listWorkerDomains: vi.fn(),
    listPageRules: vi.fn(),
    getManagedTransforms: vi.fn(),
    getUrlNormalization: vi.fn(),
  },
  listFirewallRules: vi.fn(),
}));

vi.mock("@cloudflare-ai-toolkit/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@cloudflare-ai-toolkit/sdk")>();
  return {
    ...original,
    loadConfig: sdk.loadConfig,
    CloudflareClient: class {
      inventory = sdk.inventory;
      listFirewallRules = sdk.listFirewallRules;
    },
  };
});

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
  sdk.listFirewallRules.mockReset();
  sdk.loadConfig.mockResolvedValue({
    auth: { type: "apiToken", token: "token" },
    baseUrl: "https://api.cloudflare.com",
    zoneId: "ambient-zone",
    accountId: "ambient-account",
  });
});

afterAll(() => {
  log.mockRestore();
  error.mockRestore();
  exit.mockRestore();
});

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

describe("Rulesets inventory commands", () => {
  it("forwards zone cursor paging and preserves the complete JSON wrapper", async () => {
    const result = {
      scope: "zone", zoneId: "z", rulesets: [{ id: "r", kind: "zone", phase: "http_request_origin" }],
      resultInfo: { cursors: { after: "next" } }, truncated: true,
    };
    sdk.inventory.listRulesets.mockResolvedValueOnce(result);
    const output = await invoke([
      "rulesets", "list", "--scope", "zone", "--zone-id", "z",
      "--cursor", "previous", "--per-page", "2", "--json",
    ]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual(result);
    expect(sdk.inventory.listRulesets).toHaveBeenCalledWith(
      { scope: "zone", zoneId: "z" }, { cursor: "previous", perPage: 2, all: false },
    );
    expect(output.stderr).toContain("--cursor");
    expect(output.stderr).toContain("--all");
    expect(output.stderr).toContain("next");
  });

  it("uses account scope without forwarding an ambient zone", async () => {
    sdk.inventory.listRulesets.mockResolvedValueOnce({ scope: "account", accountId: "ambient-account", rulesets: [], resultInfo: {}, truncated: false });
    const output = await invoke(["rulesets", "list", "--scope", "account", "--all", "--json"]);
    expect(output.code).toBe(0);
    expect(sdk.inventory.listRulesets).toHaveBeenCalledWith(
      { scope: "account", accountId: undefined }, { cursor: undefined, perPage: undefined, all: true },
    );
    expect(output.stderr).toBe("");
  });

  it("forwards a pinned version and keeps execute overrides in JSON", async () => {
    const result = {
      scope: "account", targetId: "a", ruleset: {
        id: "r", kind: "managed", phase: "http_request_firewall_managed", rules: [{
          id: "execute", action: "execute", enabled: true, order: 1,
          action_parameters: { id: "managed", version: "7", overrides: { rules: [{ id: "m", enabled: false }] } },
        }],
      },
    };
    sdk.inventory.getRuleset.mockResolvedValueOnce(result);
    const output = await invoke(["rulesets", "get", "r", "--scope", "account", "--account-id", "a", "--version", "7", "--json"]);
    expect(output.code).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual(result);
    expect(sdk.inventory.getRuleset).toHaveBeenCalledWith("r", { scope: "account", accountId: "a" }, "7");
    expect(output.stderr).toBe("");
  });

  it("preserves full nested origin parameters in text output", async () => {
    sdk.inventory.getRuleset.mockResolvedValueOnce({
      scope: "zone", targetId: "z", ruleset: { id: "r", rules: [{ id: "one", order: 1, action: "route", action_parameters: { origin: { host: "origin.example.com", port: 8443 }, host_header: "example.com" } }] },
    });
    const output = await invoke(["rulesets", "get", "r", "--scope", "zone", "--zone-id", "z"]);
    expect(output.code).toBe(0);
    expect(output.stdout).toContain("origin.example.com");
    expect(output.stdout).toContain("8443");
    expect(output.stdout).toContain("host_header");
    expect(output.stdout).toContain('"order": 1');
  });

  for (const route of [["list"], ["get", "r"], ["phases", "get", "http_request_origin"]]) {
    it(`requires explicit scope for ${route.join(" ")}`, async () => {
      const output = await invoke(["rulesets", ...route, "--json"]);
      expect(output.code).not.toBe(0);
      expect(output.stderr).toContain("scope");
      expect(sdk.loadConfig).not.toHaveBeenCalled();
    });
  }

  for (const flags of [
    ["--scope", "zone", "--account-id", "a"],
    ["--scope", "account", "--zone-id", "z"],
    ["--scope", "zone", "--zone-id", "z", "--account-id", "a"],
  ]) {
    it(`rejects conflicting target IDs: ${flags.join(" ")}`, async () => {
      const output = await invoke(["rulesets", "list", ...flags, "--json"]);
      expect(output.code).not.toBe(0);
      expect(output.stdout).toBe("");
      expect(output.stderr).toMatch(/scope|conflict/u);
      expect(sdk.loadConfig).not.toHaveBeenCalled();
      expect(sdk.inventory.listRulesets).not.toHaveBeenCalled();
    });
  }

  it("enumerates valid scope values", async () => {
    const output = await invoke(["rulesets", "list", "--scope", "global"]);
    expect(output.code).not.toBe(0);
    expect(output.stderr).toMatch(/zone.*account/u);
    expect(sdk.loadConfig).not.toHaveBeenCalled();
  });

  for (const value of ["0", "51", "1oops", "1.5", "-1"]) {
    it(`rejects invalid Rulesets page size ${value}`, async () => {
      const output = await invoke(["rulesets", "list", "--scope", "zone", "--per-page", value]);
      expect(output.code).not.toBe(0);
      expect(output.stderr).toContain("1-50");
      expect(sdk.loadConfig).not.toHaveBeenCalled();
    });
  }

  it("renders an absent phase separately from a present empty ruleset", async () => {
    sdk.inventory.getPhaseEntrypoint.mockResolvedValueOnce({
      scope: "zone", targetId: "z", phase: "http_request_origin", status: "absent",
      diagnostic: { statusCode: 404, code: "10003", message: "entrypoint not found" },
    });
    const absent = await invoke(["rulesets", "phases", "get", "http_request_origin", "--scope", "zone", "--zone-id", "z"]);
    expect(absent.code).toBe(0);
    expect(absent.stdout).toContain("absent");
    expect(absent.stdout).not.toContain("No rules");
    expect(sdk.inventory.getPhaseEntrypoint).toHaveBeenCalledWith("http_request_origin", { scope: "zone", zoneId: "z" });

    log.mockClear();
    sdk.inventory.getPhaseEntrypoint.mockResolvedValueOnce({
      scope: "zone", targetId: "z", phase: "http_request_origin", status: "present", ruleset: { id: "r", rules: [] },
    });
    const empty = await invoke(["rulesets", "phases", "get", "http_request_origin", "--scope", "zone", "--zone-id", "z"]);
    expect(empty.stdout).toContain("present");
    expect(empty.stdout).toContain('"rules": []');
    expect(empty.stdout).not.toContain("absent");
  });

  it.each([
    new CloudflareError("Forbidden", "9109", 403),
    new CloudflareError("Retired endpoint", "10020", 410),
    new Error("Malformed Rulesets response"),
  ])("reports read failures on stderr with exit 1: %s", async (failure) => {
    sdk.inventory.listRulesets.mockRejectedValueOnce(failure);
    const output = await invoke(["rulesets", "list", "--scope", "zone", "--json"]);
    expect(output.code).toBe(1);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain(failure.message);
    if (failure instanceof CloudflareError) expect(output.stderr).toContain(failure.code);
    if (failure instanceof CloudflareError && failure.statusCode === 403) expect(output.stderr).toContain("entitlement");
  });
});

describe("product inventory commands", () => {
  const cases = [
    { route: ["zones", "settings", "get", "ssl"], method: "getZoneSetting", args: ["ssl", "z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", setting: { id: "ssl", value: "strict" } } },
    { route: ["waf", "bot-management", "get"], method: "getBotManagement", args: ["z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", settings: { enable_js: true } } },
    { route: ["workers", "routes", "list"], method: "listWorkerRoutes", args: ["z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", routes: [{ id: "route", pattern: "example.com/*", script: "app" }] } },
    { route: ["workers", "domains", "list"], method: "listWorkerDomains", args: [{ accountId: "a", zoneId: "z" }], flags: ["--account-id", "a", "--zone-id", "z"], result: { scope: "account", accountId: "a", zoneId: "z", domains: [{ id: "domain", hostname: "example.com", service: "app", environment: "production" }] } },
    { route: ["page-rules", "list"], method: "listPageRules", args: ["z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", rules: [{ id: "page", priority: 1, order: 1, targets: [{ target: "url", constraint: { operator: "matches", value: "*example.com/*" } }], actions: [{ id: "forwarding_url", value: { url: "https://www.example.com/$1", status_code: 301 } }] }] } },
    { route: ["zones", "managed-transforms", "get"], method: "getManagedTransforms", args: ["z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", settings: { managed_request_headers: [{ id: "add_visitor_location_headers", enabled: true }] } } },
    { route: ["zones", "url-normalization", "get"], method: "getUrlNormalization", args: ["z"], flags: ["--zone-id", "z"], result: { scope: "zone", zoneId: "z", settings: { type: "cloudflare", scope: "both" } } },
  ] as const;

  for (const entry of cases) {
    it(`forwards ${entry.route.join(" ")} and outputs only its JSON wrapper`, async () => {
      sdk.inventory[entry.method].mockResolvedValueOnce(entry.result);
      const output = await invoke([...entry.route, ...entry.flags, "--json"]);
      expect(output.code).toBe(0);
      expect(output.stderr).toBe("");
      expect(JSON.parse(output.stdout)).toEqual(entry.result);
      expect(sdk.inventory[entry.method]).toHaveBeenCalledWith(...entry.args);
    });
  }

  it("does not use an ambient zone as a Worker domain filter", async () => {
    sdk.inventory.listWorkerDomains.mockResolvedValueOnce({ scope: "account", accountId: "ambient-account", domains: [] });
    const output = await invoke(["workers", "domains", "list", "--json"]);
    expect(output.code).toBe(0);
    expect(sdk.inventory.listWorkerDomains).toHaveBeenCalledWith({ accountId: undefined, zoneId: undefined });
  });

  it("leaves zone fallback to the SDK when no explicit zone is given", async () => {
    sdk.inventory.listWorkerRoutes.mockResolvedValueOnce({ scope: "zone", zoneId: "ambient-zone", routes: [] });
    const output = await invoke(["workers", "routes", "list", "--json"]);
    expect(output.code).toBe(0);
    expect(sdk.inventory.listWorkerRoutes).toHaveBeenCalledWith(undefined);
  });
});

describe("WAF read and legacy write command help", () => {
  it.each(["skip", "execute"])("accepts modern %s as a read filter", async (action) => {
    sdk.listFirewallRules.mockResolvedValueOnce({ rules: [], resultInfo: {}, status: "present", truncated: false });
    const output = await invoke(["waf", "rules", "list", "--action", action, "--json"]);
    expect(output.code).toBe(0);
    expect(sdk.listFirewallRules).toHaveBeenCalledWith(expect.objectContaining({ action }), undefined);
  });

  it.each(["1oops", "1.5", "0"])("rejects invalid WAF page %s", async (page) => {
    const output = await invoke(["waf", "rules", "list", "--page", page, "--json"]);
    expect(output.code).not.toBe(0);
    expect(sdk.listFirewallRules).not.toHaveBeenCalled();
  });

  for (const command of ["create", "update", "delete"]) {
    it(`labels ${command} as using the retired legacy API`, async () => {
      const output = await invoke(["waf", "rules", command, "--help"]);
      expect(output.stdout).toMatch(/legacy/iu);
      expect(output.stdout).toMatch(/retired/iu);
      expect(output.stdout).toContain("rulesets rules update");
      expect(output.stdout).not.toContain("find it with `waf rules list`");
      expect(output.stdout).not.toContain("fetch the current one with `waf rules get`");
    });
  }

  it("keeps modern actions invalid on legacy writes", async () => {
    const output = await invoke(["waf", "rules", "create", "--action", "skip", "--expression", "true", "--json"]);
    expect(output.code).not.toBe(0);
    expect(output.stderr).toContain("Action must be one of");
    expect(sdk.loadConfig).not.toHaveBeenCalled();
  });
});
