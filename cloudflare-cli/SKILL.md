---
name: cloudflare-cli
description: Reference for the `cloudflare` CLI (from @cloudflare-ai-toolkit/cli, installed globally on this machine), covering zone lookups, cache purges, DNS record changes, custom hostnames (SSL for SaaS) certificate state and lifecycle, WAF firewall rules, redirect rules, Log Explorer SQL, audit log queries, and domain search and registration (Registrar) against the Cloudflare API. Trigger whenever the user mentions Cloudflare, a zone or zone ID, cache invalidation or purging, DNS record edits, custom hostnames or SSL for SaaS certificates, WAF or firewall rules, redirects or redirect rules, Log Explorer, audit logs, or buying, registering, or checking the availability of a domain — even if they don't name the CLI. Prefer this CLI over hand-rolling curl against api.cloudflare.com or reaching for wrangler for these tasks, since it handles auth, pagination, and flag validation.
---

# cloudflare CLI

The `cloudflare` binary is installed globally on this machine. Its surface is small and self-documenting — read `--help` before guessing:

```bash
cloudflare --help
cloudflare <command> --help
cloudflare <command> <subcommand> --help
```

## Authentication

Check which credential the user has configured before running a command. This
shows every source (env, `.env`, OS keychain) without printing values:

```bash
cloudflare auth list
```

- `CLOUDFLARE_API_TOKEN` — preferred (scoped token from the Cloudflare dashboard)
- `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` — legacy Global API Key

Precedence is process env > nearest `.env` > OS keychain (service
`cloudflare-ai-toolkit`). To store a credential, have the user run
`cloudflare auth set api-token` in their own terminal (hidden prompt), or pipe
it: `op read 'op://...' | cloudflare auth set api-token --stdin`. Never put a
credential in a command argument. `cloudflare auth migrate` moves `.env`
credentials into the keychain; `cloudflare auth delete <credential> --yes`
removes them. Exit code 2 means a usage error, 3 means the keychain is
unavailable (for example, running under Node instead of Bun).

Optional defaults so you don't have to pass IDs each time:

- `CLOUDFLARE_ACCOUNT_ID` — default for `audit`, account Rulesets, and Worker domains
- `CLOUDFLARE_ZONE_ID` — default for `cache`, `custom-hostnames`, `zones get`, `zones vanity-ns`, `log-explorer`, WAF, zone inventory and Worker routes; never an implicit filter for Worker domains

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
cloudflare dns records delete <zone-id> <id>... --yes  # delete DNS record(s)
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
cloudflare rulesets list --scope zone|account --all    # metadata and cursor pagination
cloudflare rulesets get <id> --scope zone|account      # all ordered rules; optional --version
cloudflare rulesets phases get <phase> --scope zone|account
cloudflare zones settings get <setting-id>             # SSL/security/cache setting value
cloudflare zones managed-transforms get                # managed request/response headers
cloudflare zones url-normalization get                 # URL normalization mode
cloudflare waf bot-management get                      # bot settings, plan-dependent
cloudflare workers routes list                        # zone Worker routes and exclusions
cloudflare workers domains list                       # account domains; optional --zone-id filter
cloudflare page-rules list                            # legacy Page Rules in execution order
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
cloudflare tunnels list                                # Cloudflare Tunnels + health status
cloudflare tunnels info <tunnel-id|name>               # connectors: version, colos, origin IPs
cloudflare registrar search "<keywords>"               # domain name suggestions + indicative price
cloudflare registrar check <domain...>                 # live availability + price (max 20)
cloudflare registrar register <domain> --maxPrice <n>  # BUYS the domain (billable, non-refundable)
cloudflare registrar status <domain> --wait            # follow an API-started registration
cloudflare registrar get <domain>                      # registered domain: expiry, auto-renew, lock
cloudflare registrar list --all                        # all registered domains
cloudflare auth list                                   # credential sources + keychain state (no values)
cloudflare auth set api-token --stdin                  # store a piped value in the OS keychain
cloudflare auth migrate --dry-run                      # .env credentials -> keychain
cloudflare auth delete <credential> --yes              # remove keychain entries
cloudflare upgrade                                     # self-update: binary→GitHub Releases, npm/bun/pnpm→package manager
```

The list above is a summary — run `cloudflare <cmd> --help` for the actual flag set on each.
Flags accept camelCase (`--zoneId`, `--perPage`) and kebab-case
(`--zone-id`, `--per-page`).

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

`waf rules list|get` read the Rulesets `http_request_firewall_custom` phase.
Native expressions, enabled state, action parameters, and one-based `order`
survive alongside compatibility `filter.expression` and `paused` fields.
Filters (including `skip`/`execute`) and numeric paging run locally. Read access
uses an applicable Rulesets product permission, such as `Zone WAF Read`.

`waf rules create|update|delete` still target the retired legacy Firewall Rules
API. They are not supported modern mutations. Never pass a modern read ID to
those commands. This inventory change does not migrate writes.

## Configuration inventory

Use explicit `--scope zone|account` on Rulesets commands; selected scope can use
its configured ID. `rulesets list` returns metadata only and exposes cursor
continuation; use `--all` or `--cursor`. `get` and `phases get` preserve all
ordered rules, execute targets, overrides, origin Host/SNI/DNS parameters,
rate limits, redirects, cache and transforms. Read managed definitions at account
scope, using the execute reference's version or `--version latest`.

Only a structured phase-entrypoint not-found 404 is `status: absent`; generic Ruleset 404 can also mean
missing managed entitlement and remains a failure. Permission, entitlement,
malformed-response and upstream failures must never be recorded as empty
inventory. New readers redact credential-bearing fields. Worker routes and
domains describe assignments; resolve them with the Worker readers below. Zone settings
accept individual IDs, for example `ssl` and `security_level`.

The [inventory guide](../docs/guides/migration-inventory.md) gives the phase
map, exact commands, permission alternatives, and local-install verification.

### Worker implementation inspection

```bash
cloudflare workers settings get <assigned-worker> --account-id <id> --json
cloudflare workers source get <assigned-worker> --account-id <id> --json
cloudflare workers deployments list <assigned-worker> --account-id <id> --page 1 --per-page 20 --json
cloudflare workers versions list <assigned-worker> --account-id <id> --page 1 --per-page 20 --json
cloudflare workers versions get <assigned-worker> <version-id> --account-id <id> --json
```

Use route `script` literally. For custom domains use `service` literally with
`--environment production`; nonproduction legacy service environments fail
explicitly. Never infer a suffixed Worker name. Preserve the assignment snapshots
and their service/environment fields. A route without script is an exclusion.

Settings/version reads preserve binding names/types/resource IDs but hide all
plain-text, JSON, secret and key values. Missing bindings/modules are unavailable,
not empty. List output has `nextPage`/`truncated`; follow every page. Deployment
page 1 identifies actively serving version IDs and percentages; the newest
uploaded version need not serve traffic. Read each active ID with `versions get`.
Pinned source uses the documented Beta version API; failures remain failures.

Source stdout contains only metadata/hashes. Optional `--out-dir <new-directory>`
on `source get` or `versions get` writes sensitive original bytes privately
(0700/0600). Do not print, upload, commit, or attach these files. Do not `cat`
live source into agent context. Unpinned source/settings and deployment reads
are separate observations, not an atomic deployment snapshot. The guide contains
the complete safe local collection workflow and unsupported cases.

## Redirect rules

`cloudflare redirects` manages the zone's redirect rules. Rules run in order — first match wins.

- Target is one of `--targetUrl <literal>` or `--targetExpression <dynamic rules expr>`.
- `--dryRun` on create validates the expression without saving — use it before enforcing.
- `redirects update` is partial: pass only what changes (e.g. just `--statusCode 302`); other fields keep their values.
- Disable a rule with `--enabled false` instead of deleting it. Reads need an applicable Rulesets permission, such as `Dynamic URL Redirects Read`; mutations need the corresponding Write permission.

## Destructive commands

`cache purge everything`, `prefixes`, and `hosts` take a `--yes` flag to skip the confirmation prompt. So do `log-explorer datasets delete`, `custom-hostnames delete`, `waf rules delete`, and `redirects delete`. Don't pass `--yes` reflexively. If the user's scope is ambiguous ("purge the cache" — which zone? everything or specific URLs?), confirm before running. An accidental `purge everything` on a production zone is painful to recover from.

`registrar register` spends the user's money and is non-refundable. Never run it
without the user explicitly approving the exact domain and the price shown by
`registrar check`, and pass that price as `--maxPrice` so a price change aborts
the purchase. Use `--sandbox` to try the flow without a charge. If a registration
reports `pending`/`in_progress`, follow it with `registrar status <domain> --wait`;
never re-run `register` for the same domain.

## Log Explorer notes

- `enable` takes a dataset *name* (`http_requests`, `gateway_dns`); `get`/`update`/`delete` take a *dataset ID* from `datasets list`.
- `datasets update` always requires `--enabled true|false` (even when only changing fields/filter). Check the current value with `datasets get` first.
- Scope defaults to the zone when `CLOUDFLARE_ZONE_ID` is set, else the account; pass `--scope account|zone` or `--accountId`/`--zoneId` to override.
- Queries need `Logs Read`; enable/update/delete need `Logs Edit`.

## When something isn't covered

The CLI includes configuration inventory, Worker assignments and private
implementation inspection, but not resource contents or all product APIs. For R2, Pages, Access, or anything
else not listed, use the appropriate product tooling; do not bend these commands
into doing something they do not support.

## If the command isn't found

`cloudflare --version` should print a version. If the binary is missing, the user hasn't installed it yet — point them at https://github.com/spenserhale/cloudflare-ai-toolkit#install-the-cli.
