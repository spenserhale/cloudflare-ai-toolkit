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

function envelope(result: unknown, resultInfo?: unknown): Response {
  return new Response(
    JSON.stringify({
      success: true,
      errors: [],
      messages: [],
      result,
      result_info: resultInfo,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const ZONE = {
  id: "zone-1",
  name: "myedgewooddental.com",
  status: "active",
  paused: false,
  type: "full",
  account: { id: "acc-1", name: "Example Account" },
  plan: { id: "plan-1", name: "Free Website" },
  name_servers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
  original_name_servers: null,
  original_registrar: "GoDaddy",
  original_dnshost: null,
  development_mode: 0,
  created_on: "2024-01-01T05:20:00.12345Z",
  activated_on: "2024-01-02T00:01:00.12345Z",
  modified_on: "2026-08-01T00:00:00Z",
  meta: { cdn_only: false, dns_only: false },
};

describe("CloudflareClient.listZones", () => {
  it("sends a bare name for the default (equal) operator", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([ZONE]);
    });

    try {
      await client.listZones({ name: "myedgewooddental.com" });
      const url = new URL(capturedUrl);
      expect(url.pathname).toBe("/client/v4/zones");
      expect(url.searchParams.get("name")).toBe("myedgewooddental.com");
    } finally {
      restore();
    }
  });

  it("prefixes the name with the filter operator when one is given", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listZones({ name: "dental", nameOperator: "contains" });
      expect(new URL(capturedUrl).searchParams.get("name")).toBe("contains:dental");
    } finally {
      restore();
    }
  });

  it("maps account, status, type, and pagination filters", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listZones({
        accountId: "acc-1",
        accountName: "Example",
        accountNameOperator: "starts_with",
        status: "active",
        type: ["full", "partial"],
        match: "all",
        order: "name",
        direction: "desc",
        page: 3,
        perPage: 50,
      });

      const url = new URL(capturedUrl);
      expect(url.searchParams.get("account.id")).toBe("acc-1");
      expect(url.searchParams.get("account.name")).toBe("starts_with:Example");
      expect(url.searchParams.get("status")).toBe("active");
      expect(url.searchParams.get("type")).toBe("full,partial");
      expect(url.searchParams.get("match")).toBe("all");
      expect(url.searchParams.get("order")).toBe("name");
      expect(url.searchParams.get("direction")).toBe("desc");
      expect(url.searchParams.get("page")).toBe("3");
      expect(url.searchParams.get("per_page")).toBe("50");
    } finally {
      restore();
    }
  });

  it("omits filters that were not provided", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listZones();
      expect(new URL(capturedUrl).search).toBe("");
    } finally {
      restore();
    }
  });

  it("returns zones with pagination metadata and tolerates null fields", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(() =>
      envelope([ZONE], { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 })
    );

    try {
      const result = await client.listZones();
      expect(result.zones).toHaveLength(1);
      expect(result.zones[0]?.name).toBe("myedgewooddental.com");
      expect(result.zones[0]?.account?.name).toBe("Example Account");
      expect(result.zones[0]?.original_name_servers).toBeNull();
      expect(result.resultInfo?.total_count).toBe(1);
    } finally {
      restore();
    }
  });

  it("attaches the Zone Read permission hint on authorization failures", async () => {
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
      await expect(client.listZones()).rejects.toMatchObject({
        requiredPermissions: ["Zone Read"],
      });
    } finally {
      restore();
    }
  });

  it("propagates API failures as CloudflareError", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(() =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 1000, message: "Invalid status" }],
          messages: [],
          result: null,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await expect(client.listZones()).rejects.toBeInstanceOf(CloudflareError);
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getZone", () => {
  it("fetches the configured zone when no ID is passed", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-from-config" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope(ZONE);
    });

    try {
      const zone = await client.getZone();
      expect(new URL(capturedUrl).pathname).toBe("/client/v4/zones/zone-from-config");
      expect(zone.status).toBe("active");
      expect(zone.name_servers).toEqual([
        "bob.ns.cloudflare.com",
        "lola.ns.cloudflare.com",
      ]);
    } finally {
      restore();
    }
  });

  it("requires a zone ID", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(client.getZone()).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });
});
