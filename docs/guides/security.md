---
title: Security
description: How the toolkit handles Cloudflare credentials.
---

# Security

## Credentials

- **The OS keychain is the persistent store with no plaintext.** `cloudflare
  auth set` writes to the macOS Keychain, Linux Secret Service, or Windows
  Credential Manager through `Bun.secrets`. There is no plaintext fallback: if
  the keychain is unavailable, the command fails with exit code 3 instead of
  writing a file.
- **Credentials never go in argv.** `auth set` reads from a hidden terminal
  prompt or from stdin (`--stdin`), never from an argument or flag, so values
  stay out of shell history and process listings.
- **Values are never printed.** `auth list`, `auth set`, `auth migrate`, and the
  MCP `get_credential_status` tool report key names, states, and sources only.
- **Explicit sources win.** Process env and `.env` outrank the keychain, so
  `op run` and CI secrets behave as before. `auth set` warns (`shadowed_by`)
  when a stored value will be ignored.
- **`auth migrate` does not edit files.** It copies `.env` credentials into the
  keychain and lists the files you still need to clean up.
- **The MCP server cannot change credentials.** It reads them on each call and
  has no tool that writes or deletes them. Agents manage credentials only
  through the CLI, where `auth delete` requires `--yes`.
- **Scope.** The keychain protects credentials at rest. It does not protect
  against code already running as your user.

## Tests

Tests never touch the real keychain. SDK and CLI unit tests inject an in-memory
`SecretStore`. Every spawned CLI or MCP process in the test suites sets
`CLOUDFLARE_KEYCHAIN=0`, and the CLI (vitest) and MCP (`bun test` preload)
suites set it globally.
