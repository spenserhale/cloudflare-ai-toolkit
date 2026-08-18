---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add zone search and custom hostname (SSL for SaaS) support across SDK, CLI, and MCP.

- **SDK**: new `listZones(params?)`, `getZone(zoneId?)`, `listCustomHostnames(params?, zoneId?)`, and `getCustomHostname(customHostnameId, zoneId?)` methods on `CloudflareClient`. Zone name and account name filters accept Cloudflare's operator prefixes (`nameOperator: "contains"` sends `?name=contains:...`; `equal` is the default and sends the bare value). Adds Zod schemas (`Zone`, `ListZonesParams`, `CustomHostname`, `CustomHostnameSsl`, `ListCustomHostnamesParams`, …), a shared `ResultInfoSchema` for `result_info` pagination metadata, and permission hints for `/zones` (`Zone Read`) and `/zones/{id}/custom_hostnames` (`SSL and Certificates Read`).
- **CLI**: new `cloudflare zones list [name]` (exact match by default, `--operator contains` etc. for partial search, plus `--status`, `--type`, `--accountId`, `--accountName`, `--match`, `--order`, `--direction`, pagination) and `cloudflare zones get [zone-id]`. New `cloudflare custom-hostnames list` and `cloudflare custom-hostnames get <custom-hostname-id>`; the detail view prints hostname `status` and `ssl.status` side by side along with DCV validation records, validation errors, and ownership challenges, and states whether the hostname is ready for production traffic. Zone ID falls back to `CLOUDFLARE_ZONE_ID`.
- **MCP**: new `list_zones`, `get_zone`, `list_custom_hostnames`, and `get_custom_hostname` tools registered on the FastMCP server.
