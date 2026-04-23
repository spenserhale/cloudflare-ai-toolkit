---
name: cloudflare-cli
description: Reference for the `cloudflare` CLI (from @cloudflare-ai-toolkit/cli, installed globally on this machine), covering cache purges, DNS record changes, audit log queries, and zone operations against the Cloudflare API. Trigger whenever the user mentions Cloudflare, cache invalidation or purging, DNS record edits, or audit logs — even if they don't name the CLI. Prefer this CLI over hand-rolling curl against api.cloudflare.com or reaching for wrangler for these tasks, since it handles auth, pagination, and flag validation.
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
- `CLOUDFLARE_ZONE_ID` — default for `dns` and `cache` commands

If no credential is set, stop and ask the user which they want to configure — don't guess at one.

## What the CLI covers

```
cloudflare audit logs list                             # audit log queries
cloudflare dns records list <zone-id>                  # list DNS records
cloudflare dns records update <zone-id> <record-id>    # edit a DNS record
cloudflare cache purge everything                      # nuke a whole zone's cache
cloudflare cache purge urls <url>...                   # purge specific URLs
cloudflare cache purge tags <tag>...                   # purge cache-tag members
cloudflare cache purge prefixes <prefix>...            # purge a path prefix
cloudflare cache purge hosts <host>...                 # purge a specific hostname
cloudflare upgrade                                     # self-update from GitHub Releases
```

The list above is a summary — run `cloudflare <cmd> --help` for the actual flag set on each.

## Destructive commands

`cache purge everything`, `prefixes`, and `hosts` take a `--yes` flag to skip the confirmation prompt. Don't pass `--yes` reflexively. If the user's scope is ambiguous ("purge the cache" — which zone? everything or specific URLs?), confirm before running. An accidental `purge everything` on a production zone is painful to recover from.

## When something isn't covered

The CLI focuses on cache, DNS, and audit operations. For Workers, R2, Pages, Access, or anything else not listed, fall back to `wrangler` or a direct call to the Cloudflare REST API — don't bend these commands into doing something they don't.

## If the command isn't found

`cloudflare --version` should print a version. If the binary is missing, the user hasn't installed it yet — point them at https://github.com/spenserhale/cloudflare-ai-toolkit#install-the-cli.
