# Guidance for Claude sessions in this repo

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
