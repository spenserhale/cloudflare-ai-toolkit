import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";

function tokenConfig(overrides: Partial<{ accountId: string; zoneId: string }> = {}) {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
    ...overrides,
  };
}

function mockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(input, init)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("CloudflareClient.queryLogExplorer", () => {
  it("requires a zone or account ID", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(
      client.queryLogExplorer({ sql: "SELECT 1" })
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it("prefers zone scope when both IDs are configured and scope is not specified", async () => {
    const client = new CloudflareClient(
      tokenConfig({ accountId: "acc-1", zoneId: "zone-1" })
    );

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await client.queryLogExplorer({ sql: "SELECT 1" });
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/query/sql");
      expect(new URL(capturedUrl).searchParams.get("query")).toBe("SELECT 1");
    } finally {
      restore();
    }
  });

  it("honors explicit account scope and override accountId", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await client.queryLogExplorer(
        { sql: "SELECT 1", scope: "account" },
        { accountId: "override-acc" }
      );
      expect(capturedUrl).toContain("/accounts/override-acc/logs/explorer/query/sql");
    } finally {
      restore();
    }
  });

  it("throws CONFIG_ERROR when account scope requested without accountId", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    await expect(
      client.queryLogExplorer({ sql: "SELECT 1", scope: "account" })
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it("returns rows from the wrapped envelope", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    const restore = mockFetch(() =>
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [
            { ClientIP: "203.0.113.1", EdgeResponseStatus: 200 },
            { ClientIP: "203.0.113.2", EdgeResponseStatus: 404 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      const result = await client.queryLogExplorer({ sql: "SELECT * FROM http_requests LIMIT 2" });
      expect(result.rows.length).toBe(2);
      expect(result.rows[0]).toEqual({ ClientIP: "203.0.113.1", EdgeResponseStatus: 200 });
    } finally {
      restore();
    }
  });

  it("URL-encodes SQL containing special characters", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await client.queryLogExplorer({
        sql: "SELECT * FROM t WHERE a = 'b c' AND d > 1",
      });
      const url = new URL(capturedUrl);
      expect(url.searchParams.get("query")).toBe(
        "SELECT * FROM t WHERE a = 'b c' AND d > 1"
      );
    } finally {
      restore();
    }
  });

  it("propagates API failures as CloudflareError", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    const restore = mockFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 1004, message: "Syntax error near 'SELEKT'" }],
          messages: [],
          result: null,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await expect(
        client.queryLogExplorer({ sql: "SELEKT 1" })
      ).rejects.toBeInstanceOf(CloudflareError);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.enableLogExplorerDataset", () => {
  it("POSTs to the datasets endpoint with the dataset name in the body", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      capturedUrl = String(input);
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: {
            dataset: "http_requests",
            object_type: "zone",
            object_id: "zone-1",
            dataset_id: "ds-1",
            enabled: true,
            created_at: "2026-05-12T00:00:00Z",
            updated_at: "2026-05-12T00:00:00Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const result = await client.enableLogExplorerDataset({ dataset: "http_requests" });
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/datasets");
      expect(JSON.parse(capturedBody)).toEqual({ dataset: "http_requests" });
      expect(result.enabled).toBe(true);
      expect(result.dataset_id).toBe("ds-1");
    } finally {
      restore();
    }
  });

  it("uses account scope when explicitly requested", async () => {
    const client = new CloudflareClient(
      tokenConfig({ accountId: "acc-1", zoneId: "zone-1" })
    );

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: {
            dataset: "gateway_dns",
            object_type: "account",
            object_id: "acc-1",
            dataset_id: "ds-2",
            enabled: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await client.enableLogExplorerDataset({ dataset: "gateway_dns", scope: "account" });
      expect(capturedUrl).toContain("/accounts/acc-1/logs/explorer/datasets");
    } finally {
      restore();
    }
  });
});
