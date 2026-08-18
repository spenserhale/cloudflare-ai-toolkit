# @cloudflare-ai-toolkit/cli

Command-line interface for the Cloudflare API.

## Install

```bash
npm install -g @cloudflare-ai-toolkit/cli
# or: npx -y @cloudflare-ai-toolkit/cli --help
```

Requires Node 20+. Installs a `cloudflare` binary.

Standalone binaries (no Node required) are attached to each
[GitHub release](https://github.com/spenserhale/cloudflare-ai-toolkit/releases/latest).
macOS/Linux one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/spenserhale/cloudflare-ai-toolkit/main/scripts/install.sh | sh
```

## Teach your AI agents about this CLI

If you use Claude Code (or any agent that supports [open agent skills](https://skills.sh/)),
install the `cloudflare-cli` skill so future sessions know the CLI is available
and reach for it instead of hand-rolling `curl` calls to `api.cloudflare.com`:

```bash
npx skills add spenserhale/cloudflare-ai-toolkit@cloudflare-cli
```

The skill is short — it documents the command tree, auth env vars, and when
to use each subcommand. It loads automatically whenever the user mentions
Cloudflare, cache purging, DNS records, or audit logs.

## Configure

```bash
export CLOUDFLARE_API_TOKEN=...       # preferred
# or legacy Global API Key auth:
# export CLOUDFLARE_API_KEY=...
# export CLOUDFLARE_EMAIL=...
export CLOUDFLARE_ACCOUNT_ID=...      # optional default for audit commands
export CLOUDFLARE_ZONE_ID=...         # optional default for zone-scoped commands
```

## Commands

```bash
cloudflare audit logs list [flags]

cloudflare zones list [name] [--operator <op>] [--status <status>] [flags]
cloudflare zones get [zone-id] [--json]

cloudflare dns records list <zone-id> [flags]
cloudflare dns records update <zone-id> <record-id> [flags]

cloudflare custom-hostnames list [--hostname <fqdn>] [--zoneId <id>] [flags]
cloudflare custom-hostnames get <custom-hostname-id> [--zoneId <id>] [--json]
cloudflare custom-hostnames create <hostname> [--sslMethod http|txt|email] [--certificateAuthority <ca>] [flags]
cloudflare custom-hostnames update <custom-hostname-id> [--customOriginServer <origin>] [--metadata <json>] [flags]
cloudflare custom-hostnames delete <custom-hostname-id> [--zoneId <id>] [--yes]

cloudflare waf rules list [--action <action>] [--description <text>] [flags]
cloudflare waf rules get <rule-id> [--zoneId <id>] [--json]
cloudflare waf rules create --action <action> --expression <expr> [--paused true] [flags]
cloudflare waf rules update <rule-id> --action <action> --expression <expr> [flags]
cloudflare waf rules delete <rule-id> [--zoneId <id>] [--yes]

cloudflare redirects list [--zoneId <id>] [--json]
cloudflare redirects get <rule-id> [--zoneId <id>] [--json]
cloudflare redirects create --expression <expr> (--targetUrl <url>|--targetExpression <expr>) [--statusCode 301|302|303|307|308] [flags]
cloudflare redirects update <rule-id> [--expression <expr>] [--statusCode <code>] [--enabled true|false] [flags]
cloudflare redirects delete <rule-id> [--zoneId <id>] [--yes]

cloudflare cache purge everything [--zoneId <id>] [--yes]
cloudflare cache purge urls <url>... [--zoneId <id>]
cloudflare cache purge tags <tag>... [--zoneId <id>]
cloudflare cache purge prefixes <prefix>... [--zoneId <id>] [--yes]
cloudflare cache purge hosts <host>... [--zoneId <id>] [--yes]

cloudflare log-explorer query [--sql <query>|--file <path>|--stdin] [flags]
cloudflare log-explorer datasets list [--includeZones] [flags]
cloudflare log-explorer datasets available [flags]
cloudflare log-explorer datasets get <dataset-id> [flags]
cloudflare log-explorer datasets enable <dataset> [flags]
cloudflare log-explorer datasets update <dataset-id> --enabled true|false [--fields <a,b>] [--filter <expr>] [flags]
cloudflare log-explorer datasets delete <dataset-id> [--yes]

cloudflare upgrade [--check] [--force] [--version <version>]
                   # binary installs self-update from GitHub Releases;
                   # npm/bun/pnpm installs upgrade via their package manager
```

Run `cloudflare <command> --help` for full flag docs.

## License

MIT — see [LICENSE](./LICENSE).
