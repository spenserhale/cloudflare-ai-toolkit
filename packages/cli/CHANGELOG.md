# @cloudflare-ai-toolkit/cli

## 0.5.0

### Minor Changes

- [`54b2612`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/54b26123a96831ca939844ca98ebf0f94ac6caff) Thanks [@spenserhale](https://github.com/spenserhale)! - Read and modify zone custom (vanity) nameservers

  Zone custom nameservers (ZCNS) are now a first-class surface across all three
  packages, backed by `PATCH /zones/{zone_id}` with `vanity_name_servers`.

  - SDK: `getZoneVanityNameServers`, `setZoneVanityNameServers`, and
    `clearZoneVanityNameServers` return a focused result carrying the configured
    names, the IPv4/IPv6 glue addresses Cloudflare assigned to them, and the
    Cloudflare nameservers they replace. `PATCH /zones/{zone_id}` now reports the
    `Zone Write` permission hint on failure.
  - CLI: `cloudflare zones vanity-ns get|set|clear`. `set` validates the names
    against the zone before spending a request, and both writes confirm before
    changing authoritative DNS. `zones get` gained a `Vanity NS` line.
  - MCP: `get_zone_vanity_nameservers`, `set_zone_vanity_nameservers`, and
    `clear_zone_vanity_nameservers`.

### Patch Changes

- Updated dependencies [[`54b2612`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/54b26123a96831ca939844ca98ebf0f94ac6caff)]:
  - @cloudflare-ai-toolkit/sdk@0.5.0

## 0.4.0

### Minor Changes

- [`6b421a7`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/6b421a73bebe913aeac121f937de82d91552e916) Thanks [@spenserhale](https://github.com/spenserhale)! - Make `cloudflare upgrade` install-method aware.

  - Standalone binary installs (from `scripts/install.sh`) self-update from GitHub Releases as before (SHA256-verified).
  - npm/bun/pnpm global installs are now detected from the CLI's real path inside global `node_modules` and upgraded through their owning package manager: `npm install -g @cloudflare-ai-toolkit/cli@<version>`, `bun add -g`, or `pnpm add -g`. Previously these installs exited with an error telling the user to upgrade manually.
  - `--check` reports update availability for both install methods without installing.
  - Unrecognized layouts (source checkouts) and yarn installs fall back to actionable manual instructions instead of a dead end.

### Patch Changes

- Updated dependencies []:
  - @cloudflare-ai-toolkit/sdk@0.4.0

## 0.3.0

### Minor Changes

- [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22) Thanks [@spenserhale](https://github.com/spenserhale)! - Add custom hostname lifecycle (create/update/delete) across SDK, CLI, and MCP, completing the existing list/get support.

  - **SDK**: new `createCustomHostname(params, zoneId?)`, `updateCustomHostname(id, params, zoneId?)` (PATCH; partial updates validated to require at least one field; resending SSL config retriggers DCV), and `deleteCustomHostname(id, zoneId?)` on `CloudflareClient`. Adds `CustomHostnameSslInput`/`CustomHostnameSslSettings` schemas (method, wildcard, certificate authority, TLS settings) and permission hints for POST/PATCH/DELETE (`SSL and Certificates Write`).
  - **CLI**: new `cloudflare custom-hostnames create <hostname>` (`--sslMethod http|txt|email`, `--sslWildcard`, `--certificateAuthority`, `--customOriginServer`, `--customOriginSni`, `--metadata <json>`), `custom-hostnames update <id>`, and `custom-hostnames delete <id> [--yes]` with interactive confirmation that refuses to run non-interactively without `--yes`.
  - **MCP**: new `create_custom_hostname`, `update_custom_hostname`, and `delete_custom_hostname` tools.

- [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22) Thanks [@spenserhale](https://github.com/spenserhale)! - Add full Log Explorer dataset management across SDK, CLI, and MCP.

  - **SDK**: new methods on `CloudflareClient` — `listLogExplorerDatasets(params?, overrides?)` (with `includeZones`), `listAvailableLogExplorerDatasets(params?, overrides?)` (dataset types, schemas, timestamp fields), `getLogExplorerDataset`, `updateLogExplorerDataset` (enable/disable ingest, field allowlist, Logpush filter set/clear, deletion protection), and `deleteLogExplorerDataset`. `LogExplorerDataset` now types `fields`, `filter`, and `deletion_protection`; adds `LogExplorerDatasetField` and `AvailableLogExplorerDataset` schemas plus permission hints (`Logs Read` for dataset reads, `Logs Edit` for update/delete).
  - **CLI**: new `cloudflare log-explorer datasets list [--includeZones]`, `datasets available`, `datasets get <dataset-id>` (prints enabled/disabled field checklist and filter), `datasets update <dataset-id> --enabled true|false [--fields a,b] [--filter expr] [--deletionProtection bool]`, and `datasets delete <dataset-id> [--yes]` with interactive confirmation that refuses to run non-interactively without `--yes`. `get`/`update`/`delete` address datasets by the `dataset_id` shown by `datasets list`.
  - **MCP**: new `list_log_explorer_datasets`, `list_available_log_explorer_datasets`, `get_log_explorer_dataset`, `update_log_explorer_dataset`, and `delete_log_explorer_dataset` tools.

- [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22) Thanks [@spenserhale](https://github.com/spenserhale)! - Add redirect rule management across SDK, CLI, and MCP via the Rulesets Engine `http_request_dynamic_redirect` phase.

  - **SDK**: new methods on `CloudflareClient` — `listRedirectRules(zoneId?)` (reads the phase entrypoint ruleset; returns `{ rulesetId, rules }`, empty when none exists), `getRedirectRule(ruleId, zoneId?)`, `createRedirectRule(params, zoneId?)` (flat `targetUrl`/`targetExpression` + `statusCode` + `preserveQueryString` params; creates the entrypoint via PUT if absent; supports `dryRun` validation), `updateRedirectRule(ruleId, params, zoneId?)` (partial PATCH — target/status changes merge with the rule's current from_value), and `deleteRedirectRule(ruleId, zoneId?)`. Adds `RedirectRule`, `Ruleset`, `RedirectStatusCode` (301|302|303|307|308), `REDIRECT_RULE_PHASE` schemas/consts plus permission hints (`Rulesets Read`/`Rulesets Edit`).
  - **CLI**: new `cloudflare redirects list|get|create|update|delete`. `create` takes `--expression` plus exactly one of `--targetUrl`/`--targetExpression`, with `--statusCode`, `--preserveQueryString`, `--enabled`, and `--dryRun` (validate without saving). `update` is partial — pass only what changes. `delete` prompts and refuses non-interactively without `--yes`.
  - **MCP**: new `list_redirect_rules`, `get_redirect_rule`, `create_redirect_rule` (with dryRun), `update_redirect_rule`, and `delete_redirect_rule` tools.

- [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22) Thanks [@spenserhale](https://github.com/spenserhale)! - Add WAF firewall rules (custom rules) support across SDK, CLI, and MCP via the `/zones/{id}/firewall/rules` API.

  - **SDK**: new methods on `CloudflareClient` — `listFirewallRules(params?, zoneId?)` (filter by action, description substring, paused state, with pagination), `getFirewallRule(ruleId, zoneId?)`, `createFirewallRule(params, zoneId?)`, `updateFirewallRule(ruleId, params, zoneId?)` (PUT; action + expression required), and `deleteFirewallRule(ruleId, zoneId?)`. The create/update APIs take a flat `expression` and wrap it into the `filter` object the API expects. Adds `FirewallRule`, `FirewallFilter`, `FirewallRuleAction` (block|challenge|js_challenge|managed_challenge|allow|log|bypass), and `FirewallRuleProduct` schemas plus permission hints (`Firewall Services Read` for reads, `Firewall Services Write` for writes).
  - **CLI**: new `cloudflare waf rules list|get|create|update|delete`. `create` takes `--action` and `--expression` (Cloudflare rules language) with `--paused true` for staging; `update` documents the PUT semantics (resend current values to keep them); `delete` prompts and refuses non-interactively without `--yes`. `get` prints the full filter expression, priority, and paused state.
  - **MCP**: new `list_firewall_rules`, `get_firewall_rule`, `create_firewall_rule`, `update_firewall_rule`, and `delete_firewall_rule` tools.

- [`209b63f`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/209b63fd3a260c1656f4114bcceeadee337e63eb) Thanks [@spenserhale](https://github.com/spenserhale)! - Add zone search and custom hostname (SSL for SaaS) support across SDK, CLI, and MCP.

  - **SDK**: new `listZones(params?)`, `getZone(zoneId?)`, `listCustomHostnames(params?, zoneId?)`, and `getCustomHostname(customHostnameId, zoneId?)` methods on `CloudflareClient`. Zone name and account name filters accept Cloudflare's operator prefixes (`nameOperator: "contains"` sends `?name=contains:...`; `equal` is the default and sends the bare value). Adds Zod schemas (`Zone`, `ListZonesParams`, `CustomHostname`, `CustomHostnameSsl`, `ListCustomHostnamesParams`, …), a shared `ResultInfoSchema` for `result_info` pagination metadata, and permission hints for `/zones` (`Zone Read`) and `/zones/{id}/custom_hostnames` (`SSL and Certificates Read`).
  - **CLI**: new `cloudflare zones list [name]` (exact match by default, `--operator contains` etc. for partial search, plus `--status`, `--type`, `--accountId`, `--accountName`, `--match`, `--order`, `--direction`, pagination) and `cloudflare zones get [zone-id]`. New `cloudflare custom-hostnames list` and `cloudflare custom-hostnames get <custom-hostname-id>`; the detail view prints hostname `status` and `ssl.status` side by side along with DCV validation records, validation errors, and ownership challenges, and states whether the hostname is ready for production traffic. Zone ID falls back to `CLOUDFLARE_ZONE_ID`.
  - **MCP**: new `list_zones`, `get_zone`, `list_custom_hostnames`, and `get_custom_hostname` tools registered on the FastMCP server.

### Patch Changes

- Updated dependencies [[`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22), [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22), [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22), [`0646839`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/0646839f303bda61c1b55c98ad8f0c491ec56f22), [`209b63f`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/209b63fd3a260c1656f4114bcceeadee337e63eb)]:
  - @cloudflare-ai-toolkit/sdk@0.3.0

## 0.2.0

### Minor Changes

- [#4](https://github.com/spenserhale/cloudflare-ai-toolkit/pull/4) [`37e1ee4`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/37e1ee4fe70f0882b6be057cd05dfcd8839c7f0b) Thanks [@spenserhale](https://github.com/spenserhale)! - Add Cloudflare Log Explorer support across SDK, CLI, and MCP.

  - **SDK**: new `queryLogExplorer(params, overrides?)` and `enableLogExplorerDataset(params, overrides?)` methods on `CloudflareClient`. Scope resolves from the `scope` parameter (`"account" | "zone"`), then falls back to `zoneId` > `accountId` from config. Adds Zod schemas (`QueryLogExplorerParams`, `QueryLogExplorerResult`, `LogExplorerDataset`, etc.) and permission hints for `/logs/explorer/...` routes.
  - **CLI**: new `cloudflare log-explorer query` (accepts `--sql`, `--file`, or `--stdin`) and `cloudflare log-explorer datasets enable <dataset>` commands. TOON output by default, `--json` for machine-readable; `--scope`, `--account-id`, `--zone-id` overrides supported.
  - **MCP**: new `query_log_explorer` and `enable_log_explorer_dataset` tools registered on the FastMCP server.

### Patch Changes

- Updated dependencies [[`37e1ee4`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/37e1ee4fe70f0882b6be057cd05dfcd8839c7f0b)]:
  - @cloudflare-ai-toolkit/sdk@0.2.0

## 0.1.2

### Patch Changes

- [`dad69bf`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/dad69bf4aef0eb0ccf7af44ea4aeb71127ed70ee) Thanks [@spenserhale](https://github.com/spenserhale)! - Fix cross-package dependency versions, tag pushing, and binary compilation.

  - `scripts/publish.sh` now runs `bun update --lockfile-only` before publishing so that `bun publish` resolves `workspace:*` against the bumped versions. Upstream bugs [oven-sh/bun#18906](https://github.com/oven-sh/bun/issues/18906) and [#20477](https://github.com/oven-sh/bun/issues/20477) cause `bun publish` to read workspace sibling versions from the lockfile (not live `package.json`), and `bun install` / `--force` / `--no-frozen-lockfile` silently skip refreshing those records. In 0.1.1, cli and mcp were published with `sdk@0.1.0` as a dep; in 0.1.2 they correctly reference the matching `sdk@0.1.2`.
  - Root `version` script (`bun run version`) now also runs `bun update --lockfile-only`, so the Version Packages PR includes the refreshed lockfile.
  - `scripts/publish.sh` now creates local git tags per package after each successful publish, restoring the tag-push step that `changesets/action` expects.
  - Drop `--bytecode` from the binary compile step. The flag is incompatible with top-level `await` at parse time and causes the compiled binary to hang at runtime for our entrypoint. We'll revisit once Bun stabilizes bytecode support for ESM entrypoints.

- Updated dependencies [[`dad69bf`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/dad69bf4aef0eb0ccf7af44ea4aeb71127ed70ee)]:
  - @cloudflare-ai-toolkit/sdk@0.1.2

## 0.1.1

### Patch Changes

- [`20f5163`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/20f5163861b0bea0916daa433194fd4a8bc5babb) Thanks [@spenserhale](https://github.com/spenserhale)! - Fix npm install errors caused by `workspace:*` leaking into published tarballs.

  - Switch publish flow from `changeset publish` (via `npm publish`) to `bun publish`, which rewrites Bun workspace protocol specifiers to concrete versions on publish.
  - CLI: add `cloudflare upgrade` subcommand for self-updating the standalone binary against the latest GitHub Release (with `--check`, `--force`, and `--version` flags; SHA256 verified).
  - Binaries: compile with `--bytecode` for ~2x faster startup, pin Bun version for reproducibility.
  - README: lead with the standalone binary install via `scripts/install.sh`; document the `cloudflare upgrade` flow.

  Known tradeoff: `bun publish` does not yet support npm provenance / OIDC trusted publishing, so the npm tarballs no longer carry sigstore attestations. The standalone binaries remain the primary distribution path and keep their SHA256 verification against the GitHub Release.

- Updated dependencies [[`20f5163`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/20f5163861b0bea0916daa433194fd4a8bc5babb)]:
  - @cloudflare-ai-toolkit/sdk@0.1.1

## 0.1.0

### Minor Changes

- [`3ccdb2a`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/3ccdb2ac948c300a71a9a772abbf4f119d73b36d) Thanks [@spenserhale](https://github.com/spenserhale)! - Initial public release of the Cloudflare Toolkit.

  - `@cloudflare-ai-toolkit/sdk` — typed Cloudflare client covering resources, audit logs, DNS, and cache purge.
  - `@cloudflare-ai-toolkit/cli` — `cloudflare` command built on Stricli, with TOON/JSON output and confirmation gates on destructive cache purges.
  - `@cloudflare-ai-toolkit/mcp` — `cloudflare-mcp` stdio MCP server exposing the SDK to AI assistants.

### Patch Changes

- Updated dependencies [[`3ccdb2a`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/3ccdb2ac948c300a71a9a772abbf4f119d73b36d)]:
  - @cloudflare-ai-toolkit/sdk@0.1.0
