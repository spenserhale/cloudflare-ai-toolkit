import { describe, expect, it } from "bun:test";
import { registerDnsTools } from "./dns.js";

describe("create_dns_record", () => {
  it("creates TXT records and returns the ID without changing content", async () => {
    let tool: any;
    registerDnsTools({ addTool: (candidate: any) => {
      if (candidate.name === "create_dns_record") tool = candidate;
    } } as Parameters<typeof registerDnsTools>[0]);
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_TOKEN = "test-token";
    const params = { type: "TXT", name: "pbhsdevelop.com", content: "v=spf1 include:_spf.paubox.com -all" };
    const record = { id: "rec-new", ...params };
    globalThis.fetch = (async (_input: unknown, init: RequestInit) => {
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual(params);
      return Response.json({ success: true, errors: [], messages: [], result: record });
    }) as typeof fetch;
    try {
      const args = tool.parameters.parse({ zoneId: "zone-1", ...params });
      expect(JSON.parse(await tool.execute(args))).toEqual(record);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = originalToken;
    }
  });
});
