---
"@cloudflare-ai-toolkit/sdk": patch
---

Fix `createRedirectRule` ignoring `dryRun` when the zone has no redirect ruleset yet

`createRedirectRule` has two write paths. When the
`http_request_dynamic_redirect` phase already has an entrypoint ruleset it
`POST`s the rule to `/rulesets/{id}/rules` and correctly forwards
`?dry_run=`. When the phase has *no* entrypoint yet it instead `PUT`s a new
entrypoint containing the rule — and that call dropped `dryRun` entirely.

On a zone with no redirect rules, `--dryRun` therefore created the ruleset and
the rule for real, then reported "Dry run: the rule validates. Re-run without
`--dryRun` to create it." The returned rule carried a genuine Cloudflare rule
ID because the rule genuinely existed. A live write announced as a no-op.

The `PUT .../phases/{phase}/entrypoint` endpoint accepts the same `dry_run`
query parameter, so it is now passed through on both paths and a dry run is
inert regardless of whether the ruleset already exists.

Affects `redirects create --dryRun` in the CLI and `create_redirect_rule` with
`dryRun: true` in the MCP server, which both call through this method.
