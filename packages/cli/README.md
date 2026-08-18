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

cloudflare cache purge everything [--zoneId <id>] [--yes]
cloudflare cache purge urls <url>... [--zoneId <id>]
cloudflare cache purge tags <tag>... [--zoneId <id>]
cloudflare cache purge prefixes <prefix>... [--zoneId <id>] [--yes]
cloudflare cache purge hosts <host>... [--zoneId <id>] [--yes]

cloudflare log-explorer query [--sql <query>|--file <path>|--stdin] [flags]
cloudflare log-explorer datasets enable <dataset> [flags]

cloudflare upgrade [--check] [--force] [--version <version>]
```

Run `cloudflare <command> --help` for full flag docs.

## License

MIT — see [LICENSE](./LICENSE).
