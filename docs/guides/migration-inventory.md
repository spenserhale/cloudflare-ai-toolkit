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
bun run lint
bun run test
export CF_TOOLKIT_ROOT="$(pwd -P)"
cloudflare() { bun "$CF_TOOLKIT_ROOT/packages/cli/dist/bin.js" "$@"; }
git rev-parse HEAD
cloudflare workers source get --help
cloudflare workers versions get --help
cloudflare rulesets list --help
cloudflare zones settings get --help
cloudflare waf rules list --help
```

The function selects this build in the current shell without replacing the
installed binary. To install from a fresh checkout once the branch is pushed:

```bash
git clone --branch feat/inventory-worker-inspection \
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
| Worker runtime settings and binding references | `workers settings get <worker>` | Account scope; values hidden, omitted bindings explicitly unavailable. |
| Original Worker source | `workers source get <worker>` | Unpinned metadata/hashes; optional private `--out-dir`. |
| Worker deployment/version identity | `workers deployments list <worker>`, `workers versions list <worker>` | Numeric pages, `nextPage` and `truncated`; upload order is not deployment order. |
| Pinned Worker modules and bindings | `workers versions get <worker> <version>` | Documented Beta API with `include=modules`; optional private `--out-dir`. |
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
Expressions that read sensitive headers or query arguments, or cookie contents,
are conservatively replaced with `[REDACTED]` because comparisons can embed shared
credentials. IDs, actions and order remain visible; ordinary Host/path expressions
and non-sensitive transform parameters remain inspectable.

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
Redirect list **contents**, IP-list contents, Worker secret values,
certificate private keys, and VIP/WordPress domain/database state are outside
these readers. List IDs and Worker assignments remain visible. If one of those
resources participates in the migration, record it as unresolved and inventory it
with its supported product tooling before declaring migration readiness.

## Worker implementation and bindings

Use the existing assignment readers first. A zone route's `script` is the literal
Worker name; an omitted script is a no-Worker exclusion. A custom domain's
`service` is documented as the Worker name and `environment` is deprecated.
Pass `service` literally with `--environment production` to preserve both fields.
Nonproduction legacy service environments are rejected before HTTP with
`UNSUPPORTED_WORKER_ENVIRONMENT`; never guess that a service/environment maps to
`service-environment`. Modern Wrangler environments are distinct Workers; inspect
the actual name in the assignment. Keep route/domain snapshots alongside each
Worker's results, including enabled/preview fields when returned.

All Worker reads are account-scoped, using `--account-id` or the configured
account. They reject zone scope. Commands emit bounded JSON metadata and use
stderr/nonzero status for errors. No 403, 404, 410, upstream failure, malformed
response, or unsupported format becomes an empty script, empty bindings or
successful source result. Settings with an explicit `bindings: []` have
`bindingsStatus: "present"`; omitted bindings have `bindings: null` and
`bindingsStatus: "unavailable"`. Pinned modules omitted by the API similarly have
`source: null` and `sourceStatus: "unavailable"`. Those results are incomplete
evidence, even though the containing metadata read succeeded.
If `--out-dir` explicitly requests an export and the API omits modules, the
command instead fails with `SOURCE_UNAVAILABLE` and creates no source directory.

`settings get` uses script-and-version `/settings`, which includes bindings.
It does not confuse this with `/script-settings`, which contains script-level
Logpush/tail settings. Binding names/types and documented resource references
remain visible: KV namespaces, R2 buckets, D1 databases, service/environment and
entrypoint, Durable Object classes/scripts/namespaces, queues, Hyperdrive,
Vectorize, dispatch namespaces, workflows and Secrets Store references where
returned. All plain-text/JSON values, secret values and cryptographic key material
are hidden regardless of binding name. Unknown binding types retain identity
but their details are unavailable. These snapshots cannot be written back.

`source get` reads the original script, never JSON-decodes it as an API envelope.
It recognizes JavaScript and defensively parses HTTP multipart file parts without
flattening modules or corrupting binary bytes. A multipart `metadata.main_module`
can identify the entrypoint; the download reference does not guarantee this
metadata or any `CF-ENTRYPOINT` header. Do not invent an entrypoint when absent.
For documented, pinned multi-module inspection use `versions get`, which calls
the Beta version API with `include=modules` and decodes each module's base64 bytes.
An original source read is **unpinned**; it is not proof of what currently serves
traffic. Deployment page 1's first deployment identifies the active version IDs
and percentages, including split deployments. Inspect every such ID. Uploaded
version history can include versions that never served traffic.

Accepted original-download media types are `application/javascript`,
`text/javascript`, `application/javascript+module` and `multipart/form-data`.
Missing/other types fail `UNSUPPORTED_CONTENT_FORMAT`; malformed multipart fails
`MALFORMED_RESPONSE`. Module parts and Beta modules preserve their media types
and bytes; arbitrary MIME parameters are omitted from public metadata.

Deployment and version lists default to 20, maximum 100, per page. Follow
`nextPage` with `--page` until null; `truncated: true` is incomplete. Without
upstream totals, a full page conservatively requires the next page. A successful
short/empty page ends that traversal. Each page, settings read and source read is
a separate observation, not an atomic snapshot; preserve deployment/version IDs
and recapture if configuration changes during collection.

### Private source convention

Neither CLI nor SDK returns raw source in serializable results. `source get` and
`versions get` return module names, media types, sizes and SHA256 hashes. Add
`--out-dir <new-directory>` to save original bytes. The directory must not exist;
files use generated names and a manifest maps them to module names. Directory
mode is 0700 and files 0600. Do not use a shared, synced or repository directory.

**Private source may contain inline credentials. Never print, commit, upload or
attach its bytes to chat, logs, issues or PRs.** No heuristic can prove arbitrary
code is credential-free. Inspect locally in a trusted editor. Only bounded,
redacted metadata is suitable for agent context or review artifacts. Export is an
inspection bundle, not a deployable archive. It contains no retrieved secret
values, static assets or resource contents. Limits of 20 MiB total source, 500
modules and 1 MiB metadata fail explicitly rather than returning partial success.

### Copy-paste PBHS Worker collection

Run in Bash using the local `cloudflare` function above. `jq` is required. This
standalone recipe stores snapshots, private source and failures outside the repo.
It does not print source. Every Cloudflare command is a read. The pagination
guard stops after 100 pages with failure rather than silently claiming completion.

```bash
umask 077
ACCOUNT_ID=b6228b68442dde92d0cea47c06752c74
OUT=$(mktemp -d "${TMPDIR:-/tmp}/cf-worker-inventory.XXXXXX")
printf 'exit\tread\n' > "$OUT/manifest.tsv"
failed=0

capture_worker() {
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

worker_pages() {
  local name="$1" page=1 next
  shift
  while [ "$page" -le 100 ]; do
    capture_worker "$name-page-$page" "$@" --page "$page" --per-page 100 || return 1
    next=$(jq -er 'if .nextPage == null and .truncated == false then "done"
      elif (.nextPage | type) == "number" and .truncated == true then .nextPage
      else error("missing continuation") end' "$OUT/$name-page-$page.json") || {
      failed=1; return 1;
    }
    [ "$next" = done ] && return 0
    if [[ ! "$next" =~ ^[0-9]+$ ]] || [ "$next" -le "$page" ]; then
      printf 'Invalid Worker continuation\n' >&2
      failed=1; return 1
    fi
    page=$next
  done
  printf 'Worker history exceeds collection guard; continue manually\n' >&2
  failed=1
  return 1
}

# A failed assignment read must stop collection: no queue is inferred from it.
capture_worker domains workers domains list --account-id "$ACCOUNT_ID" || exit 1
for zone in \
  a9a49f7f84cf016d217085dcfb8d27e7 \
  93ee0111ed54e0cd50ee68173b7f3307 \
  ff1813179f9c7390f39bda0b7f1aadfb; do
  capture_worker "routes-$zone" workers routes list --zone-id "$zone" || exit 1
done

# Keep original assignments; deduplicate only inspection targets.
jq -s '[.[] | (.routes[]? | select(.script != null and .script != "") |
    {worker:.script}), (.domains[]? | {worker:.service,environment:.environment})]
    | unique | .[] | @base64' -r "$OUT"/routes-*.json "$OUT/domains.json" \
  > "$OUT/targets.txt" || exit 1

i=0
while IFS= read -r row; do
  i=$((i + 1))
  worker=$(printf '%s\n' "$row" | jq -Rer '@base64d | fromjson | .worker') || exit 1
  environment=$(printf '%s\n' "$row" | jq -Rr '@base64d | fromjson | .environment // empty') || exit 1
  args=(--account-id "$ACCOUNT_ID")
  [ -z "$environment" ] || args+=(--environment "$environment")
  printf '%s\n' "$row" | jq -R '@base64d | fromjson' > "$OUT/worker-$i-target.json"
  if capture_worker "worker-$i-settings" workers settings get "$worker" "${args[@]}"; then
    jq -e '.bindingsStatus == "present"' "$OUT/worker-$i-settings.json" >/dev/null || failed=1
  fi
  capture_worker "worker-$i-source" workers source get "$worker" "${args[@]}" \
    --out-dir "$OUT/worker-$i-current-source" || :
  worker_pages "worker-$i-deployments" workers deployments list "$worker" "${args[@]}" || :
  worker_pages "worker-$i-versions" workers versions list "$worker" "${args[@]}" || :

  # Only page 1's first deployment is active. Uploaded order is not active order.
  if [ -f "$OUT/worker-$i-deployments-page-1.json" ]; then
    jq -r '.deployments[0].versions[]?.version_id' \
      "$OUT/worker-$i-deployments-page-1.json" | sort -u > "$OUT/worker-$i-active.txt"
    v=0
    while IFS= read -r version; do
      v=$((v + 1))
      if capture_worker "worker-$i-version-$v" workers versions get "$worker" "$version" \
          "${args[@]}" --out-dir "$OUT/worker-$i-version-$v-source"; then
        jq -e '.bindingsStatus == "present" and .sourceStatus == "present"' \
          "$OUT/worker-$i-version-$v.json" >/dev/null || failed=1
      fi
    done < "$OUT/worker-$i-active.txt"
  fi
done < "$OUT/targets.txt"
printf 'Private inventory: %s; incomplete or failed: %s\n' "$OUT" "$failed"
cat "$OUT/manifest.tsv"
test "$failed" -eq 0
```

A successful zero-length target queue means the successful assignment snapshots
returned no Worker targets; it says nothing about unattached Workers. Failed
reads remain in the manifest/stderr files and make the recipe fail. Nonproduction
legacy environments require separately supported tooling; do not invent a target.

### Official contracts and unsupported cases

Checked 2026-11-18:

- [Original script download](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/get/)
  returns raw content, not a JSON envelope.
- [Script and version settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/)
  provides runtime configuration/bindings; separate
  [script settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/settings/methods/get/)
  is `/script-settings`.
- [Deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/)
  returns `{deployments: [...]}`; [version history](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/list/)
  returns an array. Both document numeric paging.
- [Beta pinned version detail](https://developers.cloudflare.com/api/resources/workers/subresources/beta/subresources/workers/subresources/versions/methods/get/)
  accepts a Worker ID or name and `include=modules`; module objects contain
  `name`, `content_type`, `content_base64`. This Beta API may change or be unavailable.
- [Multipart upload](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/)
  and [metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/)
  document module parts and entrypoint. Recognizing a multipart download does not
  imply a documented pinned download/entrypoint header contract.
- [Custom-domain service/environment fields](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/list/),
  [legacy environment deprecation](https://developers.cloudflare.com/workers/wrangler/deprecations/),
  [modern environment behavior](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).

Use an account-scoped token authorized for the relevant Worker. The references
accept `Workers Scripts Read` and several newer content/individual-Worker role
alternatives for source/Beta detail; metadata-only roles can read some history
but do not imply source access. `Workers Routes Read` is zone-scoped and is not
sufficient for account source/bindings. No new credential mechanism is introduced.
403 may mean permissions, resource scope or entitlement; preserve the failed
read instead of guessing which. 404 means missing or inaccessible, never absence
of bindings. Worker errors preserve status/API code/path but suppress arbitrary
upstream text, which may echo source or credentials.

Unsupported here: legacy nonproduction service-environment APIs (no current
public contract), dispatch-namespace inspection, static asset download, source
maps, secret values, binding resource contents, deployment reconstruction and
an atomic view across requests. No arbitrary version query is added to the
original script or `/content/v2` download. Classic script version detail provides
hashes/handlers rather than source; this implementation uses the documented Beta
module API instead. Failed Beta access remains unresolved; it never falls back
to an unpinned download labeled as that version.

## Worker inspection verification evidence

Verified on 2026-11-18 against parent head
`e1cc1a152ccc2566259707cad99ee181f30d23d6` (now preserved in main by parent PR #14
merge `b90442bd12252ebc988b26342c657281b9ab052b`). This feature targets main and
does not publish a release or merge its own PR. The parent's pending changeset
remains unchanged for the later release process.

- Baseline frozen install, build/lint and 614 tests passed: SDK 283/MCP 12/CLI 319.
- Final `bun run build` and `bun run lint` exit 0 across all packages.
- Final `bun run test`: SDK 372, MCP 12, CLI 357; **741 tests pass**, zero failures.
- New coverage: 37 private-source cases, 52 mocked Worker HTTP cases, 38 Worker
  subprocess cases. Existing inventory/WAF/DNS/redirect tests remain green.
- Worker tests were written before implementation. Missing methods/commands
  failed first; additional failing regressions drove MIME/URL redaction,
  malformed-response, pinned identity, export preflight and unavailable-source
  corrections. Tests use synthetic fixtures and disable real keychain access.
- Final review found and reproduced Node cancellation of a cloned oversized
  source stream and contradictory pagination totals. Two built-Node subprocess
  regressions and three SDK regressions fail before the fixes and pass after.
  Source is consumed once with metadata validation before export; inconsistent
  totals now fail. The full suite above was rerun after these changes.
- Source package review approved the artifact implementation; a fresh recheck
  approved both final-review fixes with 89 SDK/source tests and both Node export
  regressions passing. No blocking review findings remain.
- Root reran 123 SDK inventory cases and 93 relevant CLI subprocess cases against
  a rebuilt SDK. Process mocks reject non-GET, unexpected requests and wrong
  scopes/queries. Source tests verify exact module bytes, private permissions,
  generated filenames, bounded JSON, and no code/credential values on stdout.
- Eight Node JS-build help checks pass: Worker group, five new readers and both
  existing assignment readers. No locally compiled macOS binary was tested.
- Worker collection recipe passes Bash syntax and isolated mocked execution:
  deduplication, numeric continuation, both serving version IDs in split
  deployments, empty assignments and failed assignment reads were checked.

The built Bun CLI's `auth list --json` again reported `keychain_status: "ok"`
and all three credential entries had `keychain: "missing"` and
`active_source: "missing"`. No values were printed or copied. Four built-CLI
assignment attempts (zone routes for all three PBHS zones, account custom domains)
each exited 1 with **zero stdout** and this exact diagnostic:

```text
Error: No Cloudflare credentials configured. Store a token in the OS keychain with `cloudflare auth set api-token`, or set CLOUDFLARE_API_TOKEN (or both CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL) in the environment or a .env file. Set CLOUDFLARE_ACCOUNT_ID too for account-level commands.
```

A fetch guard confirmed **zero HTTP attempts**; credential resolution stopped
every read. No Worker names were learned, so targeted PBHS source/settings/version
reads could not run. Actual assignments, source, bindings, permissions and Beta
availability remain **unverified**, never empty. No live writes, Worker deployment,
secret changes, migration, firewall repair, release or PR merge occurred.

## Parent inventory verification evidence

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
