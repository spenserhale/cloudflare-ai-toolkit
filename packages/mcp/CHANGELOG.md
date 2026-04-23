# @cloudflare-ai-toolkit/mcp

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
