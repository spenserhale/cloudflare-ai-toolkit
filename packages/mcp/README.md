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
| `list_audit_logs` | List one page of audit logs with user/action/product filters |
| `search_audit_logs` | Search audit logs across all pages with server-side filters, client-side regex/where matching, and empty-result hints |
| `audit_log_facets` | Count audit events by product, type, action, actor, and zone to discover filter values |
| `custom_hostname_history` | Create/update/delete timeline for a custom hostname, flagging likely re-creates |
| `purge_cache_by_prefixes` | Purge cached content by URL prefix(es); zone ID falls back to `CLOUDFLARE_ZONE_ID` |
| `purge_cache_by_tags` | Purge cached content by cache tag(s); zone ID falls back to `CLOUDFLARE_ZONE_ID` |
| `list_dns_records` | List DNS records for a zone |
| `create_dns_record` | Create a DNS record and return its ID; TXT content preserves spaces |
| `update_dns_record` | Update an existing DNS record |
| `delete_dns_record` | Delete a DNS record from a zone |
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
| `list_tunnels` | List Cloudflare Tunnels (cloudflared) in an account with their health status |
| `get_tunnel` | Get one tunnel plus its running connectors, their versions, colos, and origin IPs |
| `search_domains` | Suggest available domain names for a keyword, with indicative pricing |
| `check_domains` | Check live availability and price for up to 20 domains |
| `register_domain` | **Billable.** Register a domain; re-checks availability and refuses if the live price exceeds the caller's `maxRegistrationCost` |
| `get_domain_registration_status` | Get the state of an API-started registration workflow |
| `get_domain_registration` | Get a registered domain's status, expiry, auto-renew, and privacy settings |
| `list_domain_registrations` | List the account's registered domains (cursor-paginated) |

All Registrar tools accept `sandbox: true` to use Cloudflare's non-billing
Registrar sandbox. `register_domain` is annotated `destructiveHint: true`; it
requires the price and currency the user approved from `check_domains`, and it
refuses premium, unavailable, or more expensive domains instead of buying them.

### Read and write permissions

Every tool declares MCP annotations. Read tools set `readOnlyHint: true`;
tools that create, change, delete, purge, or buy set `readOnlyHint: false`, and
the ones that change or remove existing state (including `register_domain`)
also set `destructiveHint: true`. Clients use these hints to group tools. In
Claude's connector settings, for example, read tools and write/delete tools
are listed separately, and an administrator can set each tool to Always allow,
Ask, or Block. To require approval for every domain purchase, set
`register_domain` to Ask; to forbid purchases, set it to Block.

### Errors

Failed tool calls return an explanation rather than a bare message: the
Cloudflare error code, the request method and path, the permission to add
when known, what the HTTP status means (for example, which account a 403
token must include), known fixes such as where to set a default registrant
contact, and a docs link.

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
