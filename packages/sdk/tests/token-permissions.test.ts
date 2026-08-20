import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";
import {
  checkTokenPermissions,
  deriveTokenPermissionScope,
  flattenPolicyResources,
  flattenTokenPolicies,
  normalizePermissionQuery,
  permissionMatchesQuery,
  suggestPermissionNames,
} from "../src/token-permissions.js";
import type { ApiToken, TokenPermission } from "../src/types.js";

function tokenConfig(overrides: Partial<{ accountId: string; zoneId: string }> = {}) {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
    ...overrides,
  };
}

function keyConfig() {
  return {
    auth: { type: "globalApiKey" as const, apiKey: "key", email: "user@example.com" },
    baseUrl: "https://api.example.com",
  };
}

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
) {
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

function ok(result: unknown) {
  return new Response(envelope(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const TOKEN: ApiToken = {
  id: "tok-1",
  name: "toolkit token",
  status: "active",
  issued_on: "2026-01-01T00:00:00Z",
  policies: [
    {
      id: "pol-1",
      effect: "allow",
      permission_groups: [
        {
          id: "aaaa1111",
          name: "Config Rules Write",
          meta: { label: "config_rules_write", scopes: "com.cloudflare.api.account.zone" },
        },
        {
          id: "bbbb2222",
          name: "Zone Read",
          meta: { label: "zone_read", scopes: "com.cloudflare.api.account.zone" },
        },
      ],
      resources: { "com.cloudflare.api.account.zone.z1": "*" },
    },
    {
      id: "pol-2",
      effect: "allow",
      permission_groups: [
        {
          id: "cccc3333",
          name: "Logs Read",
          meta: { label: "logs_read", scopes: "com.cloudflare.api.account" },
        },
      ],
      resources: {
        "com.cloudflare.api.account.acct1": { "com.cloudflare.api.account.zone.*": "*" },
      },
    },
  ],
};

describe("flattenTokenPolicies", () => {
  it("expands each policy into one entry per permission group", () => {
    const permissions = flattenTokenPolicies(TOKEN);
    expect(permissions).toHaveLength(3);
    expect(permissions.map((p) => p.name)).toEqual([
      "Config Rules Write",
      "Zone Read",
      "Logs Read",
    ]);
    expect(permissions[0]?.policyId).toBe("pol-1");
    expect(permissions[0]?.effect).toBe("allow");
  });

  it("derives the scope from meta.scopes on policy-embedded groups", () => {
    const permissions = flattenTokenPolicies(TOKEN);
    expect(permissions[0]?.scope).toBe("zone");
    expect(permissions[2]?.scope).toBe("account");
  });

  it("carries the policy's resources onto each group", () => {
    const permissions = flattenTokenPolicies(TOKEN);
    expect(permissions[0]?.resources).toEqual(["com.cloudflare.api.account.zone.z1"]);
    expect(permissions[2]?.resources).toEqual([
      "com.cloudflare.api.account.acct1/com.cloudflare.api.account.zone.*",
    ]);
  });

  it("returns nothing for a token with no policies", () => {
    expect(flattenTokenPolicies({ id: "tok-2" })).toEqual([]);
  });
});

describe("deriveTokenPermissionScope", () => {
  it("prefers the longer zone URN over its account prefix", () => {
    expect(deriveTokenPermissionScope(["com.cloudflare.api.account.zone"])).toBe("zone");
    expect(deriveTokenPermissionScope(["com.cloudflare.api.account"])).toBe("account");
    expect(deriveTokenPermissionScope(["com.cloudflare.api.user"])).toBe("user");
  });

  it("falls back to unknown for an unrecognised scope", () => {
    expect(deriveTokenPermissionScope([])).toBe("unknown");
    expect(deriveTokenPermissionScope(["com.example.other"])).toBe("unknown");
  });
});

describe("flattenPolicyResources", () => {
  it("keeps flat resource keys and expands nested ones", () => {
    expect(
      flattenPolicyResources({
        "com.cloudflare.api.account.zone.z1": "*",
        "com.cloudflare.api.account.a1": { "com.cloudflare.api.account.zone.*": "*" },
      })
    ).toEqual([
      "com.cloudflare.api.account.zone.z1",
      "com.cloudflare.api.account.a1/com.cloudflare.api.account.zone.*",
    ]);
  });

  it("keeps the outer key when the nested object is empty", () => {
    expect(flattenPolicyResources({ "com.cloudflare.api.account.a1": {} })).toEqual([
      "com.cloudflare.api.account.a1",
    ]);
  });
});

describe("normalizePermissionQuery", () => {
  it("lowercases and treats : and / as separators", () => {
    expect(normalizePermissionQuery("Zone:Config Rules:Edit")).toBe(
      "zone config rules edit"
    );
    expect(normalizePermissionQuery("Zone / Config Rules / Edit")).toBe(
      "zone config rules edit"
    );
  });
});

describe("permissionMatchesQuery", () => {
  const permissions = flattenTokenPolicies(TOKEN);
  const configRules = permissions[0] as TokenPermission;
  const logsRead = permissions[2] as TokenPermission;

  it("matches the exact API name", () => {
    expect(permissionMatchesQuery(configRules, "Config Rules Write")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(permissionMatchesQuery(configRules, "config rules write")).toBe(true);
  });

  it("treats the dashboard's Edit as the API's Write", () => {
    expect(permissionMatchesQuery(configRules, "Config Rules Edit")).toBe(true);
  });

  it("accepts the dashboard's scope-prefixed rendering", () => {
    expect(permissionMatchesQuery(configRules, "Zone:Config Rules:Edit")).toBe(true);
    expect(permissionMatchesQuery(configRules, "Zone / Config Rules / Write")).toBe(true);
  });

  it("does not strip a scope prefix that disagrees with the group's scope", () => {
    expect(permissionMatchesQuery(logsRead, "Zone:Logs Read")).toBe(false);
    expect(permissionMatchesQuery(logsRead, "Account:Logs Read")).toBe(true);
  });

  it("matches on the stable permission-group id", () => {
    expect(permissionMatchesQuery(configRules, "aaaa1111")).toBe(true);
    expect(permissionMatchesQuery(configRules, "AAAA1111")).toBe(true);
  });

  it("rejects a near miss rather than guessing", () => {
    expect(permissionMatchesQuery(configRules, "Config Rules")).toBe(false);
    expect(permissionMatchesQuery(configRules, "Config Rules Read")).toBe(false);
    expect(permissionMatchesQuery(configRules, "")).toBe(false);
  });
});

describe("checkTokenPermissions", () => {
  const permissions = flattenTokenPolicies(TOKEN);

  it("grants a permission the token holds and denies one it does not", () => {
    const [granted, missing] = checkTokenPermissions(permissions, [
      "Zone:Config Rules:Edit",
      "DNS Write",
    ]);
    expect(granted?.granted).toBe(true);
    expect(granted?.matched).toHaveLength(1);
    expect(missing?.granted).toBe(false);
    expect(missing?.matched).toEqual([]);
  });

  it("reports not-granted when a matching deny policy exists", () => {
    const withDeny = flattenTokenPolicies({
      ...TOKEN,
      policies: [
        ...(TOKEN.policies ?? []),
        {
          id: "pol-3",
          effect: "deny",
          permission_groups: [
            {
              id: "aaaa1111",
              name: "Config Rules Write",
              meta: { scopes: "com.cloudflare.api.account.zone" },
            },
          ],
          resources: { "com.cloudflare.api.account.zone.z9": "*" },
        },
      ],
    });

    const [check] = checkTokenPermissions(withDeny, ["Config Rules Write"]);
    expect(check?.granted).toBe(false);
    expect(check?.matched).toHaveLength(2);
  });

  it("returns one result per query, in order", () => {
    const results = checkTokenPermissions(permissions, ["Zone Read", "Logs Read"]);
    expect(results.map((r) => r.query)).toEqual(["Zone Read", "Logs Read"]);
    expect(results.every((r) => r.granted)).toBe(true);
  });
});

describe("suggestPermissionNames", () => {
  const permissions = flattenTokenPolicies(TOKEN);

  it("suggests names sharing a word with the failed query", () => {
    expect(suggestPermissionNames(permissions, "Config Rules Read")).toEqual([
      "Config Rules Write",
    ]);
  });

  it("returns nothing when no word overlaps", () => {
    expect(suggestPermissionNames(permissions, "Workers KV Storage")).toEqual([]);
  });
});

describe("CloudflareClient token introspection", () => {
  it("resolves its own token id via verify before fetching details", async () => {
    const client = new CloudflareClient(tokenConfig());
    const urls: string[] = [];
    const restore = mockFetch((input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/user/tokens/verify")) return ok({ id: "tok-1", status: "active" });
      return ok(TOKEN);
    });

    try {
      const token = await client.getApiToken();
      expect(urls[0]).toContain("/client/v4/user/tokens/verify");
      expect(urls[1]).toContain("/client/v4/user/tokens/tok-1");
      expect(token.name).toBe("toolkit token");
    } finally {
      restore();
    }
  });

  it("skips verify when given an explicit token id", async () => {
    const client = new CloudflareClient(tokenConfig());
    const urls: string[] = [];
    const restore = mockFetch((input) => {
      urls.push(String(input));
      return ok(TOKEN);
    });

    try {
      await client.getApiToken("tok-explicit");
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("/client/v4/user/tokens/tok-explicit");
    } finally {
      restore();
    }
  });

  it("uses the account-owned path when an account id is given", async () => {
    const client = new CloudflareClient(tokenConfig());
    const urls: string[] = [];
    const restore = mockFetch((input) => {
      urls.push(String(input));
      return ok(TOKEN);
    });

    try {
      await client.getApiToken("tok-1", "acct-1");
      expect(urls[0]).toContain("/client/v4/accounts/acct-1/tokens/tok-1");
    } finally {
      restore();
    }
  });

  it("verifies against the account-owned path too", async () => {
    const client = new CloudflareClient(tokenConfig());
    let url = "";
    const restore = mockFetch((input) => {
      url = String(input);
      return ok({ id: "tok-1", status: "active" });
    });

    try {
      await client.verifyToken("acct-1");
      expect(url).toContain("/client/v4/accounts/acct-1/tokens/verify");
    } finally {
      restore();
    }
  });

  it("flattens policies into permissions with token metadata", async () => {
    const client = new CloudflareClient(tokenConfig());
    const restore = mockFetch(() => ok(TOKEN));

    try {
      const result = await client.getTokenPermissions("tok-1");
      expect(result.tokenId).toBe("tok-1");
      expect(result.name).toBe("toolkit token");
      expect(result.status).toBe("active");
      expect(result.permissions).toHaveLength(3);
    } finally {
      restore();
    }
  });

  it("surfaces the required permission when Cloudflare answers 9109", async () => {
    const client = new CloudflareClient(tokenConfig());
    const restore = mockFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: "Unauthorized to access requested resource" }],
          messages: [],
          result: null,
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await expect(client.getApiToken("tok-1")).rejects.toThrow(
        /Unauthorized to access requested resource/u
      );
      const err = await client.getApiToken("tok-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CloudflareError);
      expect((err as CloudflareError).requiredPermissions).toContain("API Tokens Read");
    } finally {
      restore();
    }
  });

  it("errors before any request when the token id cannot be resolved", async () => {
    const client = new CloudflareClient(tokenConfig());
    const restore = mockFetch(() => ok({ status: "active" }));

    try {
      await expect(client.getApiToken()).rejects.toThrow(/Could not determine the token ID/u);
    } finally {
      restore();
    }
  });

  it("lists permission groups with name and scope filters", async () => {
    const client = new CloudflareClient(tokenConfig());
    let url = "";
    const restore = mockFetch((input) => {
      url = String(input);
      return ok([
        {
          id: "aaaa1111",
          name: "Config Rules Write",
          description: "Grants access to editing Config Rules",
          scopes: ["com.cloudflare.api.account.zone"],
        },
      ]);
    });

    try {
      const groups = await client.listTokenPermissionGroups({
        name: "Config",
        scope: "com.cloudflare.api.account.zone",
      });
      expect(url).toContain("/client/v4/user/tokens/permission_groups");
      expect(url).toContain("name=Config");
      expect(url).toContain("scope=com.cloudflare.api.account.zone");
      expect(groups[0]?.scopes).toEqual(["com.cloudflare.api.account.zone"]);
    } finally {
      restore();
    }
  });

  it("treats a null permission-group result as empty", async () => {
    const client = new CloudflareClient(tokenConfig());
    const restore = mockFetch(() => ok(null));

    try {
      expect(await client.listTokenPermissionGroups()).toEqual([]);
    } finally {
      restore();
    }
  });

  it("refuses token introspection under global API key auth", async () => {
    const client = new CloudflareClient(keyConfig());
    await expect(client.getApiToken("tok-1")).rejects.toThrow(/CLOUDFLARE_API_TOKEN/u);
    await expect(client.listTokenPermissionGroups()).rejects.toThrow(
      /CLOUDFLARE_API_TOKEN/u
    );
  });
});
