---
title: Configuration
description: Where the SDK, CLI, and MCP server find Cloudflare credentials, and how to keep them in the OS keychain.
---

# Configuration

The SDK, CLI, and MCP server read configuration the same way, through the SDK's
`loadConfig()`.

## Variables

| Variable | Purpose | Keychain? |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Preferred credential (Bearer auth) | yes (`api-token`) |
| `CLOUDFLARE_API_KEY` | Legacy Global API Key | yes (`global-api-key`) |
| `CLOUDFLARE_EMAIL` | Account email, required with `CLOUDFLARE_API_KEY`. `CLOUDFLARE_API_EMAIL` is an env-only alias. | yes (`global-api-key`) |
| `CLOUDFLARE_ACCOUNT_ID` | Default account for account-level commands and tools | no |
| `CLOUDFLARE_ZONE_ID` | Default zone for zone-scoped commands and tools | no |
| `CLOUDFLARE_BASE_URL` | API override (default `https://api.cloudflare.com`) | no |
| `CLOUDFLARE_KEYCHAIN` | `0`, `false`, `no`, or `off` turns the keychain lookup off | no |

Only secrets go in the keychain. Account and zone IDs are not secrets: keep them
in env or `.env`, or pass `--account-id` / `--zone-id` (CLI) or `accountId` /
`zoneId` (MCP) per call.

## Precedence

Each credential is resolved on its own, highest first:

1. **Process environment**, including `op run` and CI secrets.
2. **The nearest `.env`**, found by walking up from the current directory.
3. **The OS keychain**, service `cloudflare-ai-toolkit`.
4. Nothing (the credential is `missing`).

Explicit, per-project values win, so `op run` and CI behave exactly as before,
and a project `.env` overrides what is stored in the keychain.

If both an API token and a Global API Key resolve, the one from the higher
source wins, and the token wins a tie. A Global API Key exported in your shell
therefore beats a token that only lives in the keychain.

The keychain is read only for credentials that env and `.env` did not supply.
If `CLOUDFLARE_API_TOKEN` is already set, the keychain is never touched, so an
explicit key never causes a keychain prompt.

Bun copies `./.env` into the process environment at startup. A process env
value identical to the nearest `.env`'s value is reported as coming from that
file. Values Bun loads from `.env.local` or `.env.<NODE_ENV>` are reported as
`env`.

## OS keychain setup

Store a token once. On a terminal, the prompt hides what you type or paste:

```bash
cloudflare auth set api-token
```

Without a terminal (scripts, agents), pipe the value with `--stdin`:

```bash
pbpaste | cloudflare auth set api-token --stdin
op read 'op://Private/Cloudflare/credential' | cloudflare auth set api-token --stdin
```

The Global API Key uses two entries, so `--stdin` stores one per call:

```bash
op read 'op://Private/Cloudflare/global-key' | cloudflare auth set global-api-key --key CLOUDFLARE_API_KEY --stdin
printf 'you@example.com\n' | cloudflare auth set global-api-key --key CLOUDFLARE_EMAIL --stdin
```

The value is never accepted as an argument or flag, because arguments end up in
shell history and `ps` output. Each entry is named after its env var, so the
keychain, `.env`, and an MCP `env` block all use the same names. On macOS you
can see the entries in Keychain Access, or check one from a shell:

```bash
security find-generic-password -s cloudflare-ai-toolkit -a CLOUDFLARE_API_TOKEN
```

### Commands

| Command | What it does |
| --- | --- |
| `cloudflare auth set <credential> [--key NAME] [--stdin] [--dry-run]` | Store a credential. Hidden prompt on a terminal, `--stdin` otherwise. Reports `stored` or `would_store` per key, plus `shadowed_by` when env or `.env` will still override it. |
| `cloudflare auth list [--json \| --csv]` | Every credential key with its keychain state (`set`, `missing`, or `unknown` when the keychain can't be read) and the source that is active. Never prints values. |
| `cloudflare auth delete <credential> [--key NAME] --yes [--dry-run]` | Remove keychain entries. Refuses without `--yes`. Reports `deleted` or `not_found` per key. |
| `cloudflare auth migrate [--dry-run] [--overwrite]` | Copy credentials whose active source is a `.env` file into the keychain. |

`<credential>` is `api-token` or `global-api-key`. Every command takes `--json`.

Exit codes: `0` success, `1` unexpected failure, `2` usage error (unknown
credential, no terminal and no `--stdin`, empty value, missing `--yes`,
cancelled prompt), `3` keychain unavailable.

### Moving from `.env` to the keychain

```bash
cloudflare auth migrate --dry-run   # preview
cloudflare auth migrate             # store
cloudflare auth list                # confirm
```

`migrate` skips keys already in the keychain unless you pass `--overwrite`, and
leaves process-environment values (`op run`, CI) alone. It never edits files.
It returns a `clean_up` list of the `.env` files that still hold migrated keys.
Delete those lines yourself: until you do, the `.env` value keeps overriding
the keychain.

### Caveats

- **macOS access dialog.** The binary that created an entry reads it without
  asking. A different binary may get a "wants to use your confidential
  information" dialog: after a Bun upgrade, from the standalone `cloudflare`
  binary versus `bun run`, or when a GUI MCP host starts the server. Choose
  **Always Allow** to stop it from coming back.
- **Linux needs a Secret Service daemon** (GNOME Keyring or KWallet). Headless
  servers and CI usually have none; keep using env vars there. Set
  `CLOUDFLARE_KEYCHAIN=0` to skip the lookup entirely.
- **Bun only.** Keychain lookup uses `Bun.secrets`, so it works in the
  standalone binary, under `bun run`, and with `bunx --bun`. Under Node (an npm
  global install, `npx`), the keychain reports `unavailable`, and env or
  `.env` credentials keep working. `auth set` exits `3` there.
- **What it protects.** The keychain keeps credentials encrypted at rest, out
  of dotfiles, backups, and host config files. It does not protect against code
  that already runs as your user.

## MCP server

With a credential in the keychain, the host config needs no `env` block. The
server must run on Bun to reach the keychain:

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "bunx",
      "args": ["--bun", "@cloudflare-ai-toolkit/mcp"]
    }
  }
}
```

From a checkout:

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "bun",
      "args": ["run", "/abs/path/cloudflare-ai-toolkit/packages/mcp/src/index.ts"]
    }
  }
}
```

The server reads env, `.env`, and the keychain on every tool call, so a rotated
key applies without restarting the host. An `env` block holding only
`CLOUDFLARE_ACCOUNT_ID` is fine if you want a default account; it is not a
secret. The `get_credential_status` tool reports where each credential comes
from without returning values. There is no MCP tool that writes or deletes
credentials.

## SDK

```ts
import { CloudflareClient, loadConfig } from "@cloudflare-ai-toolkit/sdk";

const client = new CloudflareClient(await loadConfig());
```

`loadConfig({ secretStore })` accepts any `SecretStore` (`get`, `set`,
`delete`, `description`); pass `null` to skip the keychain. `resolveConfig()`
stays synchronous and never reads the keychain. Both return the usual
`CloudflareConfig` plus `credentialSources`, `keychain` (`ok`, `disabled`, or
`unavailable`), and `envFile`.
