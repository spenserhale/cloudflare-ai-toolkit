# Cloudflare Toolkit

Cloudflare integration tools

A monorepo containing the SDK, CLI, and MCP server for the Cloudflare API.

## Packages

| Package | Description |
|---------|-------------|
| [`@cloudflare-toolkit/sdk`](./packages/sdk) | Core SDK with types, API client, and business logic |
| [`@cloudflare-toolkit/cli`](./packages/cli) | Command-line interface (Stricli) |
| [`@cloudflare-toolkit/mcp`](./packages/mcp) | MCP server for AI assistants (FastMCP) |

## Getting Started

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run the CLI
bun run dev:cli -- --help

# Run the MCP server (stdio mode for Claude Desktop)
bun run dev:mcp
```

## Environment Variables

```bash
CLOUDFLARE_API_TOKEN=...       # preferred (Bearer auth)
CLOUDFLARE_API_KEY=...         # legacy fallback (Global API Key auth)
CLOUDFLARE_EMAIL=...           # required when using CLOUDFLARE_API_KEY
CLOUDFLARE_ACCOUNT_ID=...      # optional default for audit-log commands/tools
CLOUDFLARE_BASE_URL=...        # optional override (default https://api.cloudflare.com)
```

## Implemented Features

### Audit logs (v2)

```bash
# List audit logs and filter by actor + action type
bun run dev:cli -- audit logs list \
  --since 2026-02-01T00:00:00Z \
  --before 2026-02-02T00:00:00Z \
  --actorEmail alice@example.com \
  --actionType zone.settings.update
```

### DNS records

```bash
# List DNS records in a zone
bun run dev:cli -- dns records list <zone-id> --type A --name app.example.com

# Update a DNS record
bun run dev:cli -- dns records update <zone-id> <record-id> --content 203.0.113.10 --proxied true
```

## Architecture

```
packages/sdk/     <-- Types, API client, business logic (foundation)
    ^       ^
    |       |
packages/cli/   packages/mcp/
    (Stricli)    (FastMCP)
```

Both the CLI and MCP server are thin wrappers over the SDK. If the REST API
changes, you update the SDK and both consumers get the fix automatically.

## Development

```bash
# Run tests across all packages
bun test

# Build a specific package
cd packages/sdk && bun run build
```

## Adding a New API Operation

1. Add types to `packages/sdk/src/types.ts`
2. Add the client method to `packages/sdk/src/client.ts`
3. Add a CLI command in `packages/cli/src/commands/`
4. Add an MCP tool in `packages/mcp/src/tools/`
