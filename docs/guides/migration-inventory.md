---
title: Read-only migration inventory
description: Install the unreleased CLI locally and collect scoped, ordered Cloudflare configuration without applying a migration.
---

# Read-only migration inventory

This change restores inventory for the WordPress VIP domain migration. It does
not migrate domains or edit Cloudflare. The installed 0.11.0 release uses the
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
```

The function selects this build in the current shell without replacing the
installed binary. To install from a fresh checkout once the branch is pushed:

```bash
git clone --branch fix/migration-inventory \
  https://github.com/spenserhale/cloudflare-ai-toolkit.git toolkit-inventory
cd toolkit-inventory
bun install --frozen-lockfile
bun run build
export CF_TOOLKIT_ROOT="$(pwd -P)"
cloudflare() { bun "$CF_TOOLKIT_ROOT/packages/cli/dist/bin.js" "$@"; }
```

Keep the checkout and its dependencies: the JS build imports the workspace SDK.
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

Rulesets lists return metadata, `resultInfo.cursors.after`, and `truncated`.
`--all` follows cursors, detects repeated cursors and fails if any page fails.
Without `--all`, follow `--cursor` or treat `truncated: true` as incomplete.
Rule details and nonpaginated product endpoints return the complete API result.

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

Only a structured phase-entrypoint not-found 404 becomes `status: "absent"`, retaining
HTTP status, API code and message under `diagnostic`. This means the requested
entrypoint was not returned; it is not proof of entitlement or access to every
product. A successful empty phase has `status: "present"` and `rules: []`.
A ruleset-ID 404 remains a failed read: Cloudflare documents both missing
resource and missing managed-ruleset entitlement as possible causes.
Unrecognized/HTML 404s and explicit entitlement or permission denials remain
failed reads, even for phase entrypoints.

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

Accepted permissions vary by endpoint; matching Write permissions can also grant
reads. Use `tokens permissions --json` if the token can inspect its own policies;
failure of that inspection does not imply other reads are denied.

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

This covers rule definitions and settings, not every referenced dataset. Bulk
Redirect list **contents**, IP-list contents, Worker source/bindings/secrets,
certificate private keys, and VIP/WordPress domain/database state are outside
these readers. List IDs and Worker assignments remain visible. If one of those
resources participates in the migration, record it as unresolved and inventory it
with its supported product tooling before declaring migration readiness.

## Verification evidence

Baseline before implementation: `bun install --frozen-lockfile`, `bun run build`,
and `bun run test` succeeded (SDK 203, MCP 12, CLI 228 tests).

Final implementation checks on 2026-11-18:

- `bun run build`: SDK JS/types, CLI JS and MCP builds all exit 0.
- `bun run lint`: all three packages exit 0.
- `bun run test`: SDK 272, MCP 12, CLI 315 tests pass (599 total, no failures).
- Targeted inventory/WAF/existing read process tests: 67 pass, including 42 new
  inventory subprocess tests. Fetch mocks enforce GET-only requests, exact paths,
  query/cursor continuation and absence of retired WAF requests.
- Before the SDK fix, the exact reported WAF command failed its regression with
  `Retired firewall/rules endpoint requested`; after rebuilding, it passes.
- Tests cover rule order/parameters/overrides, scope, pagination, absence versus
  empty, 403/410/500/HTML 524, malformed successful envelopes, redaction,
  parseable JSON, stderr and nonzero process exits. Tests disable real keychain
  access and use synthetic credentials.
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
