import { describe, expect, it, vi } from "vitest";
import type { CloudflareClient, RedirectRule } from "@cloudflare-ai-toolkit/sdk";
import {
  runCreateRedirectRule,
  runDeleteRedirectRule,
  runListRedirectRules,
  runUpdateRedirectRule,
  type RedirectsCreateFlags,
  type RedirectsDeleteFlags,
  type RedirectsListFlags,
  type RedirectsUpdateFlags,
} from "./redirects.js";

type RedirectClientMethods = Pick<
  CloudflareClient,
  | "listRedirectRules"
  | "getRedirectRule"
  | "createRedirectRule"
  | "updateRedirectRule"
  | "deleteRedirectRule"
>;

const rule: RedirectRule = {
  id: "rule-1",
  action: "redirect",
  expression: 'http.request.uri.path eq "/old"',
  description: "Move /old",
  enabled: true,
  action_parameters: {
    from_value: {
      target_url: { value: "https://example.com/new" },
      status_code: 301,
      preserve_query_string: false,
    },
  },
};

function makeDeps(methods: Partial<RedirectClientMethods> = {}) {
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
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => methods as RedirectClientMethods),
      log,
      error,
      exit,
      isTTY: vi.fn(() => true),
      confirm: vi.fn(async () => true),
    },
  };
}

describe("runListRedirectRules", () => {
  it("renders rule lines with target and status code", async () => {
    const listRedirectRules = vi.fn(async () => ({
      rulesetId: "rs-1",
      rules: [rule],
    }));
    const { log, error, exit, deps } = makeDeps({ listRedirectRules });

    const flags: RedirectsListFlags = { json: false };
    await runListRedirectRules(flags, deps);

    expect(listRedirectRules).toHaveBeenCalledWith(undefined);
    expect(log.mock.calls[0]?.[0]).toContain("1 redirect rule");
    expect(log.mock.calls[1]?.[0]).toContain(
      'rule-1  301 -> https://example.com/new  http.request.uri.path eq "/old"'
    );
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("runCreateRedirectRule", () => {
  it("forwards flat params to the SDK", async () => {
    const createRedirectRule = vi.fn(async () => rule);
    const { log, deps } = makeDeps({ createRedirectRule });

    const flags: RedirectsCreateFlags = {
      expression: 'http.request.uri.path eq "/old"',
      targetUrl: "https://example.com/new",
      statusCode: 301,
      preserveQueryString: true,
      dryRun: false,
      json: false,
    };
    await runCreateRedirectRule(flags, deps);

    expect(createRedirectRule).toHaveBeenCalledWith(
      {
        expression: 'http.request.uri.path eq "/old"',
        targetUrl: "https://example.com/new",
        targetExpression: undefined,
        statusCode: 301,
        preserveQueryString: true,
        description: undefined,
        enabled: undefined,
        dryRun: false,
      },
      undefined
    );
    expect(log.mock.calls[0]?.[0]).toContain("Created redirect rule rule-1");
  });

  it("errors when no target is provided", async () => {
    const { error, deps } = makeDeps();

    const flags: RedirectsCreateFlags = {
      expression: "true",
      dryRun: false,
      json: false,
    };
    await expect(runCreateRedirectRule(flags, deps)).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("--targetUrl <url>")
    );
  });

  it("announces dry runs instead of claiming creation", async () => {
    const createRedirectRule = vi.fn(async () => ({ ...rule, id: undefined }));
    const { log, deps } = makeDeps({ createRedirectRule });

    const flags: RedirectsCreateFlags = {
      expression: "true",
      targetUrl: "https://example.com",
      dryRun: true,
      json: false,
    };
    await runCreateRedirectRule(flags, deps);

    expect(createRedirectRule).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
      undefined
    );
    expect(log.mock.calls[0]?.[0]).toContain("Dry run");
  });
});

describe("runUpdateRedirectRule", () => {
  it("errors when nothing to update is provided", async () => {
    const { error, deps } = makeDeps();

    const flags: RedirectsUpdateFlags = { json: false };
    await expect(runUpdateRedirectRule("rule-1", flags, deps)).rejects.toThrow(
      "EXIT:1"
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to update")
    );
  });

  it("forwards partial updates", async () => {
    const updateRedirectRule = vi.fn(
      async () =>
        ({
          ...rule,
          action_parameters: {
            from_value: {
              target_url: { value: "https://example.com/new" },
              status_code: 302,
              preserve_query_string: false,
            },
          },
        }) as RedirectRule
    );
    const { deps } = makeDeps({ updateRedirectRule });

    const flags: RedirectsUpdateFlags = {
      statusCode: 302,
      json: false,
    };
    await runUpdateRedirectRule("rule-1", flags, deps);

    expect(updateRedirectRule).toHaveBeenCalledWith(
      "rule-1",
      {
        expression: undefined,
        targetUrl: undefined,
        targetExpression: undefined,
        statusCode: 302,
        preserveQueryString: undefined,
        description: undefined,
        enabled: undefined,
      },
      undefined
    );
  });
});

describe("runDeleteRedirectRule", () => {
  function deleteFlags(overrides: Partial<RedirectsDeleteFlags> = {}): RedirectsDeleteFlags {
    return { json: false, yes: false, ...overrides };
  }

  it("refuses to delete non-interactively without --yes", async () => {
    const deleteRedirectRule = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteRedirectRule });
    (deps.isTTY as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(
      runDeleteRedirectRule("rule-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to proceed non-interactively")
    );
    expect(deleteRedirectRule).not.toHaveBeenCalled();
  });

  it("deletes with --yes and prints confirmation", async () => {
    const deleteRedirectRule = vi.fn(async () => undefined);
    const { log, error, exit, deps } = makeDeps({ deleteRedirectRule });

    await runDeleteRedirectRule("rule-1", deleteFlags({ yes: true }), deps);

    expect(deleteRedirectRule).toHaveBeenCalledWith("rule-1", undefined);
    expect(log).toHaveBeenCalledWith("Deleted redirect rule rule-1.");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("aborts when confirmation is declined", async () => {
    const deleteRedirectRule = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteRedirectRule });
    (deps.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(
      runDeleteRedirectRule("rule-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith("Aborted.");
    expect(deleteRedirectRule).not.toHaveBeenCalled();
  });
});
