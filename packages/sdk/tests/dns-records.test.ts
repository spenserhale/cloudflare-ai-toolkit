import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";

function tokenConfig() {
  return {
    auth: { type: "apiToken" as const, token: "test-token" },
    baseUrl: "https://api.example.com",
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

describe("CloudflareClient.deleteDnsRecord", () => {
  it("DELETEs the record", async () => {
    const client = new CloudflareClient(tokenConfig());

    let capturedMethod = "";
    let capturedUrl = "";
    const restore = mockFetch((input, init) => {
      capturedMethod = init?.method ?? "";
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({ success: true, errors: [], messages: [], result: { id: "rec-1" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    try {
      await client.deleteDnsRecord("zone-1", "rec-1");
      expect(capturedMethod).toBe("DELETE");
      expect(capturedUrl).toContain("/client/v4/zones/zone-1/dns_records/rec-1");
    } finally {
      restore();
    }
  });

  it("reports the DNS Write permission on a 403", async () => {
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
      await expect(client.deleteDnsRecord("zone-1", "rec-1")).rejects.toMatchObject({
        requiredPermissions: ["DNS Write"],
      });
    } finally {
      restore();
    }
  });
});


describe("CloudflareClient.createDnsRecord", () => {
  it("POSTs TXT content unchanged and returns the created ID", async () => {
    const record = { id: "rec-new", type: "TXT", name: "pbhsdevelop.com", content: "v=spf1 include:_spf.paubox.com -all", ttl: 300, proxied: false, comment: "SPF record" };
    const { id, ...params } = record;
    const restore = mockFetch((input, init) => {
      expect(String(input)).toContain("/client/v4/zones/zone-1/dns_records");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual(params);
      return Response.json({ success: true, errors: [], messages: [], result: record });
    });
    try {
      expect(await new CloudflareClient(tokenConfig()).createDnsRecord("zone-1", params)).toEqual(record);
    } finally { restore(); }
  });

  for (const status of [400, 403]) {
    it(`surfaces API errors for HTTP ${status}`, async () => {
      const message = status === 400 ? "DNS Validation Error" : "Unauthorized to access requested resource";
      const restore = mockFetch(() => Response.json({ success: false, errors: [{ code: status === 400 ? 1004 : 9109, message }], messages: [], result: null }, { status }));
      try {
        const pending = new CloudflareClient(tokenConfig()).createDnsRecord("zone-1", { type: "TXT", name: "pbhsdevelop.com", content: "test" });
        await expect(pending).rejects.toMatchObject({ message: expect.stringContaining(message), ...(status === 403 ? { requiredPermissions: ["DNS Write"] } : {}) });
      } finally { restore(); }
    });
  }
});
