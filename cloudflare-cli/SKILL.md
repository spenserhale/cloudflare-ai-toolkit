---
name: cloudflare-cli
description: Reference for the `cloudflare` CLI (from @cloudflare-ai-toolkit/cli, installed globally on this machine), covering zone lookups, cache purges, DNS record changes, custom hostnames (SSL for SaaS) certificate state and lifecycle, WAF firewall rules, redirect rules, Log Explorer SQL, and audit log queries against the Cloudflare API. Trigger whenever the user mentions Cloudflare, a zone or zone ID, cache invalidation or purging, DNS record edits, custom hostnames or SSL for SaaS certificates, WAF or firewall rules, redirects or redirect rules, Log Explorer, or audit logs — even if they don't name the CLI. Prefer this CLI over hand-rolling curl against api.cloudflare.com or reaching for wrangler for these tasks, since it handles auth, pagination, and flag validation.
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
- `CLOUDFLARE_ZONE_ID` — default for `cache`, `custom-hostnames`, `zones get`, `zones vanity-ns`, and `log-explorer` commands

If no credential is set, stop and ask the user which they want to configure — don't guess at one.

## What the CLI covers

```
cloudflare zones list [name]                           # search/filter zones, get zone IDs
cloudflare zones get [zone-id]                         # zone status, type, plan, nameservers
cloudflare zones vanity-ns get [zone-id]               # custom (vanity) nameservers + glue records
cloudflare zones vanity-ns set <ns>...                 # replace custom nameservers
cloudflare zones vanity-ns clear                       # revert to Cloudflare's nameservers
cloudflare audit logs list                             # audit log queries
cloudflare dns records list <zone-id>                  # list DNS records
cloudflare dns records update <zone-id> <record-id>    # edit a DNS record
cloudflare custom-hostnames list                       # SSL for SaaS hostnames + cert status
cloudflare custom-hostnames get <custom-hostname-id>   # cert state, DCV + ownership records
cloudflare custom-hostnames create <hostname>          # add hostname + request cert
cloudflare custom-hostnames update <id> --customOriginServer <origin>
cloudflare custom-hostnames delete <id> --yes          # remove hostname + cert
cloudflare waf rules list                              # firewall (WAF custom) rules
cloudflare waf rules get <rule-id>                     # rule detail incl. expression
cloudflare waf rules create --action block --expression '<expr>'
cloudflare waf rules update <rule-id> --action block --expression '<expr>'
cloudflare waf rules delete <rule-id> --yes
cloudflare redirects list                             # redirect rules (first match wins)
cloudflare redirects get <rule-id>
cloudflare redirects create --expression '<expr>' --targetUrl <url> [--statusCode 301]
cloudflare redirects update <rule-id> --statusCode 302 # partial; other fields kept
cloudflare redirects delete <rule-id> --yes
cloudflare cache purge everything                      # nuke a whole zone's cache
cloudflare cache purge urls <url>...                   # purge specific URLs
cloudflare cache purge tags <tag>...                   # purge cache-tag members
cloudflare cache purge prefixes <prefix>...            # purge a path prefix
cloudflare cache purge hosts <host>...                 # purge a specific hostname
cloudflare log-explorer query --sql '<sql>'            # SQL over Cloudflare logs
cloudflare log-explorer datasets list                  # configured datasets + dataset IDs
cloudflare log-explorer datasets available             # dataset types that can be enabled
cloudflare log-explorer datasets enable <dataset>      # turn on a Log Explorer dataset
cloudflare log-explorer datasets get <dataset-id>      # field config, filter, ingest state
cloudflare log-explorer datasets update <dataset-id> --enabled false
cloudflare log-explorer datasets delete <dataset-id> --yes
cloudflare upgrade                                     # self-update: binary→GitHub Releases, npm/bun/pnpm→package manager
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

## Zone custom (vanity) nameservers

`cloudflare zones vanity-ns` reads and modifies zone custom nameservers (ZCNS) —
the zone is served from names under itself (`ns1.example.com`) instead of
Cloudflare's assigned pair.

- Every name must be a subdomain of the zone, and the zone must be on a Business or Enterprise plan.
- `set` replaces the whole list; there is no partial update. Read with `get` first.
- Setting or clearing them changes authoritative DNS. Both prompt unless `--yes`; don't pass `--yes` on the user's behalf without saying what will change.
- Cloudflare creates the read-only `A`/`AAAA` records, but the user must add the nameservers and matching glue records at their registrar or lookups for the domain fail. Say so after a `set`.

```bash
cloudflare zones vanity-ns get --json
cloudflare zones vanity-ns set ns1.example.com ns2.example.com --zoneId <zone-id>
```

Reads need `Zone Read`; writes need `Zone Write`.

## WAF firewall rules

Each rule pairs a Cloudflare rules-language expression with an action
(`block`, `challenge`, `js_challenge`, `managed_challenge`, `allow`, `log`, `bypass`).

- Read the current rule before updating: `waf rules update` is a PUT — resend the current action/expression plus your change, or you'll clobber them.
- Stage risky rules with `--paused true`, verify with `waf rules get`, then unpause.
- `log` action is Enterprise-plan only. Reads need `Firewall Services Read`; writes need `Firewall Services Write`.

## Redirect rules

`cloudflare redirects` manages the zone's redirect rules. Rules run in order — first match wins.

- Target is one of `--targetUrl <literal>` or `--targetExpression <dynamic rules expr>`.
- `--dryRun` on create validates the expression without saving — use it before enforcing.
- `redirects update` is partial: pass only what changes (e.g. just `--statusCode 302`); other fields keep their values.
- Disable a rule with `--enabled false` instead of deleting it. Reads need `Rulesets Read`; writes need `Rulesets Edit`.

## Destructive commands

`cache purge everything`, `prefixes`, and `hosts` take a `--yes` flag to skip the confirmation prompt. So do `log-explorer datasets delete`, `custom-hostnames delete`, `waf rules delete`, and `redirects delete`. Don't pass `--yes` reflexively. If the user's scope is ambiguous ("purge the cache" — which zone? everything or specific URLs?), confirm before running. An accidental `purge everything` on a production zone is painful to recover from.

## Log Explorer notes

- `enable` takes a dataset *name* (`http_requests`, `gateway_dns`); `get`/`update`/`delete` take a *dataset ID* from `datasets list`.
- `datasets update` always requires `--enabled true|false` (even when only changing fields/filter). Check the current value with `datasets get` first.
- Scope defaults to the zone when `CLOUDFLARE_ZONE_ID` is set, else the account; pass `--scope account|zone` or `--accountId`/`--zoneId` to override.
- Queries need `Logs Read`; enable/update/delete need `Logs Edit`.

## When something isn't covered

The CLI focuses on zones, DNS, cache, custom hostnames, WAF firewall rules, redirect rules, Log Explorer, and audit operations. For Workers, R2, Pages, Access, or anything else not listed, fall back to `wrangler` or a direct call to the Cloudflare REST API — don't bend these commands into doing something they don't.

## If the command isn't found

`cloudflare --version` should print a version. If the binary is missing, the user hasn't installed it yet — point them at https://github.com/spenserhale/cloudflare-ai-toolkit#install-the-cli.
