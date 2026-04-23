# Cloudflare Toolkit

Cloudflare integration tools

A monorepo containing the SDK, CLI, and MCP server for the Cloudflare API.

## Packages

| Package | Description |
|---------|-------------|
| [`@cloudflare-ai-toolkit/sdk`](./packages/sdk) | Core SDK with types, API client, and business logic |
| [`@cloudflare-ai-toolkit/cli`](./packages/cli) | Command-line interface (Stricli) |
| [`@cloudflare-ai-toolkit/mcp`](./packages/mcp) | MCP server for AI assistants (FastMCP) |

## Installation

### npm (requires Node 20+)

```bash
npm install -g @cloudflare-ai-toolkit/cli
# or: pnpm add -g @cloudflare-ai-toolkit/cli
# or: bun add -g @cloudflare-ai-toolkit/cli

cloudflare --help
```

One-off run without installing:

```bash
npx @cloudflare-ai-toolkit/cli audit logs list --help
```

### Standalone binary (no Node required)

macOS and Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/spenserhale/cloudflare-ai-toolkit/main/scripts/install.sh | sh
```

Windows and manual installs: grab the matching binary from the
[latest release](https://github.com/spenserhale/cloudflare-ai-toolkit/releases/latest)
and put it on your `PATH`. Available assets: `cloudflare-linux-x64`,
`cloudflare-linux-arm64`, `cloudflare-darwin-x64`, `cloudflare-darwin-arm64`,
`cloudflare-windows-x64.exe`. A `.sha256` sits next to each one, and an
aggregated `SHASUMS256.txt` is attached to the release.

### Programmatic use (SDK)

```bash
npm install @cloudflare-ai-toolkit/sdk
```

```ts
import { CloudflareClient } from "@cloudflare-ai-toolkit/sdk";

const cf = new CloudflareClient({
  auth: { type: "apiToken", token: process.env.CLOUDFLARE_API_TOKEN! },
});
```

## Local development

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
CLOUDFLARE_ZONE_ID=...         # optional default for zone-scoped commands/tools (DNS, cache purge)
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

### Cache purge

Destructive purges (`everything`, `prefixes`, `hosts`) prompt for confirmation.
Pass `--yes` to skip the prompt or to run non-interactively (e.g. in CI).

```bash
# Purge everything for a zone (requires confirmation or --yes)
bun run dev:cli -- cache purge everything --zone-id <zone-id> --yes

# Purge specific URLs
bun run dev:cli -- cache purge urls https://example.com/a https://example.com/b

# Purge by cache tag
bun run dev:cli -- cache purge tags my-tag

# Purge by URL prefix (requires confirmation or --yes)
bun run dev:cli -- cache purge prefixes example.com/assets/ --yes

# Purge by hostname (requires confirmation or --yes)
bun run dev:cli -- cache purge hosts cdn.example.com --yes
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

## Releasing

Releases are automated via [Changesets](https://github.com/changesets/changesets)
and GitHub Actions.

1. Make changes, then run `bun changeset` and pick a version bump. Commit the
   generated file under `.changeset/`.
2. On merge to `main`, the `Release` workflow opens a "Version Packages" PR.
3. Merging that PR bumps versions, publishes `@cloudflare-ai-toolkit/sdk`,
   `@cloudflare-ai-toolkit/cli`, and `@cloudflare-ai-toolkit/mcp` to npm with
   provenance, and creates a GitHub Release.
4. The `Binaries` workflow builds standalone Bun-compiled binaries for
   Linux/macOS/Windows (x64 + arm64) and attaches them to the release.

### One-time repo setup

- Add an `NPM_TOKEN` secret (a granular token with publish scope for the
  `@cloudflare-ai-toolkit` scope), or configure [npm trusted publishing](https://docs.npmjs.com/trusted-publishers)
  for this repo and remove the token dependency from the workflow.
- Ensure the `@cloudflare-ai-toolkit` scope on npm exists and you're an owner.
- The default `GITHUB_TOKEN` handles release creation and asset uploads.
