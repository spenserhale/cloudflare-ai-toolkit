---
name: cloudflare-cli
description: Reference for the `cloudflare` CLI (from @cloudflare-ai-toolkit/cli, installed globally on this machine), covering zone lookups, cache purges, DNS record changes, custom hostnames (SSL for SaaS) certificate state, Log Explorer SQL, and audit log queries against the Cloudflare API. Trigger whenever the user mentions Cloudflare, a zone or zone ID, cache invalidation or purging, DNS record edits, custom hostnames or SSL for SaaS certificates, Log Explorer, or audit logs — even if they don't name the CLI. Prefer this CLI over hand-rolling curl against api.cloudflare.com or reaching for wrangler for these tasks, since it handles auth, pagination, and flag validation.
---

# cloudflare CLI

The `cloudflare` binary is installed globally on this machine. Its surface is small and self-documenting — read `--help` before guessing:

```bash
cloudflare --help
cloudflare <command> --help
cloudflare <command> <subcommand> --help
```

## Authentication

Check which credential the user has configured before running a command:

```bash
env | grep -E '^(CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CLOUDFLARE_EMAIL)=' | sed 's/=.*$/=<set>/'
```

- `CLOUDFLARE_API_TOKEN` — preferred (scoped token from the Cloudflare dashboard)
- `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` — legacy Global API Key

Optional defaults so you don't have to pass IDs each time:

- `CLOUDFLARE_ACCOUNT_ID` — default for `audit` commands
- `CLOUDFLARE_ZONE_ID` — default for `cache`, `custom-hostnames`, `zones get`, and `log-explorer` commands

If no credential is set, stop and ask the user which they want to configure — don't guess at one.

## What the CLI covers

```
cloudflare zones list [name]                           # search/filter zones, get zone IDs
cloudflare zones get [zone-id]                         # zone status, type, plan, nameservers
cloudflare audit logs list                             # audit log queries
cloudflare dns records list <zone-id>                  # list DNS records
cloudflare dns records update <zone-id> <record-id>    # edit a DNS record
cloudflare custom-hostnames list                       # SSL for SaaS hostnames + cert status
cloudflare custom-hostnames get <custom-hostname-id>   # cert state, DCV + ownership records
cloudflare cache purge everything                      # nuke a whole zone's cache
cloudflare cache purge urls <url>...                   # purge specific URLs
cloudflare cache purge tags <tag>...                   # purge cache-tag members
cloudflare cache purge prefixes <prefix>...            # purge a path prefix
cloudflare cache purge hosts <host>...                 # purge a specific hostname
cloudflare log-explorer query --sql '<sql>'            # SQL over Cloudflare logs
cloudflare log-explorer datasets enable <dataset>      # turn on a Log Explorer dataset
cloudflare upgrade                                     # self-update from GitHub Releases
```

The list above is a summary — run `cloudflare <cmd> --help` for the actual flag set on each.
Flags are camelCase (`--zoneId`, `--perPage`), not kebab-case.

## Finding a zone ID

Most commands need a zone ID. Start from the domain name:

```bash
cloudflare zones list example.com            # exact name match (the default)
cloudflare zones list example --operator contains   # partial name search
```

## Checking a custom hostname's certificate

Cloudflare for SaaS tracks two states: `status` (hostname activation) and
`ssl.status` (certificate issuance). Both must be `active` before the hostname
serves production traffic. `custom-hostnames get` prints both plus the
outstanding DCV validation records and ownership challenges.

```bash
cloudflare custom-hostnames list --hostname app.example.com --zoneId <zone-id>
cloudflare custom-hostnames get <custom-hostname-id> --zoneId <zone-id>
```

These need a token with `SSL and Certificates Read`; `zones list` needs `Zone Read`.

## Destructive commands

`cache purge everything`, `prefixes`, and `hosts` take a `--yes` flag to skip the confirmation prompt. Don't pass `--yes` reflexively. If the user's scope is ambiguous ("purge the cache" — which zone? everything or specific URLs?), confirm before running. An accidental `purge everything` on a production zone is painful to recover from.

## When something isn't covered

The CLI focuses on zones, DNS, cache, custom hostnames, Log Explorer, and audit operations. For Workers, R2, Pages, Access, or anything else not listed, fall back to `wrangler` or a direct call to the Cloudflare REST API — don't bend these commands into doing something they don't.

## If the command isn't found

`cloudflare --version` should print a version. If the binary is missing, the user hasn't installed it yet — point them at https://github.com/spenserhale/cloudflare-ai-toolkit#install-the-cli.
