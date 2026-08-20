---
"@cloudflare-ai-toolkit/cli": minor
---

Report elapsed time while a Log Explorer query is in flight

Log Explorer queries routinely run for minutes, and until now `log-explorer
query` gave no sign of life — indistinguishable from a hung CLI. It now emits
periodic notices while waiting:

```
$ cloudflare log-explorer query --json --sql "..." > rows.json
Still running... 30s elapsed.
Still running... 1m00s elapsed.
Completed in 1m14s (482 rows).
```

- Notices go to **stderr**, so `--json` stdout stays byte-for-byte pipeable to a
  file or `jq`.
- On by default when stderr is a TTY, off otherwise, so redirected and CI runs
  stay quiet. `--progress` / `--noProgress` force it either way.
- `--progressInterval <seconds>` tunes the cadence (default 30).

The endpoint is synchronous and exposes no job handle, so this reports elapsed
wall time rather than server-side query progress. Cloudflare's gateway aborts
these queries with an `HTTP 524` at a measured 120s, which is the useful upper
bound on the interval.
