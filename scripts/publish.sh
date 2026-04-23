#!/usr/bin/env bash
# Publish workspace packages via `bun publish`.
#
# Why this exists: `changeset publish` uses `npm publish`, which does not
# rewrite Bun's `workspace:` protocol in dependencies. `bun publish` does —
# so we iterate packages here and let Bun pack+publish each one, resolving
# workspace refs to concrete versions in the process.
#
# Emits `🦋 New tag:  <name>@<version>` lines for each newly published
# package so `changesets/action` can parse its `publishedPackages` output
# from stdout (downstream steps depend on that).
#
# Run from the repo root.

set -euo pipefail

cd "$(dirname "$0")/.."

PACKAGES=(packages/sdk packages/cli packages/mcp)

bun run build

for pkg in "${PACKAGES[@]}"; do
  name=$(node -e "console.log(require('./${pkg}/package.json').name)")
  version=$(node -e "console.log(require('./${pkg}/package.json').version)")

  # Skip if the exact version is already on npm. Lets re-runs be idempotent
  # and lets us publish only the packages whose versions changed.
  published=$(npm view "${name}@${version}" version 2>/dev/null || true)
  if [ "$published" = "$version" ]; then
    echo "🦋  info skipping ${name}@${version} (already on npm)"
    continue
  fi

  echo "🦋  info publishing ${name}@${version}"
  (cd "$pkg" && bun publish --access public)

  # Emit in the format changesets/action parses. The double-space after the
  # colon matches the exact `changeset publish` output format.
  echo "🦋  New tag:  ${name}@${version}"
done
