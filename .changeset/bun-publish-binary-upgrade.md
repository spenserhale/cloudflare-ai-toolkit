---
"@cloudflare-ai-toolkit/sdk": patch
"@cloudflare-ai-toolkit/cli": patch
"@cloudflare-ai-toolkit/mcp": patch
---

Fix npm install errors caused by `workspace:*` leaking into published tarballs.

- Switch publish flow from `changeset publish` (via `npm publish`) to `bun publish`, which rewrites Bun workspace protocol specifiers to concrete versions on publish.
- CLI: add `cloudflare upgrade` subcommand for self-updating the standalone binary against the latest GitHub Release (with `--check`, `--force`, and `--version` flags; SHA256 verified).
- Binaries: compile with `--bytecode` for ~2x faster startup, pin Bun version for reproducibility.
- README: lead with the standalone binary install via `scripts/install.sh`; document the `cloudflare upgrade` flow.

Known tradeoff: `bun publish` does not yet support npm provenance / OIDC trusted publishing, so the npm tarballs no longer carry sigstore attestations. The standalone binaries remain the primary distribution path and keep their SHA256 verification against the GitHub Release.
