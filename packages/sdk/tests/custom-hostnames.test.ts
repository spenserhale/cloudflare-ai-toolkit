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

const PENDING_HOSTNAME = {
  id: "ch-1",
  hostname: "app.example.com",
  status: "pending",
  ssl: {
    id: "cert-1",
    status: "pending_validation",
    type: "dv",
    method: "txt",
    hosts: ["app.example.com"],
    validation_records: [
      {
        txt_name: "_acme-challenge.app.example.com",
        txt_value: "810b7d5f01154524b961ba0cd578acc2",
      },
    ],
    validation_errors: [{ message: "SERVFAIL looking up CAA for app.example.com" }],
  },
  verification_errors: ["custom hostname does not CNAME to this zone."],
  ownership_verification: {
    type: "txt",
    name: "_cf-custom-hostname.app.example.com",
    value: "0e2d5a7f-1548-4f27-8c05-b577cb14f4ec",
  },
  created_at: "2026-08-01T12:00:00Z",
};

describe("CloudflareClient.listCustomHostnames", () => {
  it("requires a zone ID", async () => {
    const client = new CloudflareClient(tokenConfig({ accountId: "acc-1" }));
    await expect(client.listCustomHostnames()).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("maps filters onto the documented query parameters", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listCustomHostnames({
        hostname: "app.example.com",
        ssl: true,
        order: "ssl_status",
        direction: "desc",
        page: 2,
        perPage: 50,
      });

      const url = new URL(capturedUrl);
      expect(url.pathname).toBe("/client/v4/zones/zone-1/custom_hostnames");
      expect(url.searchParams.get("hostname")).toBe("app.example.com");
      expect(url.searchParams.get("ssl")).toBe("1");
      expect(url.searchParams.get("order")).toBe("ssl_status");
      expect(url.searchParams.get("direction")).toBe("desc");
      expect(url.searchParams.get("page")).toBe("2");
      expect(url.searchParams.get("per_page")).toBe("50");
    } finally {
      restore();
    }
  });

  it("sends ssl=0 when filtering for hostnames without a certificate", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope([]);
    });

    try {
      await client.listCustomHostnames({ ssl: false });
      expect(new URL(capturedUrl).searchParams.get("ssl")).toBe("0");
    } finally {
      restore();
    }
  });

  it("returns hostnames plus pagination metadata", async () => {
    const client = new CloudflareClient(tokenConfig());

    const restore = mockFetch(() =>
      envelope([PENDING_HOSTNAME], {
        page: 1,
        per_page: 20,
        count: 1,
        total_count: 1,
        total_pages: 1,
      })
    );

    try {
      const result = await client.listCustomHostnames({}, "zone-override");
      expect(result.hostnames).toHaveLength(1);
      expect(result.hostnames[0]?.hostname).toBe("app.example.com");
      expect(result.hostnames[0]?.ssl?.status).toBe("pending_validation");
      expect(result.resultInfo?.total_count).toBe(1);
    } finally {
      restore();
    }
  });

  it("rejects an out-of-range perPage before making a request", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));
    let called = false;
    const restore = mockFetch(() => {
      called = true;
      return envelope([]);
    });

    try {
      await expect(client.listCustomHostnames({ perPage: 100 })).rejects.toThrow();
      expect(called).toBe(false);
    } finally {
      restore();
    }
  });

  it("attaches the SSL permission hint when the token is not authorized", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

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
      await expect(client.listCustomHostnames()).rejects.toMatchObject({
        requiredPermissions: ["SSL and Certificates Read", "SSL and Certificates Write"],
      });
    } finally {
      restore();
    }
  });
});

describe("CloudflareClient.getCustomHostname", () => {
  it("fetches the custom hostname details endpoint", async () => {
    const client = new CloudflareClient(tokenConfig({ zoneId: "zone-1" }));

    let capturedUrl = "";
    const restore = mockFetch((input) => {
      capturedUrl = String(input);
      return envelope(PENDING_HOSTNAME);
    });

    try {
      const hostname = await client.getCustomHostname("ch-1");
      expect(new URL(capturedUrl).pathname).toBe(
        "/client/v4/zones/zone-1/custom_hostnames/ch-1"
      );
      expect(hostname.status).toBe("pending");
      expect(hostname.ssl?.validation_records?.[0]?.txt_name).toBe(
        "_acme-challenge.app.example.com"
      );
      expect(hostname.ssl?.validation_errors?.[0]?.message).toContain("SERVFAIL");
      expect(hostname.ownership_verification?.value).toBe(
        "0e2d5a7f-1548-4f27-8c05-b577cb14f4ec"
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
          errors: [{ code: 1436, message: "custom hostname not found" }],
          messages: [],
          result: null,
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    );

    try {
      await expect(client.getCustomHostname("missing")).rejects.toBeInstanceOf(
        CloudflareError
      );
    } finally {
      restore();
    }
  });
});
