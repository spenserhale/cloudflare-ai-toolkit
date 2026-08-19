import { describe, expect, test } from "bun:test";
import { registerAuditTools } from "./audit.js";
import { registerCacheTools } from "./cache.js";
import { registerCustomHostnameTools } from "./custom-hostnames.js";
import { registerDnsTools } from "./dns.js";
import { registerLogExplorerTools } from "./log-explorer.js";
import { registerRedirectTools } from "./redirects.js";
import { registerResourceTools } from "./resources.js";
import { registerWafTools } from "./waf.js";
import { registerZoneTools } from "./zones.js";

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
    registerLogExplorerTools(server as unknown as Parameters<typeof registerLogExplorerTools>[0]);
    registerRedirectTools(server as unknown as Parameters<typeof registerRedirectTools>[0]);
    registerWafTools(server as unknown as Parameters<typeof registerWafTools>[0]);
    registerZoneTools(server as unknown as Parameters<typeof registerZoneTools>[0]);
    registerCustomHostnameTools(
      server as unknown as Parameters<typeof registerCustomHostnameTools>[0]
    );

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
        "query_log_explorer",
        "enable_log_explorer_dataset",
        "list_log_explorer_datasets",
        "list_available_log_explorer_datasets",
        "get_log_explorer_dataset",
        "update_log_explorer_dataset",
        "delete_log_explorer_dataset",
        "list_zones",
        "get_zone",
        "get_zone_vanity_nameservers",
        "set_zone_vanity_nameservers",
        "clear_zone_vanity_nameservers",
        "list_custom_hostnames",
        "get_custom_hostname",
        "create_custom_hostname",
        "update_custom_hostname",
        "delete_custom_hostname",
        "list_firewall_rules",
        "get_firewall_rule",
        "create_firewall_rule",
        "update_firewall_rule",
        "delete_firewall_rule",
        "list_redirect_rules",
        "get_redirect_rule",
        "create_redirect_rule",
        "update_redirect_rule",
        "delete_redirect_rule",
      ])
    );
  });
});
