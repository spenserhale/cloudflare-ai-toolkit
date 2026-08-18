---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add redirect rule management across SDK, CLI, and MCP via the Rulesets Engine `http_request_dynamic_redirect` phase.

- **SDK**: new methods on `CloudflareClient` — `listRedirectRules(zoneId?)` (reads the phase entrypoint ruleset; returns `{ rulesetId, rules }`, empty when none exists), `getRedirectRule(ruleId, zoneId?)`, `createRedirectRule(params, zoneId?)` (flat `targetUrl`/`targetExpression` + `statusCode` + `preserveQueryString` params; creates the entrypoint via PUT if absent; supports `dryRun` validation), `updateRedirectRule(ruleId, params, zoneId?)` (partial PATCH — target/status changes merge with the rule's current from_value), and `deleteRedirectRule(ruleId, zoneId?)`. Adds `RedirectRule`, `Ruleset`, `RedirectStatusCode` (301|302|303|307|308), `REDIRECT_RULE_PHASE` schemas/consts plus permission hints (`Rulesets Read`/`Rulesets Edit`).
- **CLI**: new `cloudflare redirects list|get|create|update|delete`. `create` takes `--expression` plus exactly one of `--targetUrl`/`--targetExpression`, with `--statusCode`, `--preserveQueryString`, `--enabled`, and `--dryRun` (validate without saving). `update` is partial — pass only what changes. `delete` prompts and refuses non-interactively without `--yes`.
- **MCP**: new `list_redirect_rules`, `get_redirect_rule`, `create_redirect_rule` (with dryRun), `update_redirect_rule`, and `delete_redirect_rule` tools.
