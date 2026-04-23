---
"@cloudflare-ai-toolkit/sdk": patch
"@cloudflare-ai-toolkit/cli": patch
"@cloudflare-ai-toolkit/mcp": patch
---

Fix cross-package dependency versions, tag pushing, and binary compilation.

- `scripts/publish.sh` now runs `bun update --lockfile-only` before publishing so that `bun publish` resolves `workspace:*` against the bumped versions. Upstream bugs [oven-sh/bun#18906](https://github.com/oven-sh/bun/issues/18906) and [#20477](https://github.com/oven-sh/bun/issues/20477) cause `bun publish` to read workspace sibling versions from the lockfile (not live `package.json`), and `bun install` / `--force` / `--no-frozen-lockfile` silently skip refreshing those records. In 0.1.1, cli and mcp were published with `sdk@0.1.0` as a dep; in 0.1.2 they correctly reference the matching `sdk@0.1.2`.
- Root `version` script (`bun run version`) now also runs `bun update --lockfile-only`, so the Version Packages PR includes the refreshed lockfile.
- `scripts/publish.sh` now creates local git tags per package after each successful publish, restoring the tag-push step that `changesets/action` expects.
- Drop `--bytecode` from the binary compile step. The flag is incompatible with top-level `await` at parse time and causes the compiled binary to hang at runtime for our entrypoint. We'll revisit once Bun stabilizes bytecode support for ESM entrypoints.
