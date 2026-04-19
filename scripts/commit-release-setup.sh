#!/usr/bin/env bash
# One-shot: stage all the rename + release plumbing, create the commit.
# Run from the repo root.

set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Remove any stale git lock left by the cowork sandbox.
if [ -f .git/index.lock ]; then
  echo "Removing stale .git/index.lock"
  rm -f .git/index.lock
fi

# 2. Stage everything that belongs in this commit.
git add -A -- \
  .gitignore \
  .mcp.json \
  README.md \
  bun.lock \
  package.json \
  .changeset/ \
  .github/ \
  scripts/ \
  packages/sdk/ \
  packages/cli/ \
  packages/mcp/

# 3. Show what will be committed.
git status

cat <<'MSG'

Next:
  # After renaming the GitHub repo to cloudflare-ai-toolkit, point origin at it:
  git remote set-url origin https://github.com/spenserhale/cloudflare-ai-toolkit.git

  # Commit everything staged above:
  git commit -m "chore(release): set up npm publishing + standalone binaries

    - rename npm scope @cloudflare-toolkit -> @cloudflare-ai-toolkit
    - update repository URLs to spenserhale/cloudflare-ai-toolkit
    - add Changesets config with fixed version group across sdk/cli/mcp
    - add publishable package.json metadata (bin, exports, files, engines)
    - add release workflow (Changesets) and binaries workflow (Bun compile)
    - add curl | sh installer script for standalone binaries
    - add cache purge commands (CLI + SDK + MCP)
    - add DNS records update + audit log TOON table rendering
    - tighten TS config for cross-package type resolution"

  # Don't push yet. We still need to create a changeset first.
MSG
