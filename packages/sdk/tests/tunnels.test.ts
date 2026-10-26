import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";

function tokenConfig(overrides: Partial<{ accountId: string }> = { accountId: "acc-1" }) {
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

const TUNNEL = {
  id: "f70ff985-a4ef-4643-bbbc-4a0ed4fc8415",
  account_tag: "acc-1",
  name: "office-gateway",
  status: "healthy",
  tun_type: "cfd_tunnel",
  config_src: "cloudflare",
  remote_config: true,
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  conns_active_at: "2026-10-01T00:00:00Z",
  conns_inactive_at: null,
  connections: [],
  metadata: {},
};

const CONNECTOR = {
  id: "1bedc50d-42b3-473c-b108-ff3d10c0d925",
  arch: "linux_amd64",
  version: "2026.9.1",
  config_version: 7,
  run_at: "2026-10-01T00:00:00Z",
  features: ["serialized_headers"],
  conns: [
    {
      id: "1bedc50d-42b3-473c-b108-ff3d10c0d925",
      client_id: "1bedc50d-42b3-473c-b108-ff3d10c0d925",
      client_version: "2026.9.1",
      colo_name: "sea01",
      is_pending_reconnect: false,
      opened_at: "2026-10-01T00:00:01Z",
      origin_ip: "203.0.113.10",
      uuid: "e3a3a1b2-0000-4000-8000-000000000001",
    },
  ],
};

describe("CloudflareClient.listTunnels", () => {
  it("maps filters onto the cfd_tunnel query string", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([TUNNEL], { page: 1, per_page: 20, count: 1, total_count: 1 });
    });

    try {
      const result = await client.listTunnels({
        name: "office-gateway",
        status: "healthy",
        isDeleted: false,
        page: 2,
        perPage: 50,
      });
      const url = new URL(capturedUrl);
      expect(url.pathname).toBe("/client/v4/accounts/acc-1/cfd_tunnel");
      expect(url.searchParams.get("name")).toBe("office-gateway");
      expect(url.searchParams.get("status")).toBe("healthy");
      expect(url.searchParams.get("is_deleted")).toBe("false");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("per_page")).toBe("50");
      expect(result.tunnels).toHaveLength(1);
      expect(result.tunnels[0]!.name).toBe("office-gateway");
      expect(result.resultInfo?.total_count).toBe(1);
    } finally {
      restore();
    }
  });

  it("omits is_deleted when it is not specified", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listTunnels();
      expect(new URL(capturedUrl).searchParams.has("is_deleted")).toBe(false);
    } finally {
      restore();
    }
  });

  it("prefers an explicit accountId over the configured one", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listTunnels({ accountId: "acc-2" });
      expect(new URL(capturedUrl).pathname).toBe("/client/v4/accounts/acc-2/cfd_tunnel");
    } finally {
      restore();
    }
  });

  it("requires an account ID", async () => {
    const client = new CloudflareClient(tokenConfig({}));
    await expect(client.listTunnels()).rejects.toThrow("Account ID is required");
  });

  it("attaches the Cloudflare Tunnel permission hint on 403", async () => {
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
          { status: 403 }
        )
    );

    try {
      await client.listTunnels();
      throw new Error("expected listTunnels to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareError);
      expect((err as CloudflareError).requiredPermissions).toContain("Cloudflare Tunnel Read");
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getTunnelInfo", () => {
  it("fetches the tunnel and its connectors", async () => {
    const client = new CloudflareClient(tokenConfig());

    const paths: string[] = [];
    const restore = mockFetch((input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return path.endsWith("/connections") ? envelope([CONNECTOR]) : envelope(TUNNEL);
    });

    try {
      const info = await client.getTunnelInfo(TUNNEL.id);
      expect(paths.sort()).toEqual([
        `/client/v4/accounts/acc-1/cfd_tunnel/${TUNNEL.id}`,
        `/client/v4/accounts/acc-1/cfd_tunnel/${TUNNEL.id}/connections`,
      ]);
      expect(info.tunnel.name).toBe("office-gateway");
      expect(info.connectors).toHaveLength(1);
      expect(info.connectors[0]!.conns?.[0]?.colo_name).toBe("sea01");
    } finally {
      restore();
    }
  });

  it("treats a null connections result as no connectors", async () => {
    const client = new CloudflareClient(tokenConfig());
    const restore = mockFetch(() => envelope(null));

    try {
      expect(await client.listTunnelConnections(TUNNEL.id)).toEqual([]);
    } finally {
      restore();
    }
  });
});
