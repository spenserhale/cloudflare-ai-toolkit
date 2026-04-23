# Cloudflare Toolkit

Cloudflare integration tools — a typed SDK, a standalone CLI, and an MCP server.

## Packages

| Package | Description |
|---------|-------------|
| [`@cloudflare-ai-toolkit/sdk`](./packages/sdk) | Core SDK with types, API client, and business logic |
| [`@cloudflare-ai-toolkit/cli`](./packages/cli) | Command-line interface (Stricli) |
| [`@cloudflare-ai-toolkit/mcp`](./packages/mcp) | MCP server for AI assistants (FastMCP) |

## Install the CLI

### Recommended: standalone binary

No Node.js, no npm, no PATH conflicts. One file.

**macOS and Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/spenserhale/cloudflare-ai-toolkit/main/scripts/install.sh | sh
```

The script detects your OS + architecture, downloads the matching binary from
the [latest release](https://github.com/spenserhale/cloudflare-ai-toolkit/releases/latest),
verifies its SHA256, and installs to `$HOME/.local/bin/cloudflare`. Pin a
specific version with `CLOUDFLARE_TOOLKIT_VERSION=v0.1.1` or change the install
directory with `CLOUDFLARE_TOOLKIT_INSTALL=$HOME/bin`.

**Windows:** grab `cloudflare-windows-x64.exe` from the
[latest release](https://github.com/spenserhale/cloudflare-ai-toolkit/releases/latest)
and put it on your `PATH`.

**Updating:** re-run the install command, or use the built-in:

```bash
cloudflare upgrade          # install latest
cloudflare upgrade --check  # check without installing
```

Available binaries: `cloudflare-linux-{x64,arm64}`, `cloudflare-darwin-{x64,arm64}`,
`cloudflare-windows-x64.exe`. A `.sha256` sits next to each one; an aggregated
`SHASUMS256.txt` is attached to the release.

### Alternative: install from npm

Useful inside Node projects or if you want the CLI available via `npx`:

```bash
npm install -g @cloudflare-ai-toolkit/cli
# or: bun add -g @cloudflare-ai-toolkit/cli
# or: pnpm add -g @cloudflare-ai-toolkit/cli

# one-off:
npx @cloudflare-ai-toolkit/cli audit logs list --help
```

## Use the SDK in your code

```bash
npm install @cloudflare-ai-toolkit/sdk
```

```ts
import { CloudflareClient } from "@cloudflare-ai-toolkit/sdk";

const cf = new CloudflareClient({
  auth: { type: "apiToken", token: process.env.CLOUDFLARE_API_TOKEN! },
});
```

## Use the MCP server

For Claude Desktop and other MCP-compatible hosts. Add to your MCP config:

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@cloudflare-ai-toolkit/mcp"],
      "env": { "CLOUDFLARE_API_TOKEN": "..." }
    }
  }
}
```

## Environment variables

```
CLOUDFLARE_API_TOKEN     preferred (Bearer auth)
CLOUDFLARE_API_KEY       legacy fallback (Global API Key)
CLOUDFLARE_EMAIL         required when using CLOUDFLARE_API_KEY
CLOUDFLARE_ACCOUNT_ID    default for audit-log commands/tools
CLOUDFLARE_ZONE_ID       default for zone-scoped commands/tools (DNS, cache purge)
CLOUDFLARE_BASE_URL      override (default https://api.cloudflare.com)
```

The SDK also walks parent directories looking for a `.env` file.

## Commands

### Audit logs

```bash
cloudflare audit logs list \
  --since 2026-02-01T00:00:00Z \
  --before 2026-02-02T00:00:00Z \
  --actorEmail alice@example.com \
  --actionType zone.settings.update
```

### DNS records

```bash
cloudflare dns records list <zone-id> --type A --name app.example.com
cloudflare dns records update <zone-id> <record-id> --content 203.0.113.10 --proxied true
```

### Cache purge

Destructive purges (`everything`, `prefixes`, `hosts`) prompt for confirmation.
Pass `--yes` to skip the prompt or to run non-interactively (e.g. in CI).

```bash
cloudflare cache purge everything --zone-id <zone-id> --yes
cloudflare cache purge urls https://example.com/a https://example.com/b
cloudflare cache purge tags my-tag
cloudflare cache purge prefixes example.com/assets/ --yes
cloudflare cache purge hosts cdn.example.com --yes
```

## Local development

```bash
bun install
bun run build
bun run dev:cli -- --help
bun run dev:mcp
bun test
```

## Architecture

```
packages/sdk/           types, API client, business logic (foundation)
    ^         ^
    |         |
packages/cli/   packages/mcp/
(Stricli)       (FastMCP)
```

CLI and MCP are thin wrappers over the SDK. REST API changes → update the
SDK → both consumers get the fix.

## Releasing

Releases are automated via [Changesets](https://github.com/changesets/changesets)
and GitHub Actions.

1. Make changes, run `bun changeset` and pick a version bump. Commit the file
   under `.changeset/`.
2. On push to `main`, the `Release` workflow opens a "Version Packages" PR.
3. Merging that PR bumps versions, publishes the three packages to npm via
   `bun publish` (which strips `workspace:` protocol specifiers automatically),
   and creates a GitHub Release.
4. The `Binaries` workflow compiles standalone binaries for Linux/macOS/Windows
   (x64 + arm64) with `bun build --compile --bytecode` and attaches them to the
   release.

### One-time repo setup

- Add `NPM_TOKEN` as a repo secret. Use a Classic Automation token (bypasses
  2FA in CI) or a Granular Access Token scoped to `@cloudflare-ai-toolkit` with
  publish permission.
- Ensure the `@cloudflare-ai-toolkit` scope on npm exists and you're an owner.
- The default `GITHUB_TOKEN` handles release creation and asset uploads.

### Trade-off on npm provenance

We publish via `bun publish` (not `npm publish`) because Bun rewrites our
`workspace:` internal-dependency specifiers on publish; npm does not. Today
that means **no npm provenance attestations** on the published tarballs —
[Bun doesn't yet support npm OIDC / sigstore](https://github.com/oven-sh/bun/issues/22423).
The standalone binaries remain the primary distribution path and carry their
own SHA256 verification against the GitHub Release.
