---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add Cloudflare Log Explorer support across SDK, CLI, and MCP.

- **SDK**: new `queryLogExplorer(params, overrides?)` and `enableLogExplorerDataset(params, overrides?)` methods on `CloudflareClient`. Scope resolves from the `scope` parameter (`"account" | "zone"`), then falls back to `zoneId` > `accountId` from config. Adds Zod schemas (`QueryLogExplorerParams`, `QueryLogExplorerResult`, `LogExplorerDataset`, etc.) and permission hints for `/logs/explorer/...` routes.
- **CLI**: new `cloudflare log-explorer query` (accepts `--sql`, `--file`, or `--stdin`) and `cloudflare log-explorer datasets enable <dataset>` commands. TOON output by default, `--json` for machine-readable; `--scope`, `--account-id`, `--zone-id` overrides supported.
- **MCP**: new `query_log_explorer` and `enable_log_explorer_dataset` tools registered on the FastMCP server.
