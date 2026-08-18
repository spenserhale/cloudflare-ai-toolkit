---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add custom hostname lifecycle (create/update/delete) across SDK, CLI, and MCP, completing the existing list/get support.

- **SDK**: new `createCustomHostname(params, zoneId?)`, `updateCustomHostname(id, params, zoneId?)` (PATCH; partial updates validated to require at least one field; resending SSL config retriggers DCV), and `deleteCustomHostname(id, zoneId?)` on `CloudflareClient`. Adds `CustomHostnameSslInput`/`CustomHostnameSslSettings` schemas (method, wildcard, certificate authority, TLS settings) and permission hints for POST/PATCH/DELETE (`SSL and Certificates Write`).
- **CLI**: new `cloudflare custom-hostnames create <hostname>` (`--sslMethod http|txt|email`, `--sslWildcard`, `--certificateAuthority`, `--customOriginServer`, `--customOriginSni`, `--metadata <json>`), `custom-hostnames update <id>`, and `custom-hostnames delete <id> [--yes]` with interactive confirmation that refuses to run non-interactively without `--yes`.
- **MCP**: new `create_custom_hostname`, `update_custom_hostname`, and `delete_custom_hostname` tools.
