import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareAuthError, CloudflareError } from "../src/errors.js";

function tokenClientConfig(overrides: Partial<{ accountId: string; zoneId: string }> = {}) {
  return {
    auth: {
      type: "apiToken" as const,
      token: "test-token",
    },
    baseUrl: "https://api.example.com",
    ...overrides,
  };
}

describe("CloudflareClient", () => {
  it("should require a valid auth configuration", () => {
    expect(() =>
      new CloudflareClient({
        auth: {
          type: "apiToken",
          token: "",
        },
        baseUrl: "https://api.example.com",
      })
    ).toThrow();
  });

  it("should accept a valid config", () => {
    const client = new CloudflareClient(tokenClientConfig());
    expect(client).toBeDefined();
  });

  it("should require an account id for audit log calls", async () => {
    const client = new CloudflareClient(tokenClientConfig());

    await expect(client.listAuditLogs()).rejects.toBeInstanceOf(CloudflareError);
  });

  it("verifies token via /user/tokens/verify", async () => {
    const client = new CloudflareClient(tokenClientConfig());

    let capturedAuthHeader = "";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      capturedAuthHeader = headers?.Authorization ?? "";
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "token-id", status: "active" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      const result = await client.verifyToken();
      expect(result.status).toBe("active");
      expect(result.id).toBe("token-id");
      expect(capturedAuthHeader).toBe("Bearer test-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses X-Auth-Key/X-Auth-Email headers for legacy global API key auth", async () => {
    const client = new CloudflareClient({
      auth: {
        type: "globalApiKey",
        apiKey: "legacy-key",
        email: "dev@example.com",
      },
      baseUrl: "https://api.example.com",
      accountId: "acc-id",
    });

    let capturedHeaders: Record<string, string> = {};
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string> | undefined) ?? {};
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { data: [], pagination: {} },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      await client.listAuditLogs();
      expect(capturedHeaders["X-Auth-Key"]).toBe("legacy-key");
      expect(capturedHeaders["X-Auth-Email"]).toBe("dev@example.com");
      expect(capturedHeaders.Authorization).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects verifyToken for legacy global API key auth", async () => {
    const client = new CloudflareClient({
      auth: {
        type: "globalApiKey",
        apiKey: "legacy-key",
        email: "dev@example.com",
      },
      baseUrl: "https://api.example.com",
    });

    await expect(client.verifyToken()).rejects.toMatchObject({
      code: "UNSUPPORTED_AUTH",
    });
  });

  it("attaches required permissions metadata for audit-log auth failures", async () => {
    const client = new CloudflareClient(tokenClientConfig({ accountId: "acc-id" }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
          messages: [],
          result: null,
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      await expect(client.listAuditLogs()).rejects.toMatchObject({
        name: "CloudflareError",
        requiredPermissions: ["Account Settings Read", "Account Settings Write"],
        docsUrl:
          "https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves required permissions metadata on 401 auth errors", async () => {
    const client = new CloudflareClient(tokenClientConfig({ accountId: "acc-id" }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
          messages: [],
          result: null,
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      await expect(client.listAuditLogs()).rejects.toBeInstanceOf(CloudflareAuthError);
      await expect(client.listAuditLogs()).rejects.toMatchObject({
        requiredPermissions: ["Account Settings Read", "Account Settings Write"],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("supports audit-log responses where result is an array and pagination is in result_info", async () => {
    const client = new CloudflareClient(
      tokenClientConfig({
        accountId: "acc-id",
      })
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [{ id: "log-1", when: "2026-02-28T00:00:00Z" }],
          result_info: { count: 1, cursor: "next-cursor" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      const result = await client.listAuditLogs();
      expect(result.data.length).toBe(1);
      expect(result.data[0]?.id).toBe("log-1");
      expect(result.pagination?.cursor).toBe("next-cursor");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("sends snake_case filter query params for audit logs", async () => {
    const client = new CloudflareClient(tokenClientConfig({ accountId: "acc-id" }));

    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [],
          result_info: { count: 0 },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      await client.listAuditLogs({
        actionType: "delete",
        actionResult: "success",
        resourceType: "dns_records",
        actorEmail: "spenser@pbhs.com",
        actorId: "actor-1",
        actorIp: "203.0.113.1",
        actorTokenId: "token-1",
        actorTokenName: "token-name",
        actorTokenType: "api_key",
        actorUserEmail: "spenser@pbhs.com",
        actorUserId: "user-1",
        zoneName: "example.com",
      });

      const url = new URL(capturedUrl);
      expect(url.searchParams.get("action_type")).toBe("delete");
      expect(url.searchParams.get("action_result")).toBe("success");
      expect(url.searchParams.get("resource.type")).toBe("dns_records");
      expect(url.searchParams.get("actor_email")).toBe("spenser@pbhs.com");
      expect(url.searchParams.get("actor_id")).toBe("actor-1");
      expect(url.searchParams.get("actor_ip")).toBe("203.0.113.1");
      expect(url.searchParams.get("actor_token_id")).toBe("token-1");
      expect(url.searchParams.get("actor_token_name")).toBe("token-name");
      expect(url.searchParams.get("actor_token_type")).toBe("api_key");
      expect(url.searchParams.get("actor_user_email")).toBe("spenser@pbhs.com");
      expect(url.searchParams.get("actor_user_id")).toBe("user-1");
      expect(url.searchParams.get("zone_name")).toBe("example.com");

      expect(url.searchParams.has("action.type")).toBe(false);
      expect(url.searchParams.has("actor.email")).toBe(false);
      expect(url.searchParams.has("zone.name")).toBe(false);
      expect(url.searchParams.has("resource_type")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // Cache purge
  // -------------------------------------------------------------------------

  it("should require a zone id for cache purge calls", async () => {
    const client = new CloudflareClient(tokenClientConfig());
    await expect(client.purgeCacheEverything()).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("purges everything via POST /zones/{zoneId}/purge_cache", async () => {
    const client = new CloudflareClient(tokenClientConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    let capturedBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "purge-1" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const result = await client.purgeCacheEverything();
      expect(capturedUrl).toContain("/zones/zone-1/purge_cache");
      expect(JSON.parse(capturedBody)).toEqual({ purge_everything: true });
      expect(result.id).toBe("purge-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("purges by tags via POST /zones/{zoneId}/purge_cache", async () => {
    const client = new CloudflareClient(tokenClientConfig({ zoneId: "zone-1" }));

    let capturedBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "purge-2" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const result = await client.purgeCacheByTags(["tag-a", "tag-b"]);
      expect(JSON.parse(capturedBody)).toEqual({ tags: ["tag-a", "tag-b"] });
      expect(result.id).toBe("purge-2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("purges by prefixes via POST /zones/{zoneId}/purge_cache", async () => {
    const client = new CloudflareClient(tokenClientConfig({ zoneId: "zone-1" }));

    let capturedBody = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "purge-3" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      const result = await client.purgeCacheByPrefixes(["example.com/assets"]);
      expect(JSON.parse(capturedBody)).toEqual({ prefixes: ["example.com/assets"] });
      expect(result.id).toBe("purge-3");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("allows overriding zoneId per call", async () => {
    const client = new CloudflareClient(tokenClientConfig({ zoneId: "default-zone" }));

    let capturedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: { id: "purge-4" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    try {
      await client.purgeCacheByUrls(["https://example.com/page"], "override-zone");
      expect(capturedUrl).toContain("/zones/override-zone/purge_cache");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("treats wrapped audit log result=null as an empty list", async () => {
    const client = new CloudflareClient(tokenClientConfig({ accountId: "acc-id" }));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: null,
          result_info: { cursor: "next-cursor" },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    try {
      const result = await client.listAuditLogs({
        actionType: "delete",
        resourceType: "dns_records",
      });
      expect(result.data).toEqual([]);
      expect(result.pagination?.cursor).toBe("next-cursor");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
