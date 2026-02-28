import { describe, expect, it } from "bun:test";
import { CloudflareClient } from "../src/client.js";
import { CloudflareError } from "../src/errors.js";

describe("CloudflareClient", () => {
  it("should require an API key", () => {
    expect(() => new CloudflareClient({ apiKey: "" })).toThrow();
  });

  it("should accept a valid config", () => {
    const client = new CloudflareClient({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
    });
    expect(client).toBeDefined();
  });

  it("should require an account id for audit log calls", async () => {
    const client = new CloudflareClient({
      apiKey: "test-key",
      baseUrl: "https://api.example.com",
    });

    await expect(client.listAuditLogs()).rejects.toBeInstanceOf(CloudflareError);
  });
});
