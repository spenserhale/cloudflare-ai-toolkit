import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";

function tokenConfig(overrides: Partial<{ accountId: string; zoneId: string }> = {}) {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
    ...overrides,
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

function envelope(result: unknown): Response {
  return new Response(
    JSON.stringify({ success: true, errors: [], messages: [], result }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

const ZONE_WITHOUT_ZCNS = {
  id: "zone-1",
  name: "example.com",
  status: "active",
  name_servers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
  vanity_name_servers: [],
  vanity_name_servers_ips: null,
};

const ZONE_WITH_ZCNS = {
  ...ZONE_WITHOUT_ZCNS,
  vanity_name_servers: ["ns1.example.com", "ns2.example.com"],
  vanity_name_servers_ips: [
    { ns_name: "ns1.example.com", ipv4: "198.51.100.1", ipv6: "2606:4700::1" },
    { ns_name: "ns2.example.com", ipv4: "198.51.100.2", ipv6: "2606:4700::2" },
  ],
};

describe("CloudflareClient.getZoneVanityNameServers", () => {
  it("reads the configured zone and reports the assigned glue addresses", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-from-config" }));

    let capturedUrl = "";
    let capturedMethod = "";
    const restore = mockFetch((input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "";
      return envelope(ZONE_WITH_ZCNS);
    });

    try {
      const result = await client.getZoneVanityNameServers();

      expect(capturedMethod).toBe("GET");
      expect(new URL(capturedUrl).pathname).toBe("/client/v4/zones/zone-from-config");
      expect(result).toEqual({
        zoneId: "zone-1",
        zoneName: "example.com",
        enabled: true,
        nameServers: ["ns1.example.com", "ns2.example.com"],
        ips: [
          { ns_name: "ns1.example.com", ipv4: "198.51.100.1", ipv6: "2606:4700::1" },
          { ns_name: "ns2.example.com", ipv4: "198.51.100.2", ipv6: "2606:4700::2" },
        ],
        assignedNameServers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
      });
    } finally {
      restore();
    }
  });

  it("reports disabled when the zone has no custom nameservers", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(() => envelope(ZONE_WITHOUT_ZCNS));

    try {
      const result = await client.getZoneVanityNameServers("zone-1");
      expect(result.enabled).toBe(false);
      expect(result.nameServers).toEqual([]);
      expect(result.ips).toEqual([]);
    } finally {
      restore();
    }
  });

  it("degrades to an empty IP list when Cloudflare returns an unfamiliar shape", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(() =>
      envelope({ ...ZONE_WITH_ZCNS, vanity_name_servers_ips: "unexpected" })
    );

    try {
      const result = await client.getZoneVanityNameServers("zone-1");
      expect(result.nameServers).toEqual(["ns1.example.com", "ns2.example.com"]);
      expect(result.ips).toEqual([]);
    } finally {
      restore();
    }
  });

  it("requires a zone ID", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(client.getZoneVanityNameServers()).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });
});

describe("CloudflareClient.setZoneVanityNameServers", () => {
  it("PATCHes the zone with only the vanity_name_servers property", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: unknown;
    const restore = mockFetch((input, init) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "";
      capturedBody = JSON.parse(String(init?.body));
      return envelope(ZONE_WITH_ZCNS);
    });

    try {
      const result = await client.setZoneVanityNameServers(
        ["ns1.example.com", "ns2.example.com"],
        "zone-1"
      );

      expect(capturedMethod).toBe("PATCH");
      expect(new URL(capturedUrl).pathname).toBe("/client/v4/zones/zone-1");
      expect(capturedBody).toEqual({
        vanity_name_servers: ["ns1.example.com", "ns2.example.com"],
      });
      expect(result.enabled).toBe(true);
      expect(result.nameServers).toEqual(["ns1.example.com", "ns2.example.com"]);
    } finally {
      restore();
    }
  });

  it("trims and lowercases nameserver names before sending them", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedBody: unknown;
    const restore = mockFetch((_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return envelope(ZONE_WITH_ZCNS);
    });

    try {
      await client.setZoneVanityNameServers(
        ["  NS1.Example.COM ", "ns2.example.com"],
        "zone-1"
      );
      expect(capturedBody).toEqual({
        vanity_name_servers: ["ns1.example.com", "ns2.example.com"],
      });
    } finally {
      restore();
    }
  });

  it("rejects names that are not fully qualified hostnames", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(
      client.setZoneVanityNameServers(["ns1"], "zone-1")
    ).rejects.toThrow(/fully qualified hostname/u);
  });

  it("rejects duplicate names", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(
      client.setZoneVanityNameServers(["ns1.example.com", "NS1.example.com"], "zone-1")
    ).rejects.toThrow(/unique/u);
  });

  it("requires a zone ID", async () => {
    const client = new CloudflareClient(tokenConfig());
    await expect(
      client.setZoneVanityNameServers(["ns1.example.com"])
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it("surfaces the Zone Write permission hint on failure", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
            messages: [],
            result: null,
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        )
    );

    try {
      await expect(
        client.setZoneVanityNameServers(["ns1.example.com"], "zone-1")
      ).rejects.toMatchObject({ requiredPermissions: ["Zone Write"] });
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.clearZoneVanityNameServers", () => {
  it("sends an empty array", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedBody: unknown;
    const restore = mockFetch((_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return envelope(ZONE_WITHOUT_ZCNS);
    });

    try {
      const result = await client.clearZoneVanityNameServers("zone-1");
      expect(capturedBody).toEqual({ vanity_name_servers: [] });
      expect(result.enabled).toBe(false);
      expect(result.nameServers).toEqual([]);
    } finally {
      restore();
    }
  });
});
