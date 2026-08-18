---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add WAF firewall rules (custom rules) support across SDK, CLI, and MCP via the `/zones/{id}/firewall/rules` API.

- **SDK**: new methods on `CloudflareClient` — `listFirewallRules(params?, zoneId?)` (filter by action, description substring, paused state, with pagination), `getFirewallRule(ruleId, zoneId?)`, `createFirewallRule(params, zoneId?)`, `updateFirewallRule(ruleId, params, zoneId?)` (PUT; action + expression required), and `deleteFirewallRule(ruleId, zoneId?)`. The create/update APIs take a flat `expression` and wrap it into the `filter` object the API expects. Adds `FirewallRule`, `FirewallFilter`, `FirewallRuleAction` (block|challenge|js_challenge|managed_challenge|allow|log|bypass), and `FirewallRuleProduct` schemas plus permission hints (`Firewall Services Read` for reads, `Firewall Services Write` for writes).
- **CLI**: new `cloudflare waf rules list|get|create|update|delete`. `create` takes `--action` and `--expression` (Cloudflare rules language) with `--paused true` for staging; `update` documents the PUT semantics (resend current values to keep them); `delete` prompts and refuses non-interactively without `--yes`. `get` prints the full filter expression, priority, and paused state.
- **MCP**: new `list_firewall_rules`, `get_firewall_rule`, `create_firewall_rule`, `update_firewall_rule`, and `delete_firewall_rule` tools.
