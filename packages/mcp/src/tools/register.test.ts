import { describe, expect, test } from "bun:test";
import { registerAuditTools } from "./audit.js";
import { registerCacheTools } from "./cache.js";
import { registerDnsTools } from "./dns.js";
import { registerResourceTools } from "./resources.js";

interface FakeServer {
  readonly tools: string[];
  addTool: (tool: { name: string }) => void;
}

function makeFakeServer(): FakeServer {
  const tools: string[] = [];
  return {
    tools,
    addTool(tool) {
      tools.push(tool.name);
    },
  };
}

describe("MCP tool registration", () => {
  test("registers expected tool names without throwing", () => {
    const server = makeFakeServer();
    registerResourceTools(server as unknown as Parameters<typeof registerResourceTools>[0]);
    registerAuditTools(server as unknown as Parameters<typeof registerAuditTools>[0]);
    registerCacheTools(server as unknown as Parameters<typeof registerCacheTools>[0]);
    registerDnsTools(server as unknown as Parameters<typeof registerDnsTools>[0]);

    expect(server.tools).toEqual(
      expect.arrayContaining([
        "list_resources",
        "get_resource",
        "create_resource",
        "delete_resource",
        "list_audit_logs",
        "purge_cache_by_prefixes",
        "purge_cache_by_tags",
        "list_dns_records",
        "update_dns_record",
      ])
    );
  });
});
