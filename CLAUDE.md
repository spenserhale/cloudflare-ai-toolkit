# Guidance for AI coding agents in this repo

## Do not try to validate `bun build --compile` binaries on local macOS

Binaries compiled locally on Apple Silicon with current Bun (1.3.x on Homebrew)
hang at startup: no stdout, no exit, must be killed with `timeout`. This
reproduces across `--minify`, `--sourcemap`, and flag-free invocations. The same
code cross-compiled to darwin-arm64 in GitHub Actions with Bun 1.1.38 produces
a working binary — users installing via `scripts/install.sh` get a functioning
executable.

**Implication:** don't attempt to locally smoke-test compiled binaries via
`./packages/cli/dist/cloudflare --help` or similar. It will hang and mislead you
into thinking the code is broken. Trust the CI build in `.github/workflows/binaries.yml`.
If you need to verify a binary actually runs, download the CI-built asset from
the GitHub Release instead of compiling locally.

The plain JS build (`bun run build` → `packages/cli/dist/bin.js`) runs fine
locally; use `node packages/cli/dist/bin.js --help` for smoke tests.

## Publish pipeline quirks

- `bun publish` (not `npm publish` / `changeset publish`) is the only publisher
  that rewrites `workspace:*` specifiers to concrete versions on our tarballs.
  Don't switch back to `changeset publish` — it leaves the protocol in the
  published `package.json`, which breaks `npm install` for users.
- `bun publish` resolves workspace dep versions from `bun.lock`, not live
  `package.json`. After `changeset version` bumps packages, the lockfile's
  workspace *version records* (the `"name": "@x/y", "version": "..."` entries)
  must be refreshed or cli/mcp will publish with a stale `sdk` dep version.
  **`bun install`, `bun install --force`, and `bun install --no-frozen-lockfile`
  all silently skip this refresh** when only workspace sibling versions changed
  — a known Bun regression since 1.2.8 ([#18906](https://github.com/oven-sh/bun/issues/18906),
  [#20477](https://github.com/oven-sh/bun/issues/20477)). The only command that
  works is `bun update --lockfile-only`. This is wired into the root `version`
  script and `scripts/publish.sh`. Remove it once the Bun bugs are fixed.
- `scripts/publish.sh` must create per-package git tags (`git tag <name>@<version>`)
  after each `bun publish`. The Changesets action pushes them afterwards and
  fails with `src refspec ... does not match any` if they aren't local.
- `bun build --compile --bytecode` cannot parse top-level `await` at the
  entrypoint. Our CLI's `packages/cli/src/bin.ts` uses top-level `await run(...)`,
  so `--bytecode` is disabled in `binaries.yml`.

## Release token requirements

- The GitHub Release + binaries (the curl-install distribution) are cut on
  every version-PR merge **whether or not npm publish succeeds** — `release.yml`
  runs the changesets publish step with `continue-on-error` and creates the
  `v*` release from `packages/cli/package.json` directly. An expired
  `NPM_TOKEN` only breaks the npm tarballs, never the binary install path.
- `NPM_TOKEN` secret should be a **Classic Automation token** or a Granular
  Access token with publish permission. The user's account 2FA must be set to
  "Authorization only" (not "Authorization and publishing"), otherwise CI
  publishes fail with `EOTP`.
- GitHub Releases created via the default `GITHUB_TOKEN` do **not** trigger
  downstream `release: published` workflows (GitHub security feature, not a
  bug). `release.yml` dispatches `binaries.yml` explicitly via `gh workflow run`
  after creating the release.

## npm provenance trade-off

We do not publish with provenance attestations. `bun publish` doesn't yet
support npm OIDC / sigstore (see oven-sh/bun#22423). The standalone binaries
from GitHub Releases carry SHA256 checksums and are the primary distribution
path; npm tarballs are a secondary convenience.

## Log Explorer SQL endpoint takes the query as a body, not a parameter

`POST /{accounts,zones}/{id}/logs/explorer/query/sql` takes the SQL as a raw
`text/plain` **request body**. The `?query=<sql>` string parameter shown in most
of the Log Explorer docs examples only works on the `GET` form of the same path;
`POST` ignores it and the API answers
`invalid query: expected 1 statement, but got 0` (code 20002) — which reads like
a SQL syntax error but actually means no SQL arrived. `GET` caps the query at
4096 chars, so we use `POST` (see `textBody` in `CloudflareClient.requestRaw`).

Other things worth knowing before debugging a query:

- Column names are **case-insensitive** on input (`EdgeEndTimestamp` and
  `edgeendtimestamp` both work) but always come back lowercased in `result`.
- `result` is nullable. A query matching no rows returns `null`, not `[]`.
- **`LIMIT` truncates silently.** There is no "more rows available" flag, so
  `LIMIT 100` returning exactly 100 rows is indistinguishable from a complete
  result. Cross-check with `COUNT(*)` over the same predicate before treating a
  `LIMIT`ed result as the full picture — a 101-row result set read through
  `LIMIT 100` silently lost a row in this repo's own debugging.
- `specified table not found` (code 20005) means the dataset isn't enabled for
  that account/zone, not that the table name is wrong. Check
  `log-explorer datasets list`; datasets are enabled per *zone*, and
  `--scope account` only shows them with `--includeZones`.
- Queries frequently die with `HTTP 524`, Cloudflare's own gateway timeout on
  query execution. It is returned as an HTML error page, not the JSON envelope,
  so parse defensively when calling the endpoint by hand.

  The gateway deadline is a fixed **~120.2s** (measured twice: 120.166s and
  120.211s). It is the proxy's patience, not a query-engine limit — the engine's
  own limit surfaces as a proper `507` API error ("Query exceeded internal memory
  or resource limits"), which is a different signal entirely. There is no
  async/job form of this endpoint (the OpenAPI schema exposes only `get`/`post`
  on `query/sql`) and the success envelope carries no query ID, so nothing can be
  polled and a 524'd query's work is unrecoverable — `log-explorer query` can
  only report elapsed wall time, and re-running is the only recourse.

  **Run-to-run variance dominates everything else. Retry before you rewrite.**
  The same SQL was measured at 3.9s, 98.3s, and 120s (524) in one session — a
  ~30x spread. Query shape barely registers against that:

  | Query (identical filter, `COUNT(*)`) | Measurements |
  | --- | --- |
  | 3-minute window | 8.7s |
  | 1-hour window | 2.4s, 18.3s, 2.5s |
  | 24-hour window | 3.2s, 3.5s, 5.2s |
  | 24-hour, 3-col projection + `LIMIT` | 3.9s (had been 98.3s, then 524) |

  A *narrower* window measured slower than a 20x wider one, and a 24-hour scan
  routinely finishes in under 5s. So a 524 means "this request lost the race,"
  not "this query is too expensive." Do not narrow windows, drop columns, or
  chunk the time range in response to one — just run it again. There is also no
  result caching (a 200 in 98s was followed by a 524 on the byte-identical
  query), so every attempt re-executes from scratch.

### The dashboard is not doing anything smarter

If a query is slow from the CLI, do not assume the Log Explorer dashboard has a
better path — it was checked and it does not:

- The dashboard calls `dash.cloudflare.com/api/v4/...`, not
  `api.cloudflare.com/client/v4/...`, and uses the **`GET` + `?query=`** form.
  Paired on an identical 7-day high-cardinality `GROUP BY`: dash 27.3s vs
  api.cloudflare.com 25.5s and 30.7s. **No endpoint advantage.**
- Its `{{timeFilter}}` template expands to a `Date = '<yyyy-mm-dd>'` equality
  alongside the `edgeendtimestamp` bounds. That `Date` column looks like a
  partition key but adding it changes nothing: over a 7-day window, without it
  7.9s/12.1s/7.3s, with it 12.8s/7.8s/7.3s. **Do not add it for performance.**
- The engine itself is fast when the backend is healthy — a 7-day full-zone scan
  counting 373,501 matches across ~250M rows returned in 6.9s. This reinforces
  that 524s are queueing/load, not compute.

## Looking up Cloudflare API facts

Never guess an endpoint path, field name, or response shape. Two sources, in
order:

1. **The Cloudflare Docs MCP server** — declared in `.mcp.json` as
   `cloudflare-docs` (`https://docs.mcp.cloudflare.com/mcp`, no auth). Use
   `search_cloudflare_documentation` for product behavior, concepts, limits,
   plan gating, and worked examples. It is semantic search over
   developers.cloudflare.com, so it is good at "how does purge-by-tag work"
   and weaker at "what is the exact request body for this one endpoint."
2. **The REST API reference at <https://developers.cloudflare.com/api/>** —
   the canonical source for endpoint paths, HTTP methods, parameter names and
   types, and the `{ success, errors, messages, result }` envelope. Go here
   whenever the MCP search doesn't surface the specific endpoint you need, or
   returns prose without the schema. Deep-link form is
   `https://developers.cloudflare.com/api/resources/<resource>/methods/<method>/`
   (e.g. `.../resources/cache/methods/purge/`); fetch it directly rather than
   searching again.

Because we wrap this API, (2) wins any disagreement with (1) for
request/response shapes — the docs prose lags the reference. If neither has
it, say so instead of inventing a signature.
