# @cloudflare-ai-toolkit/cli

## 0.1.2

### Patch Changes

- [`dad69bf`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/dad69bf4aef0eb0ccf7af44ea4aeb71127ed70ee) Thanks [@spenserhale](https://github.com/spenserhale)! - Fix cross-package dependency versions, tag pushing, and binary compilation.

  - `scripts/publish.sh` now runs `bun update --lockfile-only` before publishing so that `bun publish` resolves `workspace:*` against the bumped versions. Upstream bugs [oven-sh/bun#18906](https://github.com/oven-sh/bun/issues/18906) and [#20477](https://github.com/oven-sh/bun/issues/20477) cause `bun publish` to read workspace sibling versions from the lockfile (not live `package.json`), and `bun install` / `--force` / `--no-frozen-lockfile` silently skip refreshing those records. In 0.1.1, cli and mcp were published with `sdk@0.1.0` as a dep; in 0.1.2 they correctly reference the matching `sdk@0.1.2`.
  - Root `version` script (`bun run version`) now also runs `bun update --lockfile-only`, so the Version Packages PR includes the refreshed lockfile.
  - `scripts/publish.sh` now creates local git tags per package after each successful publish, restoring the tag-push step that `changesets/action` expects.
  - Drop `--bytecode` from the binary compile step. The flag is incompatible with top-level `await` at parse time and causes the compiled binary to hang at runtime for our entrypoint. We'll revisit once Bun stabilizes bytecode support for ESM entrypoints.

- Updated dependencies [[`dad69bf`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/dad69bf4aef0eb0ccf7af44ea4aeb71127ed70ee)]:
  - @cloudflare-ai-toolkit/sdk@0.1.2

## 0.1.1

### Patch Changes

- [`20f5163`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/20f5163861b0bea0916daa433194fd4a8bc5babb) Thanks [@spenserhale](https://github.com/spenserhale)! - Fix npm install errors caused by `workspace:*` leaking into published tarballs.

  - Switch publish flow from `changeset publish` (via `npm publish`) to `bun publish`, which rewrites Bun workspace protocol specifiers to concrete versions on publish.
  - CLI: add `cloudflare upgrade` subcommand for self-updating the standalone binary against the latest GitHub Release (with `--check`, `--force`, and `--version` flags; SHA256 verified).
  - Binaries: compile with `--bytecode` for ~2x faster startup, pin Bun version for reproducibility.
  - README: lead with the standalone binary install via `scripts/install.sh`; document the `cloudflare upgrade` flow.

  Known tradeoff: `bun publish` does not yet support npm provenance / OIDC trusted publishing, so the npm tarballs no longer carry sigstore attestations. The standalone binaries remain the primary distribution path and keep their SHA256 verification against the GitHub Release.

- Updated dependencies [[`20f5163`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/20f5163861b0bea0916daa433194fd4a8bc5babb)]:
  - @cloudflare-ai-toolkit/sdk@0.1.1

## 0.1.0

### Minor Changes

- [`3ccdb2a`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/3ccdb2ac948c300a71a9a772abbf4f119d73b36d) Thanks [@spenserhale](https://github.com/spenserhale)! - Initial public release of the Cloudflare Toolkit.

  - `@cloudflare-ai-toolkit/sdk` — typed Cloudflare client covering resources, audit logs, DNS, and cache purge.
  - `@cloudflare-ai-toolkit/cli` — `cloudflare` command built on Stricli, with TOON/JSON output and confirmation gates on destructive cache purges.
  - `@cloudflare-ai-toolkit/mcp` — `cloudflare-mcp` stdio MCP server exposing the SDK to AI assistants.

### Patch Changes

- Updated dependencies [[`3ccdb2a`](https://github.com/spenserhale/cloudflare-ai-toolkit/commit/3ccdb2ac948c300a71a9a772abbf4f119d73b36d)]:
  - @cloudflare-ai-toolkit/sdk@0.1.0
