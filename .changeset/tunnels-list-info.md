---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add read-only Cloudflare Tunnel (cloudflared) inspection

- SDK: `CloudflareClient.listTunnels(params)` calls
  `GET /accounts/{account_id}/cfd_tunnel` with name, status, deleted, prefix,
  and paging filters. `getTunnel(tunnelId)` and
  `listTunnelConnections(tunnelId)` fetch one tunnel and its running
  connectors; `getTunnelInfo(tunnelId)` returns both. The tunnel object's own
  `connections` field is deprecated by Cloudflare and always empty, so
  connectors come from `/cfd_tunnel/{tunnel_id}/connections`. A 403 reports
  the required `Cloudflare Tunnel Read` permission.
- CLI: `cloudflare tunnels list [<name>]` lists tunnels, hiding deleted ones
  unless `--includeDeleted` is passed. `cloudflare tunnels info <tunnel-id|name>`
  shows the tunnel's status and each connector's version, architecture, colos,
  and origin IP. A name that matches no tunnel, or more than one, is an error.
- MCP: new `list_tunnels` and `get_tunnel` tools.
