---
"@cloudflare-ai-toolkit/sdk": patch
"@cloudflare-ai-toolkit/cli": patch
"@cloudflare-ai-toolkit/mcp": patch
---

Fix cross-package dependency versions, tag pushing, and binary compilation.

- `scripts/publish.sh` now runs `bun install --no-frozen-lockfile` before publishing so that `bun publish` resolves `workspace:*` against the just-bumped versions instead of the stale lockfile. In 0.1.1, cli and mcp were published with `sdk@0.1.0` as a dep; in 0.1.2 they correctly reference the matching `sdk@0.1.2`.
- Root `version` script (`bun run version`) now also runs `bun install --no-frozen-lockfile`, so the Version Packages PR includes the updated lockfile.
- `scripts/publish.sh` now creates local git tags per package after each successful publish, restoring the tag-push step that `changesets/action` expects.
- Drop `--bytecode` from the binary compile step. The flag is incompatible with top-level `await` at parse time and causes the compiled binary to hang at runtime for our entrypoint. We'll revisit once Bun stabilizes bytecode support for ESM entrypoints.
