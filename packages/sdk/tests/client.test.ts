import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareAuthError, CloudflareError } from "../src/errors.js";

function tokenClientConfig(overrides: Partial<{ accountId: string }> = {}) {
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
});
