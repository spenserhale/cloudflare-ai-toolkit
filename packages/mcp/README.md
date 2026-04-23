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
