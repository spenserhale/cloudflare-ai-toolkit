---
title: "0001: Store credentials in the OS keychain through Bun.secrets"
description: Why Cloudflare credentials can live in the OS keychain, and the precedence and scope rules around it.
---

# 0001: Store credentials in the OS keychain through Bun.secrets

- **Status:** Accepted
- **Date:** 2026-11-09

## Context

Every place a credential could live was plaintext at rest: env vars exported
from a shell profile, a project `.env`, or the `env` block of an MCP host
config. The MCP setup in particular pushed users toward pasting a literal token
into a JSON file. `op run` avoided this but only for one process at a time.

The same design already shipped in `wide-search-toolkit` 0.2.0, and this repo
follows it so the toolkits behave alike.

## Decision

- Use `Bun.secrets` (macOS Keychain, Linux libsecret, Windows Credential
  Manager), read through `globalThis.Bun?.secrets` so Node consumers of the SDK
  skip it quietly. Rejected: `keytar` (archived), `@napi-rs/keyring` (native
  optional dependencies that `bun install` can skip), and shelling out to
  `security` (macOS only, and it passes values through argv).
- One entry per credential under service `cloudflare-ai-toolkit`, named exactly
  like its env var: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_API_KEY`,
  `CLOUDFLARE_EMAIL`. The `CLOUDFLARE_API_EMAIL` alias stays env-only.
- Only secrets are stored. `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and
  `CLOUDFLARE_BASE_URL` are ordinary config and stay in env, `.env`, or
  per-call arguments. An MCP host can still carry an `env` block with just the
  account ID; it is not a secret.
- Precedence per credential: process env > nearest `.env` > keychain. When a
  token and a Global API Key both resolve, the higher source wins and the token
  wins a tie, so an explicit global key is not overridden by a stored token.
- `loadConfig()` is async and reads only the credentials env and `.env` did not
  supply, in parallel. `resolveConfig()` stays synchronous so existing callers
  don't change. A keychain failure is reported as `keychain.status:
  "unavailable"`, never thrown. `CLOUDFLARE_KEYCHAIN=0` (env or `.env`) turns
  the lookup off.
- Because Bun copies `./.env` into `process.env`, a process env value equal to
  the nearest `.env`'s value is attributed to the file. Without this, Bun runs
  would label every `.env` credential as `env`, and `auth migrate` and the
  `shadowed_by` warning would be wrong.
- CLI `auth set|list|delete|migrate`. Values come from a hidden prompt or
  `--stdin`, never argv. Mutations take `--dry-run`, `delete` needs `--yes`,
  and exit codes are enumerated (2 usage, 3 keychain).
- The MCP server reads the keychain on every tool call and has no tool that
  writes or deletes credentials. It gains a read-only `get_credential_status`.
- No plaintext fallback store, no profiles, and `migrate` never edits files.

## Consequences

- MCP hosts and the CLI work with no `.env` and no `env` block once a token is
  stored, as long as they run on Bun (standalone binary, `bun run`, or
  `bunx --bun`). Under Node, credentials still come from env and `.env`.
- macOS may show an access dialog when a different binary reads an entry, for
  example after a Bun upgrade or from a GUI MCP host.
- Linux machines without a Secret Service daemon get `unavailable` and keep
  using env vars.
- Tests must never reach the real keychain. Unit tests inject an in-memory
  store, and spawned processes set `CLOUDFLARE_KEYCHAIN=0`.
- This repo has no user config file, so the reference design's
  "keychain > user config file" tier does not apply here.
