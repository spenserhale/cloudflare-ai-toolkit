---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Search audit logs across all pages, and fix audit filters the API was ignoring.

- Fix: `listAuditLogs` sent `resourceType` as `resource.type` and `actorIp` as
  `actor_ip`. The audit endpoint ignores query params it doesn't recognize, so
  both filters did nothing and the API returned unfiltered rows. They now send
  `resource_type` and `actor_ip_address`. A new `filters` param takes any
  server-side field by its API name (`resource_product`, `raw_method`,
  `zone_name`, ...). Values can repeat, and each field also has a `.not` form
  for exclusion.
- SDK: `searchAuditLogs()` is an async generator that follows cursors to the
  end. It splits the range into time windows, queries them in parallel, yields
  events in order, retries 429/5xx with backoff, and stops at `maxResults` or
  when aborted. Also added: `parseAuditTime` (accepts `7d` / `24h` / dates),
  `resolveAuditRange` (clamps `since` to the 18-month limit and warns, instead
  of returning a 400), `buildAuditLogPredicate` (regex and `field=value`
  matching on the client), `AuditFacetCounter`, `diagnoseEmptyAuditSearch`, and
  `getCustomHostnameHistory`.
- CLI: `cloudflare audit logs search` streams NDJSON or TSV as rows arrive, so
  Ctrl-C keeps what's already printed and exits 130. Progress goes to stderr.
  Flags cover every server-side filter (`--product`, `--resource-type`,
  `--zone`, `--actor`, `--action`, `--method`, `--status`, ...). It also has
  `--first`, `--max-results`, `--match`, `--where`, `--fields`, and
  `--format ndjson|tsv|json|toon`. `purge_cache` events are excluded unless you
  pass `--include-purge`. When a search returns nothing, it suggests the field
  you probably meant (e.g. `custom_hostnames` is a `resource.product`, not a
  `resource.type`).
  `cloudflare audit logs facets` counts values per field so you can see what's
  there before you filter. `cloudflare custom-hostnames history <hostname>`
  prints a create/update/delete timeline and flags delete-then-recreate pairs.
  `audit logs list` gains `--product`. Every flag now also accepts kebab-case
  (`--resource-type` as well as `--resourceType`).
- MCP: new `search_audit_logs`, `audit_log_facets`, and
  `custom_hostname_history` tools. `list_audit_logs` gains `product`.
