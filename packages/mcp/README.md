# @cloudflare-toolkit/mcp

MCP server for Cloudflare, built with [FastMCP](https://github.com/punkpeye/fastmcp).

## Tools

| Tool | Description |
|------|-------------|
| `list_resources` | List resources with pagination |
| `get_resource` | Get a resource by ID |
| `create_resource` | Create a new resource |
| `delete_resource` | Delete a resource |
| `list_audit_logs` | List audit logs with user/action filters |
| `list_dns_records` | List DNS records for a zone |
| `update_dns_record` | Update an existing DNS record |

## Setup with Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cloudflare-toolkit": {
      "command": "bun",
      "args": ["run", "/Users/spenser/Code/Toolkits/cloudflare-toolkit/packages/mcp/src/index.ts"],
      "env": {
        "CLOUDFLARE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Development

```bash
# Run in stdio mode
bun run dev

# Inspect with FastMCP inspector
bun run inspect
```
