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

Store the token once in the OS keychain (macOS Keychain, Linux Secret Service,
Windows Credential Manager). The prompt hides what you type:

```bash
cloudflare auth set api-token                                  # hidden prompt
op read 'op://Private/Cloudflare/credential' | cloudflare auth set api-token --stdin
cloudflare auth list                                           # which source is active
cloudflare auth migrate --dry-run                              # move .env credentials into the keychain
cloudflare auth delete api-token --yes
```

Env vars and `.env` still work and take precedence over the keychain
(env > nearest `.env` > keychain). Keychain lookup needs the Bun runtime: the
standalone binary or `bunx --bun`; under Node it reports `unavailable`. Set
`CLOUDFLARE_KEYCHAIN=0` to skip it. See the
[configuration guide](../../docs/guides/configuration.md).

```bash
export CLOUDFLARE_API_TOKEN=...       # preferred
# or legacy Global API Key auth:
# export CLOUDFLARE_API_KEY=...
# export CLOUDFLARE_EMAIL=...
export CLOUDFLARE_ACCOUNT_ID=...      # optional default for audit/account inventory
export CLOUDFLARE_ZONE_ID=...         # optional default for zone-scoped commands
```

## Commands

```bash
cloudflare auth set <api-token|global-api-key> [--key NAME] [--stdin] [--dry-run] [--json]
cloudflare auth list [--json|--csv]
cloudflare auth delete <api-token|global-api-key> [--key NAME] --yes [--dry-run] [--json]
cloudflare auth migrate [--dry-run] [--overwrite] [--json]

cloudflare audit logs list [flags]
cloudflare audit logs search [--since 7d] [--product <p>...] [--action <a>...] [--first] [--format ndjson|tsv|json|toon] [flags]
cloudflare audit logs facets [--since 7d] [--facets product,type,action] [flags]

cloudflare zones list [name] [--operator <op>] [--status <status>] [flags]
cloudflare zones get [zone-id] [--json]
cloudflare zones vanity-ns get [zone-id] [--json]
cloudflare zones vanity-ns set <ns...> [--zoneId <id>] [--yes] [--json]
cloudflare zones vanity-ns clear [--zoneId <id>] [--yes] [--json]

cloudflare dns records list <zone-id> [flags]
cloudflare dns records create <zone-id> --type TXT --name pbhsdevelop.com --content 'v=spf1 include:_spf.paubox.com -all' --json
cloudflare dns records update <zone-id> <record-id> [flags]
cloudflare dns records delete <zone-id> <record-id...> [--yes] [--json]

cloudflare custom-hostnames list [--hostname <fqdn>] [--zoneId <id>] [flags]
cloudflare custom-hostnames get <custom-hostname-id> [--zoneId <id>] [--json]
cloudflare custom-hostnames create <hostname> [--sslMethod http|txt|email] [--certificateAuthority <ca>] [flags]
cloudflare custom-hostnames update <custom-hostname-id> [--customOriginServer <origin>] [--metadata <json>] [flags]
cloudflare custom-hostnames delete <custom-hostname-id> [--zoneId <id>] [--yes]
cloudflare custom-hostnames history <hostname> [--zoneId <id>] [--since <time>] [--json]

cloudflare waf rules list [--action <action>] [--description <text>] [flags]
cloudflare waf rules get <rule-id> [--zoneId <id>] [--json]
cloudflare waf rules create --action <action> --expression <expr> [--paused true] [flags]
cloudflare waf rules update <rule-id> --action <action> --expression <expr> [flags]
cloudflare waf rules delete <rule-id> [--zoneId <id>] [--yes]

cloudflare rulesets list --scope zone|account [--zone-id <id>|--account-id <id>] [--cursor <c>] [--per-page 50] [--all] [--json]
cloudflare rulesets get <ruleset-id> --scope zone|account [--version <version>] [flags]
cloudflare rulesets phases get <phase> --scope zone|account [flags]
cloudflare lists list --scope account [--account-id <id>] [--name <exact>] [--kind ip|redirect|hostname|asn] [--page 1] [--per-page 100] [--all] [--json]
cloudflare lists get <list-id> --scope account [--account-id <id>] [--json]
cloudflare lists items list <list-id> --scope account [--account-id <id>] [--search <query>] [--cursor <c>] [--per-page 100] [--all] [--json]
cloudflare zones settings get <setting-id> [--zone-id <id>] [--json]
cloudflare zones managed-transforms get [--zone-id <id>] [--json]
cloudflare zones url-normalization get [--zone-id <id>] [--json]
cloudflare waf bot-management get [--zone-id <id>] [--json]
cloudflare workers routes list [--zone-id <id>] [--json]
cloudflare workers domains list [--account-id <id>] [--zone-id <filter>] [--json]
cloudflare page-rules list [--zone-id <id>] [--json]

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

cloudflare log-explorer query [--sql <query>|--file <path>|--stdin]
                              [--progress|--noProgress] [--progressInterval <s>] [flags]
cloudflare log-explorer datasets list [--includeZones] [flags]
cloudflare log-explorer datasets available [flags]
cloudflare log-explorer datasets get <dataset-id> [flags]
cloudflare log-explorer datasets enable <dataset> [flags]
cloudflare log-explorer datasets update <dataset-id> --enabled true|false [--fields <a,b>] [--filter <expr>] [flags]
cloudflare log-explorer datasets delete <dataset-id> [--yes]

cloudflare tokens verify [--accountId <id>] [--json]
cloudflare tokens show [--tokenId <id>] [--accountId <id>] [--json]
cloudflare tokens permissions [--check "<name|id>"]... [--quiet] [--tokenId <id>] [--json]
cloudflare tokens groups [--name <filter>] [--scope <urn>] [--json]

cloudflare tunnels list [<name>] [--status <status>] [--includeDeleted] [--accountId <id>] [--json]
cloudflare tunnels info <tunnel-id|name> [--accountId <id>] [--json]

cloudflare registrar search <query> [--extensions com,dev] [--limit <n>] [--sandbox] [--json]
cloudflare registrar check <domain...> [--sandbox] [--json]
cloudflare registrar register <domain> [--maxPrice <amount>] [--years <n>] [--autoRenew]
                   [--privacy redaction|off] [--contact <file.json>] [--yes] [--noWait]
                   [--timeout <s>] [--sandbox] [--json]
                   # BILLABLE and non-refundable outside --sandbox; re-checks the price
                   # and asks you to type 'yes' unless --yes
cloudflare registrar status <domain> [--wait] [--timeout <s>] [--sandbox] [--json]
cloudflare registrar get <domain> [--sandbox] [--json]
cloudflare registrar list [--sort created|expires|name] [--desc] [--all] [--cursor <c>] [--sandbox] [--json]

cloudflare upgrade [--check] [--force] [--version <version>]
                   # binary installs self-update from GitHub Releases;
                   # npm/bun/pnpm installs upgrade via their package manager
```

Run `cloudflare <command> --help` for full flag docs.

## Migration inventory

See the [read-only inventory guide](../../docs/guides/migration-inventory.md) for
local installation, the complete PBHS command set, API sources, permission
requirements, and verification evidence. CamelCase and kebab-case flags both work.

`waf rules list|get` now use the Rulesets custom-firewall phase. JSON retains
native rule fields and source metadata, with `filter.expression` and `paused`
compatibility fields. Filters and numeric paging run locally; `order` is the
original one-based array position, not legacy priority. `skip` and `execute`
filters are supported. `waf rules create|update|delete` still use the retired
legacy API and are not modern mutations; do not feed read IDs into those commands.

Rulesets commands require explicit `--scope zone|account`. Rulesets lists expose cursors
and `truncated`; use `--all` or follow `--cursor`. Detail/phase reads return every
ordered rule and preserve product parameters. A missing phase returns explicit
`status: "absent"` with its original 404 diagnostic. Other read failures exit 1
with stderr diagnostics and no JSON result; parser usage failures are nonzero.
Zone settings use individual setting IDs because the collection endpoint is
deprecated. Worker domains are account-scoped, with an optional zone filter.

Account Lists inventory requires `--scope account`; `--account-id` defaults to
`CLOUDFLARE_ACCOUNT_ID`. No zone scope/filter is accepted. `lists list` reads
account metadata, filters exact name/kind locally, then pages locally. `--page`
defaults to 1, `--per-page` defaults to 100 (range 1–500), and `--all` returns all
matches (`--page` greater than 1 conflicts with `--all`). JSON has `lists`,
numeric `resultInfo`, and `truncated`.

`lists get` returns list identity and native metadata. `lists items list` first
reads that identity, then returns `list`, `items`, `resultInfo.cursors`, and
`truncated`. Items default to 100 per page (range 1–500); `--all` follows every
remaining cursor and fails if any page fails. Any item page advertising more data
without a continuation cursor fails, including bounded reads. `--all --cursor <c>`
collects a suffix, not items before that cursor. `--search` is an upstream filter: IP prefix,
redirect/hostname substring, ASN exact match. Filtered/resumed results are subsets.
Truncation diagnostics go to stderr; `--json` stdout contains only JSON.

Kinds are `ip`, `redirect`, `hostname`, and `asn`. The readers preserve item IDs,
IPs/comments, redirect URLs, status and all behavior parameters. An empty list
returns its metadata and `items: []`; 403/404/410/upstream errors or malformed
responses fail with exit 1 and no successful JSON. Missing lists never become
empty inventories. Existing credential/URL redaction applies. Read access needs
`Account Filter Lists Read` for the selected account. Cloudflare Managed Lists
and built-in datasets are not exported. Use `redirects` for Single Redirect rules;
Bulk Redirect references are resolved through these account Lists commands.

## License

MIT — see [LICENSE](./LICENSE).

DNS record creation requires `--type`, `--name`, and `--content`. Optional flags:
`--ttl <integer>`, `--proxied true|false`, `--comment <text>`, and `--json`.
The command returns the created record including its ID. Quote TXT content with
normal shell quoting to preserve spaces. For an apex record, use the zone name
(e.g. `pbhsdevelop.com`). API failures exit nonzero and report validation messages
or required permissions on stderr.
