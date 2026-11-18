import { describe, expect, it, vi } from "vitest";
import { CloudflareError, type CloudflareClient, type FirewallRule } from "@cloudflare-ai-toolkit/sdk";
import {
  runCreateFirewallRule,
  runDeleteFirewallRule,
  runGetFirewallRule,
  runListFirewallRules,
  runUpdateFirewallRule,
  type WafRuleCreateFlags,
  type WafRuleDeleteFlags,
  type WafRulesListFlags,
  type WafRuleUpdateFlags,
} from "./waf-rules.js";

type WafClientMethods = Pick<
  CloudflareClient,
  | "listFirewallRules"
  | "getFirewallRule"
  | "createFirewallRule"
  | "updateFirewallRule"
  | "deleteFirewallRule"
>;

const rule: FirewallRule = {
  id: "rule-1",
  action: "block",
  description: "Block wp-login",
  filter: { id: "filter-1", expression: 'http.request.uri.path contains "/wp-login.php"' },
  paused: false,
  priority: 50,
};

function makeDeps(methods: Partial<WafClientMethods> = {}) {
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn((code: number) => {
    throw new Error(`EXIT:${code}`);
  });
  return {
    log,
    error,
    exit,
    deps: {
      loadConfig: vi.fn(async () => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => methods as WafClientMethods),
      log,
      error,
      exit,
      isTTY: vi.fn(() => true),
      confirm: vi.fn(async () => true),
    },
  };
}

describe("runListFirewallRules", () => {
  it("forwards filters to the SDK and renders rule lines", async () => {
    const listFirewallRules = vi.fn(async () => ({
      rules: [rule],
      resultInfo: { page: 1, per_page: 25, count: 1, total_count: 3, total_pages: 1 },
    }));
    const { log, error, exit, deps } = makeDeps({ listFirewallRules });

    const flags: WafRulesListFlags = {
      action: "block",
      paused: false,
      json: false,
    };
    await runListFirewallRules(flags, deps);

    expect(listFirewallRules).toHaveBeenCalledWith(
      { action: "block", description: undefined, paused: false, page: undefined, perPage: undefined },
      undefined
    );
    expect(log.mock.calls[0]?.[0]).toContain("1 of 3 rules");
    expect(log.mock.calls[1]?.[0]).toContain("rule-1  action=block priority=50  Block wp-login");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("preserves native Rulesets fields and source metadata in JSON", async () => {
    const result = {
      scope: "zone" as const, zoneId: "z", phase: "http_request_firewall_custom", status: "present" as const, rulesetId: "rs",
      rules: [{ ...rule, action: "skip", expression: "true", enabled: true, order: 1, action_parameters: { ruleset: "current", products: ["zoneLockdown"] } }],
      resultInfo: { page: 1, per_page: 1, total_pages: 2, total_count: 2 }, truncated: true,
    };
    const { log, error, deps } = makeDeps({ listFirewallRules: vi.fn(async () => result) as WafClientMethods["listFirewallRules"] });
    await runListFirewallRules({ json: true }, deps);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(result);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("--page"));
  });

  it("prints source, evaluation order, native expression, and action parameters", async () => {
    const modernRule = {
      ...rule, action: "skip", enabled: true, order: 2, expression: "http.host eq \"example.com\"",
      action_parameters: { ruleset: "current", phases: ["http_request_firewall_managed"] },
    } as unknown as FirewallRule;
    const listFirewallRules = vi.fn(async () => ({
      scope: "zone" as const, zoneId: "z", phase: "http_request_firewall_custom", status: "present" as const, rulesetId: "rs",
      rules: [modernRule], resultInfo: { page: 1, total_pages: 1 }, truncated: false,
    }));
    const { log, deps } = makeDeps({ listFirewallRules });
    await runListFirewallRules({ json: false }, deps);
    const text = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain("http_request_firewall_custom");
    expect(text).toContain("rs");
    expect(text).toContain("order=2");
    expect(text).toContain("enabled=true");
    expect(text).toContain('http.host eq "example.com"');
    expect(text).toContain("http_request_firewall_managed");
  });

  it("prints phase absence without presenting it as no matching rules", async () => {
    const listFirewallRules = vi.fn(async () => ({
      scope: "zone" as const, zoneId: "z", phase: "http_request_firewall_custom", status: "absent" as const, rules: [], resultInfo: {},
      truncated: false, diagnostic: { statusCode: 404, code: "10003", message: "entrypoint not found" },
    }));
    const { log, deps } = makeDeps({ listFirewallRules });
    await runListFirewallRules({ json: false }, deps);
    const text = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain("absent");
    expect(text).not.toContain("No firewall rules matched");
  });

  it.each([
    new CloudflareError("Forbidden", "9109", 403),
    new CloudflareError("Retired", "10020", 410),
    new Error("Malformed response"),
  ])("does not render failed reads as empty rules: %s", async (failure) => {
    const { log, error, exit, deps } = makeDeps({ listFirewallRules: vi.fn(async () => { throw failure; }) });
    await expect(runListFirewallRules({ json: true }, deps)).rejects.toThrow("EXIT:1");
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining(failure.message));
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("runGetFirewallRule", () => {
  it("shows native source and parameter details", async () => {
    const getFirewallRule = vi.fn(async () => ({
      ...rule, expression: "true", enabled: false, order: 3, scope: "zone", zoneId: "z",
      phase: "http_request_firewall_custom", rulesetId: "rs",
      action_parameters: { ruleset: "current" },
    }));
    const { log, deps } = makeDeps({ getFirewallRule });
    await runGetFirewallRule("rule-1", { json: false }, deps);
    const text = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(text).toContain("http_request_firewall_custom");
    expect(text).toContain("rs");
    expect(text).toContain("Order:       3");
    expect(text).toContain("Enabled:     false");
    expect(text).toContain("Expression:  true");
    expect(text).toContain("current");
  });
});

describe("runCreateFirewallRule", () => {
  it("creates a rule from expression and action", async () => {
    const createFirewallRule = vi.fn(async () => rule);
    const { log, deps } = makeDeps({ createFirewallRule });

    const flags: WafRuleCreateFlags = {
      action: "block",
      expression: 'http.request.uri.path contains "/wp-login.php"',
      description: "Block wp-login",
      json: false,
    };
    await runCreateFirewallRule(flags, deps);

    expect(createFirewallRule).toHaveBeenCalledWith(
      {
        expression: 'http.request.uri.path contains "/wp-login.php"',
        action: "block",
        description: "Block wp-login",
        paused: undefined,
        priority: undefined,
      },
      undefined
    );
    expect(log.mock.calls[0]?.[0]).toContain("Created firewall rule rule-1");
  });

  it("rejects an empty expression", async () => {
    const { error, deps } = makeDeps();

    const flags: WafRuleCreateFlags = {
      action: "block",
      expression: "   ",
      json: false,
    };
    await expect(runCreateFirewallRule(flags, deps)).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Filter expression is empty")
    );
  });
});

describe("runUpdateFirewallRule", () => {
  it("PUTs action and expression with the rule id", async () => {
    const updateFirewallRule = vi.fn(async () => ({ ...rule, paused: true }));
    const { deps } = makeDeps({ updateFirewallRule });

    const flags: WafRuleUpdateFlags = {
      action: "block",
      expression: 'ip.src.country eq "RU"',
      paused: true,
      json: false,
    };
    await runUpdateFirewallRule("rule-1", flags, deps);

    expect(updateFirewallRule).toHaveBeenCalledWith(
      "rule-1",
      {
        expression: 'ip.src.country eq "RU"',
        action: "block",
        description: undefined,
        paused: true,
        priority: undefined,
      },
      undefined
    );
  });
});

describe("runDeleteFirewallRule", () => {
  function deleteFlags(overrides: Partial<WafRuleDeleteFlags> = {}): WafRuleDeleteFlags {
    return { json: false, yes: false, ...overrides };
  }

  it("refuses to delete non-interactively without --yes", async () => {
    const deleteFirewallRule = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteFirewallRule });
    (deps.isTTY as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(
      runDeleteFirewallRule("rule-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to proceed non-interactively")
    );
    expect(deleteFirewallRule).not.toHaveBeenCalled();
  });

  it("deletes with --yes and prints confirmation", async () => {
    const deleteFirewallRule = vi.fn(async () => undefined);
    const { log, error, exit, deps } = makeDeps({ deleteFirewallRule });

    await runDeleteFirewallRule("rule-1", deleteFlags({ yes: true }), deps);

    expect(deleteFirewallRule).toHaveBeenCalledWith("rule-1", undefined);
    expect(log).toHaveBeenCalledWith("Deleted firewall rule rule-1.");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("aborts when confirmation is declined", async () => {
    const deleteFirewallRule = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteFirewallRule });
    (deps.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(
      runDeleteFirewallRule("rule-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith("Aborted.");
    expect(deleteFirewallRule).not.toHaveBeenCalled();
  });
});
