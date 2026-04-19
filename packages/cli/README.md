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

## Configure

```bash
export CLOUDFLARE_API_TOKEN=...       # preferred
# or legacy Global API Key auth:
# export CLOUDFLARE_API_KEY=...
# export CLOUDFLARE_EMAIL=...
export CLOUDFLARE_ACCOUNT_ID=...      # optional default for audit commands
export CLOUDFLARE_ZONE_ID=...         # optional default for dns/cache commands
```

## Commands

```bash
cloudflare audit logs list [flags]

cloudflare dns records list <zone-id> [flags]
cloudflare dns records update <zone-id> <record-id> [flags]

cloudflare cache purge everything [--zone-id <id>] [--yes]
cloudflare cache purge urls <url>... [--zone-id <id>]
cloudflare cache purge tags <tag>... [--zone-id <id>]
cloudflare cache purge prefixes <prefix>... [--zone-id <id>] [--yes]
cloudflare cache purge hosts <host>... [--zone-id <id>] [--yes]
```

Run `cloudflare <command> --help` for full flag docs.

## License

MIT — see [LICENSE](./LICENSE).
