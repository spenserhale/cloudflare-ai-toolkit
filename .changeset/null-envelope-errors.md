---
"@cloudflare-ai-toolkit/sdk": patch
"@cloudflare-ai-toolkit/cli": patch
---

Accept `errors: null` and `messages: null` in Cloudflare response envelopes. Some endpoints, including `GET /accounts/{id}/workers/domains`, return `null` instead of `[]` on success, so `workers domains list` failed with `Malformed Cloudflare response ... invalid envelope or result`.
