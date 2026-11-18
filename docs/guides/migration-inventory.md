---
title: Read-only migration inventory
description: Install the unreleased CLI locally and collect scoped, ordered Cloudflare configuration without applying a migration.
---

# Read-only migration inventory

These readers support inventory for the WordPress VIP domain migration, including
Bulk Redirect and custom IP-list contents. They do not migrate domains or edit
Cloudflare. The installed 0.11.0 release uses the
retired Firewall Rules API for WAF reads; install this branch locally to use the
new commands. No release was published for this task.

## Use the local build

Requires Bun, Node 20+ for the build tooling, and `jq` for the collection recipe.
In this change's checkout:

```bash
bun install --frozen-lockfile
bun run build
export CF_TOOLKIT_ROOT="$(pwd -P)"
cloudflare() { bun "$CF_TOOLKIT_ROOT/packages/cli/dist/bin.js" "$@"; }
git rev-parse HEAD
cloudflare rulesets list --help
cloudflare zones settings get --help
cloudflare waf rules list --help
cloudflare lists list --help
cloudflare lists get --help
cloudflare lists items list --help
```

The function selects this build in the current shell without replacing the
installed binary. To install from a fresh checkout once the branch is pushed:

```bash
git clone --branch feat/inventory-list-contents \
  https://github.com/spenserhale/cloudflare-ai-toolkit.git toolkit-inventory
cd toolkit-inventory
bun install --frozen-lockfile
bun run build
export CF_TOOLKIT_ROOT="$(pwd -P)"
cloudflare() { bun "$CF_TOOLKIT_ROOT/packages/cli/dist/bin.js" "$@"; }
git rev-parse HEAD
node packages/cli/dist/bin.js lists items list --help
bun run lint
bun run test
```

Keep the checkout and its dependencies: the JS build imports the workspace SDK.
The parent inventory PR #14 is merged into `main`; list contents are added on
`feat/inventory-list-contents`, whose PR targets `main`. Both changesets remain
pending the later release process. Do not publish or merge a version PR to try
these commands.
Use Bun to retain OS-keychain support. `node packages/cli/dist/bin.js --help`
also works; under Node, credentials must come from env or nearest `.env`.
Do not compile or smoke-test a local macOS binary. Version remains 0.11.0 until
the normal release process; use the git SHA and new command help to identify
this implementation. `cloudflare upgrade` installs released code, not this branch.

Credentials use the existing env > nearest `.env` > toolkit OS-keychain mechanism.
`cloudflare auth list --json` shows source/status without printing values. Do not
put credential values in command arguments, inventory files, or issue reports.

## Coverage and sources

Existing commands are reused rather than duplicated:

| Capability | Reader | Notes |
| --- | --- | --- |
| Zone metadata and plan | `zones get <id>` | Existing reader. Plan must be compared alongside settings. |
| DNS and SSL for SaaS | `dns records list <id>`, `custom-hostnames list|get` | Existing numeric pagination; collect every page. |
| Single redirects | `redirects list|get` | Existing `http_request_dynamic_redirect` reader, unchanged. |
| Account lists | `lists list|get --scope account` | IDs, names, kind, counts; exact `--name`/`--kind` filters and local numeric paging. |
| Bulk Redirect/custom list contents | `lists items list <list-id> --scope account` | IPs/comments, redirect URLs/parameters; hostname and ASN items also supported; cursor paging and `--all`. |
| Rulesets metadata | `rulesets list --scope zone|account` | Cursor, maximum 50 per page, `--all` follows continuation. |
| Ordered rules and execute overrides | `rulesets get <id> --scope ... [--version <v>]` | Full definitions; metadata list alone is insufficient. |
| Phase entrypoints | `rulesets phases get <phase> --scope ...` | Explicit present/absent status. |
| SSL/security/cache zone settings | `zones settings get <setting-id>` | Individual settings; deprecated collection API is not used. |
| Bot settings | `waf bot-management get` | Fields and entitlement vary by plan. |
| Worker routes and exclusions | `workers routes list` | Zone scope. Missing `script` means no-Worker exclusion. |
| Worker custom domains | `workers domains list --account-id <id>` | Account scope; optional `--zone-id` filter. |
| Legacy Page Rules | `page-rules list` | Still readable; highest priority first; preserves targets/actions. |
| Managed Transforms | `zones managed-transforms get` | Separate managed-header settings, not Rulesets. |
| URL normalization | `zones url-normalization get` | Separate setting, not a rule phase. |

Official contracts checked on 2026-11-18:
[custom rules](https://developers.cloudflare.com/waf/custom-rules/create-api/),
[Rulesets listing](https://developers.cloudflare.com/api/resources/rulesets/methods/list/),
[Ruleset detail](https://developers.cloudflare.com/api/resources/rulesets/methods/get/),
[versions](https://developers.cloudflare.com/api/resources/rulesets/subresources/versions/methods/get/),
[phase entrypoints](https://developers.cloudflare.com/api/resources/rulesets/subresources/phases/methods/get/),
[viewing rulesets and entitlement](https://developers.cloudflare.com/ruleset-engine/rulesets-api/view/),
[zone settings](https://developers.cloudflare.com/api/resources/zones/subresources/settings/methods/get/),
[bots](https://developers.cloudflare.com/api/resources/bot_management/methods/get/),
[Worker routes](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/list/),
[Worker domains](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/),
[Page Rules](https://developers.cloudflare.com/api/resources/page_rules/methods/list/),
[Managed Transforms](https://developers.cloudflare.com/api/resources/managed_transforms/methods/list/),
[normalization](https://developers.cloudflare.com/api/resources/url_normalization/methods/get/).

The Lists contracts were also checked on 2026-11-18 against the official
[metadata collection](https://developers.cloudflare.com/api/resources/rules/subresources/lists/methods/list/),
[list detail](https://developers.cloudflare.com/api/resources/rules/subresources/lists/methods/get/),
and [items reference](https://developers.cloudflare.com/api/resources/rules/subresources/lists/subresources/items/methods/list/).
The configured Docs MCP tools were unavailable in this session; the REST
reference and public product docs were used directly. The API covers
[custom lists and Bulk Redirect Lists](https://developers.cloudflare.com/waf/tools/lists/lists-api/).
Its four kinds are `ip`, `redirect`, `hostname`, and `asn`. This is separate from
Cloudflare's [Managed Lists](https://developers.cloudflare.com/waf/tools/lists/managed-lists/),
such as `$cf.open_proxies`: their contents are not exported by these readers.

Use these [phase names](https://developers.cloudflare.com/ruleset-engine/reference/phases-list/)
with `rulesets phases get`; the command supports both account and zone scope:

| Phase | Configuration |
| --- | --- |
| `http_request_firewall_custom` | Custom WAF, skip rules, custom execute references |
| `http_request_firewall_managed` | Managed WAF deployment, exceptions and overrides |
| `http_ratelimit` | Rate limits, counting expressions and mitigation parameters |
| `http_request_sbfm` | Super Bot Fight Mode |
| `ddos_l7` | HTTP DDoS managed rules |
| `http_request_origin` | Origin rules: Host header, SNI, DNS hostname and port |
| `http_request_dynamic_redirect` | Single redirects |
| `http_request_redirect` | Bulk Redirect rules and list references |
| `http_request_cache_settings` | Cache rules |
| `http_config_settings` | Configuration Rules, including per-request SSL/settings |
| `http_request_transform` | URL rewrites |
| `http_request_late_transform` | Request-header transforms |
| `http_response_headers_transform` | Response-header transforms |
| `http_response_compression` | Compression rules |
| `http_response_firewall_managed` | Response managed-security rules |

Origin definitions preserve `action_parameters.host_header`, `sni.value`,
`origin.host`, and `origin.port`; see the [origin parameter reference](https://developers.cloudflare.com/rules/origin-rules/parameters/).
Do not infer these from DNS records alone.

## Output, pagination and failures

All new readers accept `--json` and run without prompts. JSON contains scope and
target IDs. Rule detail retains native fields, execute IDs/versions/overrides,
enabled state, and one-based `order` from the original array. Managed definitions
may legitimately omit expressions. Credential-like fields, sensitive header
values and credentials embedded in URLs are redacted; a redacted snapshot is not
a write-back payload.
Expressions that read sensitive headers or query arguments, or cookie contents,
are conservatively replaced with `[REDACTED]` because comparisons can embed shared
credentials. IDs, actions and order remain visible; ordinary Host/path expressions
and non-sensitive transform parameters remain inspectable.

Rulesets lists return metadata, `resultInfo.cursors.after`, and `truncated`.
`--all` follows cursors, detects repeated cursors and fails if any page fails.
Without `--all`, follow `--cursor` or treat `truncated: true` as incomplete.
Rule details and nonpaginated product endpoints return the complete API result.

Account list reads require `--scope account`; `--zone-id` is not accepted.
`--account-id` can use `CLOUDFLARE_ACCOUNT_ID` as its default; zone defaults never
select the account. SDK callers use an explicit `{ scope: "account", accountId }`
target. The supported HTTP reads are exactly:

```text
GET /client/v4/accounts/{account_id}/rules/lists
GET /client/v4/accounts/{account_id}/rules/lists/{list_id}
GET /client/v4/accounts/{account_id}/rules/lists/{list_id}/items
```

The metadata collection has no documented server filters or pagination. The SDK
validates the complete response, applies exact (case-sensitive) `--name` and
`--kind` filters locally, then returns page 1 of 100 matches by default. Use
`--page`, `--per-page` (1–500), or `--all`. `--all` conflicts with `--page` above
1. `resultInfo` describes local numeric paging; `truncated: true` means later
matches remain. Unexpected upstream incompleteness fails instead of inventing
unsupported server query parameters.

Item reads first fetch metadata, so an empty result still identifies the list.
Items default to 100 per page, maximum 500. `--cursor` passes an opaque API cursor;
`--all` follows `resultInfo.cursors.after`, detects loops, and fails on any later
page error. Starting `--all` with a cursor collects only the remaining suffix.
If the API advertises more items but supplies no usable continuation cursor,
the read fails even without `--all`; it cannot offer a continuation that works.
Bounded reads also fail if a forward cursor is blank or credential redaction
would change it. Retrying without `--cursor` and using `--all` keeps the original
cursor inside the reader instead of exporting an unusable continuation.
`--search` is an IP prefix, redirect/hostname substring, or exact ASN match,
according to the API. Filtered/resumed reads are subsets, not whole-list evidence.
For an unfiltered terminal collection from the beginning, the item count must
match metadata `num_items`; a mismatch fails and may require retrying after
concurrent edits. Collection is not an atomic snapshot, and same-count concurrent
edits cannot be detected by counts alone.

List/item IDs, names, kinds, comments, IP/CIDR strings, and native timestamps are
retained. Redirects preserve `source_url`, `target_url`, `status_code`,
`include_subdomains`, `subpath_matching`, `preserve_path_suffix`, and
`preserve_query_string`, including explicit false values and omitted fields.
Unknown fields survive validation; array order is retained without assigning
rule priority to items. Source URLs can omit their scheme; see the
[parameter reference](https://developers.cloudflare.com/rules/url-forwarding/bulk-redirects/reference/parameters/).
URL credentials and sensitive query values are redacted even in those sources
and in upstream diagnostics reflecting scheme-less URLs.
Complete URL fields are parsed directly, including valid apostrophes in paths;
bare email addresses in ordinary comments and descriptions remain unchanged
unless they match a configured credential value.
Treat redacted URLs as inventory evidence, not reusable redirect definitions.

A successful empty list has metadata and `items: []`. A missing list (404),
permission/entitlement denial (403), retired endpoint (410), upstream failure,
or malformed success remains an error, with nonzero exit, stderr diagnostics,
and no successful JSON stdout. A failed metadata/item page cannot become an
empty or partially successful collection. No managed-list access is inferred
from an empty account collection or from an unmatched reference.

WAF list/get now read `http_request_firewall_custom`. The list keeps
`rules`/`resultInfo` and adds source/phase/status metadata. Each rule retains
native `expression`, `enabled`, `action_parameters`, and `order`, with
`filter.expression` and inverse `paused` compatibility fields. `--action`,
case-insensitive description substring, and `--paused` filter locally **before**
numeric paging. Default page size is 100; use `--page` for later pages.
Legacy numeric priority is not synthesized; array order controls evaluation.
`skip` and `execute` filters are accepted. No WAF read calls `/firewall/rules`.

`waf rules create|update|delete` remain legacy, use retired endpoints, and are
outside this inventory fix. Modern read IDs are not inputs to those mutations.
Use only the reads shown here during migration planning.

Only a structured 404 explicitly identifying a missing phase/entrypoint becomes `status: "absent"`, retaining
HTTP status, API code and message under `diagnostic`. This means the requested
entrypoint was not returned; it is not proof of entitlement or access to every
product. A successful empty phase has `status: "present"` and `rules: []`.
A ruleset-ID 404 remains a failed read: Cloudflare documents both missing
resource and missing managed-ruleset entitlement as possible causes.
Unrecognized/HTML 404s and explicit entitlement or permission denials remain
failed reads, even for phase entrypoints.
Wrong-zone/account and generic "ruleset not found" 404s also remain failures.

Denied/entitlement errors, HTTP 410, malformed responses and upstream failures
exit 1, print diagnostics on stderr, and emit no successful JSON result. Parser
usage failures are nonzero. HTTP 410 identifies retirement, not token denial.
HTTP 403 retains the upstream message/code; it can concern permission, resource
scope, or product entitlement, and the CLI does not invent which one applies.

## Required access and feature parity

Use only the permissions needed for each read and ensure token resources include
PBHS account and the three zones. There is no universal `Rulesets Read` permission
to assume for every endpoint. Applicable alternatives are product/scope-specific.

| Reads | Relevant documented permission alternatives |
| --- | --- |
| Zone metadata / DNS / SaaS | `Zone Read` / `DNS Read` / `SSL and Certificates Read` |
| Custom/managed WAF, rate limits | `Zone WAF Read`; account rules also use `Account WAF Read` or `Account Rulesets Read` |
| Origin/cache/config/redirect/transform rules | `Origin Read`, `Cache Settings Read`, `Config Settings Read`, `Dynamic URL Redirects Read`, `Zone Transform Rules Read`, or other accepted product-specific alternatives |
| Zone settings | `Zone Settings Read` |
| Bot settings | `Bot Management Read` |
| Worker routes / custom domains | `Workers Routes Read` / `Workers Scripts Read` |
| Page Rules | `Page Rules Read` or `Zone Read` |
| Managed headers / normalization | Applicable Rulesets product permissions; see their API references |
| Account list metadata and contents | `Account Filter Lists Read`, scoped to the account |

Accepted permissions vary by endpoint; matching Write permissions can also grant
reads. Use `tokens permissions --json` if the token can inspect its own policies;
failure of that inspection does not imply other reads are denied.
The current collection/items references also accept `Account Filter Lists Edit`;
the detail reference lists `Account Filter Lists Read`. Item inventory uses
detail first, so provision the documented Read permission. Reading rule
references still needs the Rulesets/WAF product permission separately.

The source zones are observed Enterprise and the new zone Free. Returned rules
do not establish feature portability: regex expressions, origin DNS/SNI overrides,
managed WAF, bot modes and account rules can have plan requirements. Inspect
`zones get`, setting `editable` flags and actual API diagnostics together. Do not
rewrite regex expressions or apply settings as part of this inventory.

## Copy-paste PBHS inventory

Run in Bash after defining the local `cloudflare` function above. The recipe
stores each successful read as JSON and each failure separately, checks numeric
pagination, and keeps a manifest of exit codes. Every CLI invocation is a read.
It preserves DNS and mail records in inventory without changing them.

```bash
umask 077
ACCOUNT_ID=b6228b68442dde92d0cea47c06752c74
OUT="${PWD}/migration-inventory-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
printf 'exit\tread\n' > "$OUT/manifest.tsv"
failed=0

capture() {
  local name="$1" code
  shift
  if cloudflare "$@" --json > "$OUT/$name.stdout.tmp" 2> "$OUT/$name.stderr.txt"; then
    mv "$OUT/$name.stdout.tmp" "$OUT/$name.json"
    printf '0\t%s\n' "$name" >> "$OUT/manifest.tsv"
  else
    code=$?
    mv "$OUT/$name.stdout.tmp" "$OUT/$name.failed-stdout.txt"
    printf '%s\t%s\n' "$code" "$name" >> "$OUT/manifest.tsv"
    failed=1
    return "$code"
  fi
}

pages() {
  local name="$1" page=1 total
  shift
  while capture "$name-page-$page" "$@" --page "$page"; do
    total=$(jq -er '.resultInfo.total_pages | numbers' "$OUT/$name-page-$page.json") || {
      printf 'Pagination metadata missing: %s\n' "$name" >&2
      failed=1
      return 1
    }
    [ "$page" -ge "$total" ] && return 0
    page=$((page + 1))
  done
  return 1
}

PHASES='http_request_firewall_custom http_request_firewall_managed http_ratelimit
http_request_sbfm ddos_l7 http_request_origin http_request_dynamic_redirect
http_request_redirect http_request_cache_settings http_config_settings
http_request_transform http_request_late_transform http_response_headers_transform
http_response_compression http_response_firewall_managed'
SETTINGS='ssl always_use_https automatic_https_rewrites min_tls_version tls_1_3
security_header security_level browser_check challenge_ttl cache_level
browser_cache_ttl development_mode'

capture account-rulesets rulesets list --scope account --account-id "$ACCOUNT_ID" --all || :
for phase in $PHASES; do
  capture "account-phase-$phase" rulesets phases get "$phase" \
    --scope account --account-id "$ACCOUNT_ID" || :
done

for pair in \
  pbhspreprod.com:a9a49f7f84cf016d217085dcfb8d27e7 \
  pbhsstaging.com:93ee0111ed54e0cd50ee68173b7f3307 \
  pbhsnetwork.com:ff1813179f9c7390f39bda0b7f1aadfb; do
  zone=${pair%%:*}
  id=${pair#*:}
  capture "$zone-zone" zones get "$id" || :
  pages "$zone-dns" dns records list "$id" --per-page 100 || :
  pages "$zone-custom-hostnames" custom-hostnames list --zone-id "$id" --per-page 50 || :
  pages "$zone-waf" waf rules list --zone-id "$id" --per-page 100 || :
  capture "$zone-redirects" redirects list --zone-id "$id" || :
  capture "$zone-rulesets" rulesets list --scope zone --zone-id "$id" --all || :
  for phase in $PHASES; do
    capture "$zone-phase-$phase" rulesets phases get "$phase" --scope zone --zone-id "$id" || :
  done
  for setting in $SETTINGS; do
    capture "$zone-setting-$setting" zones settings get "$setting" --zone-id "$id" || :
  done
  capture "$zone-bots" waf bot-management get --zone-id "$id" || :
  capture "$zone-worker-routes" workers routes list --zone-id "$id" || :
  capture "$zone-worker-domains" workers domains list --account-id "$ACCOUNT_ID" --zone-id "$id" || :
  capture "$zone-page-rules" page-rules list --zone-id "$id" || :
  capture "$zone-managed-transforms" zones managed-transforms get --zone-id "$id" || :
  capture "$zone-normalization" zones url-normalization get --zone-id "$id" || :
done

cat "$OUT/manifest.tsv"
printf 'Inventory directory: %s; failed reads: %s\n' "$OUT" "$failed"
test "$failed" -eq 0
```

Read each failed capability's `*.stderr.txt` before comparing zones. Missing
credentials, denied access or entitlement remain unresolved inventory, not zero
rules. Retrying an upstream failure is appropriate; changing configuration is not.
An absent entrypoint JSON is separate from a failed read and an empty ruleset.

Fetch execute definitions using supported commands, not raw API workarounds.
For every `action: "execute"`, preserve the parent rule's expression, enabled state
and `action_parameters.overrides`; the referenced definition alone does not
describe effective deployment. Account/managed references use account scope:

```bash
# Queue references from successful phase snapshots (requires at least one).
QUEUE="$OUT/execute-references.tsv"
jq -r '.ruleset.rules[]? | select(.action == "execute") |
  [.action_parameters.id, (.action_parameters.version // "latest")] | @tsv' \
  "$OUT"/*-phase-*.json | sort -u > "$QUEUE"

# Read each unique ID/version and append any nested execute references.
seen=' '
while IFS=$'\t' read -r ruleset_id version; do
  # Cloudflare IDs are hex; validate before using them as artifact names.
  if [[ ! "$ruleset_id" =~ ^[[:xdigit:]]{32}$ ]] || \
     [[ ! "$version" =~ ^([0-9]+|latest)$ ]]; then
    printf 'Invalid execute reference; inspect source JSON.\n' >&2
    failed=1
    continue
  fi
  key="$ruleset_id-$version"
  case "$seen" in *" $key "*) continue ;; esac
  seen="$seen$key "
  if capture "account-definition-$key" rulesets get "$ruleset_id" --version "$version" \
      --scope account --account-id "$ACCOUNT_ID"; then
    jq -r '.ruleset.rules[]? | select(.action == "execute") |
      [.action_parameters.id, (.action_parameters.version // "latest")] | @tsv' \
      "$OUT/account-definition-$key.json" >> "$QUEUE" || failed=1
  fi
done < "$QUEUE"
test "$failed" -eq 0
```

The queue follows nested references until every discovered ID/version pair has
been attempted. For a zone entrypoint ID, use `--scope zone
--zone-id <id>`; account custom/root/managed definitions use account scope.
The unversioned zone GET is documented for zone entrypoints. Preserve any 404
instead of reporting that managed rules are empty. Disabled/unreferenced custom
definitions can be found in the metadata lists and read explicitly with `get`.

## Resolve Bulk Redirect and custom IP-list references

These are the complete new read-only command shapes. Replace the example names
and IDs with those returned by account metadata or existing rule snapshots:

```bash
cloudflare lists list --scope account --account-id "$ACCOUNT_ID" --all --json
cloudflare lists list --scope account --account-id "$ACCOUNT_ID" --kind redirect --json
cloudflare lists list --scope account --account-id "$ACCOUNT_ID" --kind ip --name office_ips --json
cloudflare lists list --scope account --account-id "$ACCOUNT_ID" --page 2 --per-page 100 --json
cloudflare lists get '<list-id>' --scope account --account-id "$ACCOUNT_ID" --json
cloudflare lists items list '<list-id>' --scope account --account-id "$ACCOUNT_ID" --all --per-page 500 --json
cloudflare lists items list '<list-id>' --scope account --account-id "$ACCOUNT_ID" --search '192.0.2.' --json
cloudflare lists items list '<list-id>' --scope account --account-id "$ACCOUNT_ID" --cursor '<resultInfo.cursors.after>' --json
```

In Bulk Redirect phase snapshots (`http_request_redirect`), inspect
`ruleset.rules[].action_parameters.from_list.name` and preserve the rule's
expression, enabled state, order, and `from_list.key`. Custom rules refer to IP
lists as `$name` inside expressions. Match either reference to metadata `.name`,
then read items using `.id`. Do not confuse these lists with Single Redirect
rules returned by `redirects list`.

The following Bash recipe reuses `OUT`, `ACCOUNT_ID`, `capture`, and `failed`
from the collection above. Set `OUT` to an existing snapshot directory and
redefine `capture` from that recipe if continuing in a new shell. It collects
every API-visible account list, including unreferenced lists, so resolving
expression references never depends on a complete rules-language parser.
It also builds a conservative name index from successful phase/execute-definition
snapshots. Expression scanning can include `$names` inside string literals;
review candidates against the original rule. Redacted expressions and unresolved
or managed references are flagged, never treated as empty lists.

```bash
if capture account-lists lists list --scope account --account-id "$ACCOUNT_ID" --all; then
  if jq -r '.lists[].id' "$OUT/account-lists.json" > "$OUT/list-ids.txt"; then
    while IFS= read -r list_id; do
      if [[ ! "$list_id" =~ ^[[:xdigit:]]{32}$ ]]; then
        printf 'Invalid list ID; inspect metadata.\n' >&2
        failed=1
        continue
      fi
      capture "account-list-$list_id" lists items list "$list_id" \
        --scope account --account-id "$ACCOUNT_ID" --all --per-page 500 || :
    done < "$OUT/list-ids.txt"
  else
    failed=1
  fi

  shopt -s nullglob
  snapshots=( "$OUT"/*-phase-*.json "$OUT"/account-definition-*.json )
  if [ "${#snapshots[@]}" -eq 0 ]; then
    printf 'No successful rule snapshots; reference resolution unverified.\n' >&2
    failed=1
  elif jq -s --slurpfile catalog "$OUT/account-lists.json" '
    [ .[] | .ruleset.rules[]? ] as $rules |
    {
      redacted_expression_count: ([$rules[] | select(.expression == "[REDACTED]")] | length),
      references: ([
        $rules[] |
        (.action_parameters.from_list.name? | strings),
        (.expression? | strings | scan("\\$([A-Za-z_][A-Za-z0-9_.]*)") | .[0])
      ] | unique | map(. as $name | {
        name: $name,
        matches: [$catalog[0].lists[] | select(.name == $name) |
          {id, kind, snapshot: ("account-list-" + .id + ".json")}]
      }))
    }' "${snapshots[@]}" > "$OUT/account-list-references.json"; then
    if ! jq -e '.redacted_expression_count == 0 and
      all(.references[]; (.matches | length) == 1)' \
      "$OUT/account-list-references.json" > /dev/null; then
      printf 'Redacted or unresolved list references; inspect reference index.\n' >&2
      failed=1
    fi
  else
    failed=1
  fi
fi

cat "$OUT/manifest.tsv"
test "$failed" -eq 0
```

The manifest must show successful reads for each referenced `snapshot` file;
metadata alone does not prove contents were collected. Missing credentials,
failed phase/execute reads, redacted expressions, unresolved names and managed
lists remain open inventory gaps even if all visible account lists were read.
Worker source/bindings/secrets, certificate private keys, and VIP/WordPress
domain/database state remain outside these readers.

## Verification evidence

### List contents extension

The extension starts at parent head `e1cc1a1`. After frozen dependency
installation, its baseline build/lint and all 614 tests passed (SDK 283, MCP 12,
CLI 319). PR #14 subsequently merged into `main` as `b90442b`; the extension PR
targets `main` and leaves the parent changeset pending.

Initial test-first implementation added 70 SDK HTTP cases, 39 CLI unit cases, and 66
isolated subprocess cases. The SDK cases failed on missing methods/exports and
the CLI cases failed on the unregistered `lists` route before implementation.
Independent package review added nine SDK and two subprocess regressions, observed
failing before fixing reflected scheme-less URL credentials and unusable bounded
pagination. Final review added twelve SDK and five subprocess cases covering
apostrophes in URLs, bare email preservation, safe cursor round-tripping,
internal complete collection, and resumed collection-wide totals. Eleven SDK and
five subprocess regressions failed before the corrections; the internal
complete-collection case guards behavior that already worked. Targeted SDK
inventory/Lists verification passes 165 cases; CLI inventory units and Lists
unit/subprocess verification passes 150 cases.
The added tests cover multiple pages, exact filters/search, scope, redirect
parameters, all documented kinds, empty versus missing, failed later pages,
403/404/410/5xx, malformed successes, redaction and GET-only enforcement.

Full local verification after both review rounds:

- `bun run build`: SDK JS/types, CLI JS and MCP builds exit 0.
- `bun run test`: SDK 374, MCP 12, CLI 431 pass, 817 total with no failures.
- `bun run lint`: all three packages exit 0.
- `node packages/cli/dist/bin.js lists --help` and help for `lists list`,
  `lists get`, and `lists items list` exit 0 with the documented flags.
- `git diff --check` passes. No local compiled binary was built or smoke-tested.

All six guide Bash blocks pass `bash -n`. Isolated execution of the list recipe
with a synthetic `cloudflare` function verifies eight scenarios: success, empty
account, metadata failure, item failure, redacted expression, unresolved Managed
List reference, missing snapshots, and invalid list ID. Failure cases exit 1;
success/empty cases exit 0. No live credentials or list contents enter fixtures.

On this machine, `bun packages/cli/dist/bin.js auth list --json` reports
`keychain_status: "ok"`, with token, global key and email all
`active_source: "missing"` and `keychain: "missing"`. Credential values were not
printed. PBHS account `b6228b68442dde92d0cea47c06752c74` list access,
permissions, entitlement, counts and contents remain **unverified**. No live
Lists HTTP request was attempted, and no empty list conclusion is drawn.

### Parent inventory verification (PR #14)

Baseline before implementation: `bun install --frozen-lockfile`, `bun run build`,
and `bun run test` succeeded (SDK 203, MCP 12, CLI 228 tests).

Final implementation checks on 2026-11-18:

- `bun run build`: SDK JS/types, CLI JS and MCP builds all exit 0.
- `bun run lint`: all three packages exit 0.
- `bun run test`: SDK 283, MCP 12, CLI 319 tests pass (614 total, no failures).
- Inventory/WAF/existing read process test files: 71 pass, including 46 new
  inventory subprocess tests. Fetch mocks enforce GET-only requests, exact paths,
  query/cursor continuation and absence of retired WAF requests.
- Before the SDK fix, the exact reported WAF command failed its regression with
  `Retired firewall/rules endpoint requested`; after rebuilding, it passes.
- Tests cover rule order/parameters/overrides, scope, pagination, absence versus
  empty, 403/410/500/HTML 524, malformed successful envelopes, redaction,
  parseable JSON, stderr and nonzero process exits. Tests disable real keychain
  access and use synthetic credentials.
- Independent review found additional credential-expression, wrong-target 404
  and numeric-pagination gaps. Eleven SDK regression cases failed before the
  corrections; the full suite above passes after the fixes. Process tests also
  cover wrong-target 404s and shared credentials embedded in WAF expressions.
- Node JS-build help smoke checks pass for top-level and new Rulesets, settings
  and Worker-domain commands. No local compiled binary was tested.
- Guide collection scripts passed Bash syntax checks and isolated execution
  with a mocked `cloudflare`: numeric pages, nested execute references,
  deduplication, failure artifacts and final nonzero status were checked.

On 2026-11-18, `bun packages/cli/src/bin.ts auth list --json` reported
`keychain_status: "ok"` but all three entries (`CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`) had `keychain: "missing"` and
`active_source: "missing"`. The same read from the original repository root
reported the same state. No credentials were printed or copied.

The built CLI was then exercised with the real credential mechanism: ten reads
per zone (WAF, Rulesets list, origin phase, SSL setting, bots, Worker routes,
Worker domains, Page Rules, Managed Transforms and normalization), plus account
Rulesets list and account custom-WAF phase. All **32 attempts exited 1 with zero
stdout**, stopping at credential resolution before HTTP. Each reported:

```text
Error: No Cloudflare credentials configured. Store a token in the OS keychain with `cloudflare auth set api-token`, or set CLOUDFLARE_API_TOKEN (or both CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL) in the environment or a .env file. Set CLOUDFLARE_ACCOUNT_ID too for account-level commands.
```

Live PBHS access, permission and entitlement are therefore **unverified** for all
three zones and account-level readers. No claim of empty WAF, origin rules, Worker
assignments, settings or Page Rules is made. The other workspace's nine/nine/zero
redirect counts and observed plans are user-provided context, not fresh checks
from this machine. The supplied `/Users/spenserhale/RwAiAssistant/.../step-1/`
evidence directory was not present here.
