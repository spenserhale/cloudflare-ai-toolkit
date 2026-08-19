# @cloudflare-ai-toolkit/mcp

MCP server for Cloudflare, built with [FastMCP](https://github.com/punkpeye/fastmcp).

## Install

```bash
npm install -g @cloudflare-ai-toolkit/mcp
# or run ad-hoc: npx -y @cloudflare-ai-toolkit/mcp
```

Requires Node 20+. Installs a `cloudflare-mcp` binary.

## Tools

| Tool | Description |
|------|-------------|
| `list_resources` | List resources with pagination |
| `get_resource` | Get a resource by ID |
| `create_resource` | Create a new resource |
| `delete_resource` | Delete a resource |
| `list_audit_logs` | List audit logs with user/action filters |
| `purge_cache_by_prefixes` | Purge cached content by URL prefix(es); zone ID falls back to `CLOUDFLARE_ZONE_ID` |
| `purge_cache_by_tags` | Purge cached content by cache tag(s); zone ID falls back to `CLOUDFLARE_ZONE_ID` |
| `list_dns_records` | List DNS records for a zone |
| `update_dns_record` | Update an existing DNS record |
| `list_zones` | List, search, and filter zones — resolve a domain name to a zone ID |
| `get_zone` | Get one zone's status, type, plan, and nameservers; falls back to `CLOUDFLARE_ZONE_ID` |
| `get_zone_vanity_nameservers` | Read a zone's custom (vanity) nameservers and the glue addresses assigned to them |
| `set_zone_vanity_nameservers` | Replace a zone's custom nameservers (Business/Enterprise; names must be subdomains of the zone) |
| `clear_zone_vanity_nameservers` | Remove a zone's custom nameservers and their read-only A/AAAA records |
| `list_custom_hostnames` | List custom hostnames (SSL for SaaS) with hostname and certificate status |
| `get_custom_hostname` | Get one custom hostname's certificate state, DCV records, and ownership challenges |
| `create_custom_hostname` | Create a custom hostname and request its certificate |
| `update_custom_hostname` | Update a custom hostname's origin, metadata, or SSL config; resending SSL retriggers DCV |
| `delete_custom_hostname` | Delete a custom hostname and its certificate |
| `list_firewall_rules` | List firewall (WAF custom) rules with actions, expressions, and paused state |
| `get_firewall_rule` | Get one firewall rule by ID, including its filter expression |
| `create_firewall_rule` | Create a firewall rule from a rules-language expression (supports paused staging) |
| `update_firewall_rule` | Replace a firewall rule's action/expression (PUT; resend current values to keep them) |
| `delete_firewall_rule` | Delete a firewall rule |
| `list_redirect_rules` | List redirect rules in a zone (first match wins) |
| `get_redirect_rule` | Get one redirect rule: expression, target, status code, state |
| `create_redirect_rule` | Create a redirect rule from an expression (supports dryRun validation) |
| `update_redirect_rule` | Partially update a redirect rule; unspecified fields keep their values |
| `delete_redirect_rule` | Delete a redirect rule |
| `query_log_explorer` | Run a SQL query against Log Explorer (account or zone scope) |
| `enable_log_explorer_dataset` | Enable a Log Explorer dataset for the account or zone |
| `list_log_explorer_datasets` | List configured Log Explorer datasets with their IDs and enabled state |
| `list_available_log_explorer_datasets` | List dataset types the account or zone can enable, with schemas and timestamp fields |
| `get_log_explorer_dataset` | Get one dataset's field configuration, filter, and ingest state |
| `update_log_explorer_dataset` | Update a dataset: enable/disable ingest, restrict fields, set or clear a filter |
| `delete_log_explorer_dataset` | Delete a dataset and stop its log ingest |

## Setup with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cloudflare-ai-toolkit": {
      "command": "npx",
      "args": ["-y", "@cloudflare-ai-toolkit/mcp"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Development

```bash
# Run in stdio mode from source
bun run dev

# Inspect with FastMCP inspector
bun run inspect
```
