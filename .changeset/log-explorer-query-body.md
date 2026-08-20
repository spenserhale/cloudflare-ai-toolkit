---
"@cloudflare-ai-toolkit/sdk": patch
---

Fix `queryLogExplorer` dropping the SQL before it reached Cloudflare

`POST /logs/explorer/query/sql` takes the SQL as a raw `text/plain` request
body. We were sending it as a `?query=` string parameter with no body at all,
so every query — including a bare `SELECT 1` — failed with
`invalid query: expected 1 statement, but got 0` (code 20002). The
`?query=` form is only valid on the `GET` variant of the endpoint.

- `CloudflareClient` gained an internal `textBody` request option that sends a
  payload verbatim under `Content-Type: text/plain` instead of JSON-encoding it.
- `queryLogExplorer` now sends the SQL as that body, so `--sql`, `--file`, and
  `--stdin` all reach the API.
- A query matching no rows returns `{ rows: [] }`. The API's `result` field is
  nullable, and the previous unconditional array parse turned an empty result
  set into a Zod "unexpected response shape" error.

This also fixes `log-explorer query` in the CLI and `query_log_explorer` in the
MCP server, both of which call through this method.
