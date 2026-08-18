---
"@cloudflare-ai-toolkit/cli": minor
---

Make `cloudflare upgrade` install-method aware.

- Standalone binary installs (from `scripts/install.sh`) self-update from GitHub Releases as before (SHA256-verified).
- npm/bun/pnpm global installs are now detected from the CLI's real path inside global `node_modules` and upgraded through their owning package manager: `npm install -g @cloudflare-ai-toolkit/cli@<version>`, `bun add -g`, or `pnpm add -g`. Previously these installs exited with an error telling the user to upgrade manually.
- `--check` reports update availability for both install methods without installing.
- Unrecognized layouts (source checkouts) and yarn installs fall back to actionable manual instructions instead of a dead end.
