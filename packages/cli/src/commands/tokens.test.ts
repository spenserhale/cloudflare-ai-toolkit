import { describe, it, expect, vi } from "vitest";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";
import {
  formatPermissionGroups,
  formatPermissions,
  formatToken,
  runListPermissionGroups,
  runShowToken,
  runTokenPermissions,
  runVerifyToken,
} from "./tokens.js";

const PERMISSIONS = {
  tokenId: "tok-1",
  name: "toolkit token",
  status: "active",
  permissions: [
    {
      policyId: "pol-1",
      effect: "allow" as const,
      id: "aaaa1111",
      name: "Config Rules Write",
      scope: "zone" as const,
      scopes: ["com.cloudflare.api.account.zone"],
      resources: ["com.cloudflare.api.account.zone.z1"],
    },
    {
      policyId: "pol-1",
      effect: "allow" as const,
      id: "bbbb2222",
      name: "Zone Read",
      scope: "zone" as const,
      scopes: ["com.cloudflare.api.account.zone"],
      resources: ["com.cloudflare.api.account.zone.z1"],
    },
  ],
};

const TOKEN = {
  id: "tok-1",
  name: "toolkit token",
  status: "active",
  issued_on: "2026-01-01T00:00:00Z",
  policies: [{ id: "pol-1", effect: "allow" as const, permission_groups: [], resources: {} }],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const verifyToken = vi.fn(async () => ({ id: "tok-1", status: "active" }));
  const getApiToken = vi.fn(async () => TOKEN);
  const getTokenPermissions = vi.fn(async () => PERMISSIONS);
  const listTokenPermissionGroups = vi.fn(async () => [
    {
      id: "aaaa1111",
      name: "Config Rules Write",
      scopes: ["com.cloudflare.api.account.zone"],
    },
  ]);

  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
    })),
    createClient: vi.fn(() => ({
      verifyToken,
      getApiToken,
      getTokenPermissions,
      listTokenPermissionGroups,
    })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    ...overrides,
  } as never;
}

function clientOf(deps: unknown) {
  return (
    deps as {
      createClient: { mock: { results: { value: Record<string, { mock: { calls: unknown[][] } }> }[] } };
    }
  ).createClient.mock.results[0]!.value;
}

function output(deps: unknown): string {
  return (deps as { log: { mock: { calls: unknown[][] } } }).log.mock.calls
    .map((call) => String(call[0]))
    .join("\n");
}

function errors(deps: unknown): string {
  return (deps as { error: { mock: { calls: unknown[][] } } }).error.mock.calls
    .map((call) => String(call[0]))
    .join("\n");
}

function exitCodes(deps: unknown): number[] {
  return (deps as { exit: { mock: { calls: number[][] } } }).exit.mock.calls.map(
    (call) => call[0]!
  );
}

describe("tokens verify", () => {
  it("reports status and points at the permissions command", async () => {
    const deps = makeDeps();
    await runVerifyToken({ json: false }, deps);

    expect(output(deps)).toContain("Token tok-1");
    expect(output(deps)).toContain("Status:      active");
    expect(output(deps)).toContain("does not list its permissions");
    expect(exitCodes(deps)).toEqual([]);
  });

  it("passes accountId through for account-owned tokens", async () => {
    const deps = makeDeps();
    await runVerifyToken({ accountId: "acct-1", json: false }, deps);
    expect(clientOf(deps).verifyToken!.mock.calls[0]).toEqual(["acct-1"]);
  });

  it("emits raw JSON with --json", async () => {
    const deps = makeDeps();
    await runVerifyToken({ json: true }, deps);
    expect(JSON.parse(output(deps))).toEqual({ id: "tok-1", status: "active" });
  });
});

describe("tokens show", () => {
  it("summarises the token and its policy count", async () => {
    const deps = makeDeps();
    await runShowToken({ json: false }, deps);

    expect(output(deps)).toContain("Token tok-1 (toolkit token)");
    expect(output(deps)).toContain("Policies:     1");
  });

  it("defaults tokenId to undefined so the SDK resolves it via verify", async () => {
    const deps = makeDeps();
    await runShowToken({ json: false }, deps);
    expect(clientOf(deps).getApiToken!.mock.calls[0]).toEqual([undefined, undefined]);
  });

  it("forwards an explicit tokenId and accountId", async () => {
    const deps = makeDeps();
    await runShowToken({ tokenId: "tok-9", accountId: "acct-1", json: false }, deps);
    expect(clientOf(deps).getApiToken!.mock.calls[0]).toEqual(["tok-9", "acct-1"]);
  });
});

describe("tokens permissions", () => {
  it("lists the token's permission groups", async () => {
    const deps = makeDeps();
    await runTokenPermissions({ json: false, quiet: false }, deps);

    expect(output(deps)).toContain("Config Rules Write");
    expect(output(deps)).toContain("[zone]");
    expect(output(deps)).toContain("com.cloudflare.api.account.zone.z1");
    expect(output(deps)).toContain("2 permission group(s).");
    expect(exitCodes(deps)).toEqual([]);
  });

  it("exits 0 and says yes when every --check is granted", async () => {
    const deps = makeDeps();
    await runTokenPermissions(
      { json: false, quiet: false, check: ["Zone:Config Rules:Edit", "Zone Read"] },
      deps
    );

    expect(output(deps)).toContain("yes  Zone:Config Rules:Edit");
    expect(output(deps)).toContain("yes  Zone Read");
    expect(exitCodes(deps)).toEqual([]);
  });

  it("exits 1 when a --check is not granted", async () => {
    const deps = makeDeps();
    await runTokenPermissions({ json: false, quiet: false, check: ["DNS Write"] }, deps);

    expect(output(deps)).toContain("NO   DNS Write");
    expect(exitCodes(deps)).toEqual([1]);
  });

  it("exits 1 if any one of several checks fails", async () => {
    const deps = makeDeps();
    await runTokenPermissions(
      { json: false, quiet: false, check: ["Zone Read", "DNS Write"] },
      deps
    );
    expect(exitCodes(deps)).toEqual([1]);
  });

  it("suggests the closest permission the token actually has", async () => {
    const deps = makeDeps();
    await runTokenPermissions(
      { json: false, quiet: false, check: ["Config Rules Read"] },
      deps
    );
    expect(output(deps)).toContain("closest on this token: Config Rules Write");
  });

  it("prints nothing but still sets exit status with --quiet", async () => {
    const deps = makeDeps();
    await runTokenPermissions({ json: false, quiet: true, check: ["DNS Write"] }, deps);

    expect(output(deps)).toBe("");
    expect(exitCodes(deps)).toEqual([1]);
  });

  it("reports check results as JSON with --json", async () => {
    const deps = makeDeps();
    await runTokenPermissions(
      { json: true, quiet: false, check: ["Zone Read", "DNS Write"] },
      deps
    );

    const parsed = JSON.parse(output(deps)) as {
      tokenId: string;
      checks: { query: string; granted: boolean }[];
    };
    expect(parsed.tokenId).toBe("tok-1");
    expect(parsed.checks.map((c) => c.granted)).toEqual([true, false]);
    expect(exitCodes(deps)).toEqual([1]);
  });

  it("explains the missing introspection permission on a 403", async () => {
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        getTokenPermissions: vi.fn(async () => {
          throw new CloudflareError(
            "Unauthorized to access requested resource",
            "9109",
            403,
            { requiredPermissions: ["API Tokens Read"] }
          );
        }),
      })),
    });

    await runTokenPermissions({ json: false, quiet: false }, deps);

    expect(errors(deps)).toContain("Required permission: 'API Tokens Read'");
    expect(errors(deps)).toContain("User -> API Tokens -> Read");
    expect(errors(deps)).toContain("tokens verify");
    // 2, not 1: "could not determine" must not be read as "not granted".
    expect(exitCodes(deps)).toEqual([2]);
  });

  it("separates 'not granted' (1) from 'could not determine' (2)", async () => {
    const denied = makeDeps();
    await runTokenPermissions(
      { json: false, quiet: true, check: ["DNS Write"] },
      denied
    );
    expect(exitCodes(denied)).toEqual([1]);

    const broken = makeDeps({
      createClient: vi.fn(() => ({
        getTokenPermissions: vi.fn(async () => {
          throw new CloudflareError("boom", "9109", 403);
        }),
      })),
    });
    await runTokenPermissions(
      { json: false, quiet: true, check: ["DNS Write"] },
      broken
    );
    expect(exitCodes(broken)).toEqual([2]);
  });
});

describe("tokens groups", () => {
  it("lists permission groups with their ids and scopes", async () => {
    const deps = makeDeps();
    await runListPermissionGroups({ json: false }, deps);

    expect(output(deps)).toContain("aaaa1111  Config Rules Write");
    expect(output(deps)).toContain("com.cloudflare.api.account.zone");
  });

  it("forwards name and scope filters", async () => {
    const deps = makeDeps();
    await runListPermissionGroups(
      { name: "Rules", scope: "com.cloudflare.api.account.zone", json: false },
      deps
    );

    expect(clientOf(deps).listTokenPermissionGroups!.mock.calls[0]).toEqual([
      {
        name: "Rules",
        scope: "com.cloudflare.api.account.zone",
        accountId: undefined,
      },
    ]);
  });
});

describe("formatters", () => {
  it("marks deny permissions distinctly from allow", () => {
    const text = formatPermissions({
      ...PERMISSIONS,
      permissions: [
        { ...PERMISSIONS.permissions[0]!, effect: "deny" as const },
        PERMISSIONS.permissions[1]!,
      ],
    });
    expect(text).toContain("DENY   Config Rules Write");
    expect(text).toContain("allow  Zone Read");
  });

  it("says so when a token carries no permission groups", () => {
    expect(formatPermissions({ ...PERMISSIONS, permissions: [] })).toContain(
      "No permission groups on this token."
    );
  });

  it("says so when no permission groups match", () => {
    expect(formatPermissionGroups([])).toBe("No permission groups matched.");
  });

  it("renders a token with no optional timestamps", () => {
    expect(formatToken({ id: "tok-2" })).toContain("Policies:     0");
  });
});
