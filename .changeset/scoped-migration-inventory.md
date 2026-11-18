---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
---

Replace retired WAF list/get calls with Rulesets custom-phase reads, preserving
compatibility fields and exposing native rule order, parameters, and source.
Add scoped Rulesets and read-only zone settings, bot settings, Worker assignments,
Page Rules, Managed Transforms, and URL normalization inventory. Preserve read
failures, expose pagination and phase absence, and redact credential-bearing output.
