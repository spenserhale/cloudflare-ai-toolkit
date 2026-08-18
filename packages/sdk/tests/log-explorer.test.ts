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

function datasetResult(overrides: Record<string, unknown> = {}) {
  return {
    dataset: "http_requests",
    object_type: "zone",
    object_id: "zone-1",
    dataset_id: "ds-1",
    enabled: true,
    deletion_protection: false,
    created_at: "2026-05-12T00:00:00Z",
    updated_at: "2026-05-12T00:00:00Z",
    ...overrides,
  };
}

function envelope(result: unknown) {
  return JSON.stringify({
    success: true,
    errors: [],
    messages: [],
    result,
  });
}

describe("CloudflareClient.listLogExplorerDatasets", () => {
  it("GETs the datasets endpoint and parses the array", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(envelope([datasetResult()]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const datasets = await client.listLogExplorerDatasets();
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/datasets");
      expect(new URL(capturedUrl).searchParams.get("include_zones")).toBeNull();
      expect(datasets.length).toBe(1);
      expect(datasets[0]?.dataset_id).toBe("ds-1");
    } finally {
      restore();
    }
  });

  it("passes include_zones through and returns [] for a null result", async () => {
    const client = new CloudflareClient(tokenConfig({ accountId: "acc-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(envelope(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      const datasets = await client.listLogExplorerDatasets({
        scope: "account",
        includeZones: true,
      });
      expect(capturedUrl).toContain("/accounts/acc-1/logs/explorer/datasets");
      expect(new URL(capturedUrl).searchParams.get("include_zones")).toBe("true");
      expect(datasets).toEqual([]);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getLogExplorerDataset", () => {
  it("GETs a single dataset with fields and filter", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        envelope(
          datasetResult({
            fields: [{ enabled: true, name: "ClientIP" }],
            filter: '{http.request.method=="GET"}',
          })
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const dataset = await client.getLogExplorerDataset({ datasetId: "ds-1" });
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/datasets/ds-1");
      expect(dataset.fields).toEqual([{ enabled: true, name: "ClientIP" }]);
      expect(dataset.filter).toBe('{http.request.method=="GET"}');
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.updateLogExplorerDataset", () => {
  it("PUTs enabled, fields, filter, and deletion_protection", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    let capturedBody = "";
    const restore = mockFetch((input, init) => {
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(
        envelope(datasetResult({ enabled: false })),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const dataset = await client.updateLogExplorerDataset({
        datasetId: "ds-1",
        enabled: false,
        fields: [
          { name: "ClientIP", enabled: true },
          { name: "RayID", enabled: false },
        ],
        filter: "",
        deletionProtection: false,
      });
      expect(capturedMethod).toBe("PUT");
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/datasets/ds-1");
      expect(JSON.parse(capturedBody)).toEqual({
        enabled: false,
        deletion_protection: false,
        fields: [
          { name: "ClientIP", enabled: true },
          { name: "RayID", enabled: false },
        ],
        filter: "",
      });
      expect(dataset.enabled).toBe(false);
    } finally {
      restore();
    }
  });

  it("omits unset optional body keys", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedBody = "";
    const restore = mockFetch((_input, init) => {
      capturedBody = typeof init?.body === "string" ? init.body : "";
      return new Response(envelope(datasetResult()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await client.updateLogExplorerDataset({ datasetId: "ds-1", enabled: true });
      expect(JSON.parse(capturedBody)).toEqual({ enabled: true });
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.deleteLogExplorerDataset", () => {
  it("DELETEs the dataset endpoint", async () => {
    const client = new CloudflareClient(tokenConfig({ accountId: "acc-1" }));

    let capturedMethod = "";
    let capturedUrl = "";
    const restore = mockFetch((input, init) => {
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      return new Response(envelope(datasetResult()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    try {
      await client.deleteLogExplorerDataset({
        datasetId: "ds-1",
        scope: "account",
      });
      expect(capturedMethod).toBe("DELETE");
      expect(capturedUrl).toContain("/accounts/acc-1/logs/explorer/datasets/ds-1");
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.listAvailableLogExplorerDatasets", () => {
  it("GETs the available endpoint and parses schemas", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return new Response(
        envelope([
          {
            dataset: "http_requests",
            object_type: "zone",
            timestamp_field: "EdgeStartTimestamp",
            schema: {
              type: "object",
              properties: { ClientIP: { type: "string" } },
              required: ["ClientIP"],
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      const datasets = await client.listAvailableLogExplorerDatasets();
      expect(capturedUrl).toContain("/zones/zone-1/logs/explorer/datasets/available");
      expect(datasets.length).toBe(1);
      expect(datasets[0]?.timestamp_field).toBe("EdgeStartTimestamp");
      expect(datasets[0]?.schema?.required).toEqual(["ClientIP"]);
    } finally {
      restore();
    }
  });
});
