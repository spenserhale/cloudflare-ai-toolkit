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

## Teach your AI agents about the CLI

If you use Claude Code (or any agent that supports
[open agent skills](https://skills.sh/)), install the `cloudflare-cli` skill.
Future sessions will know the `cloudflare` binary is on your machine and reach
for it instead of hand-rolling `curl` against `api.cloudflare.com`:

```bash
npx skills add spenserhale/cloudflare-ai-toolkit@cloudflare-cli
```

The skill is a short reference — command tree, auth env vars, and guidance on
when to use each subcommand — and triggers whenever a user mentions Cloudflare,
cache purging, DNS records, or audit logs.

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
CLOUDFLARE_ZONE_ID       default for zone-scoped commands/tools (DNS, cache purge,
                         custom hostnames, `zones get`, log-explorer)
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

### Zones

Search and filter zones — this is how you turn a domain name into the zone ID
every other zone-scoped command needs. The positional name is an exact match
unless you pass `--operator`.

```bash
cloudflare zones list                                       # every zone
cloudflare zones list myedgewooddental.com                  # exact name
cloudflare zones list dental --operator contains            # partial search
cloudflare zones list --status pending --order name
cloudflare zones list --accountId <account-id> --type full,partial
cloudflare zones get <zone-id>                              # or CLOUDFLARE_ZONE_ID
```

`--operator` accepts Cloudflare's name filter operators: `equal` (default),
`not_equal`, `starts_with`, `ends_with`, `contains`, and the
`*_case_sensitive` variants.

### DNS records

```bash
cloudflare dns records list <zone-id> --type A --name app.example.com
cloudflare dns records update <zone-id> <record-id> --content 203.0.113.10 --proxied true
```

### Custom hostnames (SSL for SaaS)

Inspect certificate and hostname-validation state for Cloudflare for SaaS
custom hostnames, and manage their lifecycle. A hostname only carries
production traffic once both `status` and `ssl.status` are `active`; `get`
calls that out explicitly and prints the outstanding DCV records and
ownership challenges.

```bash
cloudflare custom-hostnames list --zoneId <zone-id>
cloudflare custom-hostnames list --hostname app.example.com
cloudflare custom-hostnames list --ssl false          # hostnames with no certificate
cloudflare custom-hostnames get <custom-hostname-id> --json
cloudflare custom-hostnames create app.example.com --sslMethod http
cloudflare custom-hostnames update <custom-hostname-id> --customOriginServer origin.example.com
cloudflare custom-hostnames delete <custom-hostname-id> --yes
```

Requires a token with `SSL and Certificates Read` (or Write).

### WAF firewall rules

Manage the zone's firewall (WAF custom) rules — each is a Cloudflare rules-
language expression plus an action. `update` is a PUT: pass the current
action/expression (fetch with `waf rules get`) plus your change.

```bash
cloudflare waf rules list --zoneId <zone-id> --action block
cloudflare waf rules get <rule-id>
cloudflare waf rules create --action block \
  --expression 'http.request.uri.path contains "/wp-login.php"'
cloudflare waf rules create --action managed_challenge --paused true \
  --expression 'ip.src.country eq "CN"' --description 'Challenge CN'
cloudflare waf rules update <rule-id> --action block --expression '...' --paused false
cloudflare waf rules delete <rule-id> --yes
```

Requires `Firewall Services Read`/`Write`; the `log` action is Enterprise-only.

### Redirect rules

Manage the zone's redirect rules (Rulesets Engine, first match wins). Targets
are either a literal URL or a dynamic rules-language expression.

```bash
cloudflare redirects list --zoneId <zone-id>
cloudflare redirects create \
  --expression 'http.request.uri.path eq "/old"' \
  --targetUrl https://example.com/new --statusCode 301
cloudflare redirects create \
  --expression 'starts_with(http.request.uri.path, "/blog/")' \
  --targetExpression 'concat("https://blog.example.com", http.request.uri.path)' \
  --preserveQueryString true
cloudflare redirects create --expression '...' --targetUrl ... --dryRun   # validate only
cloudflare redirects update <rule-id> --statusCode 302                   # partial; rest kept
cloudflare redirects update <rule-id> --enabled false                    # disable
cloudflare redirects get <rule-id>
cloudflare redirects delete <rule-id> --yes
```

Requires a token with `Rulesets Edit` (`Rulesets Read` for listing).

### Cache purge

Destructive purges (`everything`, `prefixes`, `hosts`) prompt for confirmation.
Pass `--yes` to skip the prompt or to run non-interactively (e.g. in CI).

```bash
cloudflare cache purge everything --zoneId <zone-id> --yes
cloudflare cache purge urls https://example.com/a https://example.com/b
cloudflare cache purge tags my-tag
cloudflare cache purge prefixes example.com/assets/ --yes
cloudflare cache purge hosts cdn.example.com --yes
```

### Log Explorer

Run SQL over Cloudflare logs and manage the datasets that feed it. Commands
target the zone when `CLOUDFLARE_ZONE_ID` is set, else the account; pass
`--scope account` (or `--accountId`/`--zoneId`) to override.

```bash
cloudflare log-explorer query --sql "SELECT count() FROM http_requests WHERE EdgeStartTimestamp >= now() - INTERVAL '1' DAY"
cloudflare log-explorer datasets list                        # configured datasets + IDs
cloudflare log-explorer datasets available                   # dataset types you can enable
cloudflare log-explorer datasets enable http_requests
cloudflare log-explorer datasets get <dataset-id>            # field config + filter
cloudflare log-explorer datasets update <dataset-id> --enabled false
cloudflare log-explorer datasets update <dataset-id> --enabled true --fields ClientIP,EdgeResponseStatus
cloudflare log-explorer datasets delete <dataset-id> --yes
```

`get`/`update`/`delete` take the `dataset_id` from `datasets list`; `enable`
takes the dataset name from `datasets available`. Requires a token with
`Logs Read` (queries, listing) and `Logs Edit` (enable/update/delete).

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
   (x64 + arm64) with `bun build --compile` and attaches them to the release.

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
