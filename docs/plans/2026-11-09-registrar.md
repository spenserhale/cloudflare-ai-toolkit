# Domain registration (Registrar API)

## Design
Wrap the Registrar API beta (`/accounts/{id}/registrar/...`): domain-search, domain-check, registrations (create, list, get) and registration-status. The SDK adds typed client methods plus two helpers. `prepareDomainRegistration` gates any purchase on a fresh registry check: the domain must be registrable, standard tier, priced, and within an optional price ceiling. `waitForRegistration` polls a workflow until it reaches a terminal state and never re-submits. The CLI exposes `registrar search|check|register|status|get|list`; MCP exposes the same six operations as tools.

## Rulings
- Purchases are guarded twice. The CLI re-checks, prints the price, and requires typing the full word `yes`; non-TTY needs `--yes`; `--maxPrice` aborts on a price change. The MCP `register_domain` tool has no prompt, so it requires the user-approved `maxRegistrationCost` and `currency`, and it refuses (returning the fresh check) instead of buying when they don't match. It is always registered and annotated `readOnlyHint: false, destructiveHint: true`, so clients that split read and write tools (Claude's connector settings) let an administrator set it to Ask or Block. Permission control belongs to the client, so there is no server-side opt-in flag.
- Premium domains are refused client-side. The API does not support them yet, and they would need a fee acknowledgement.
- `--sandbox` / `sandbox: true` targets `/registrar-sandbox`, a real non-billing mirror. Live validation used it, so no purchase was made.
- Prices are compared as exact decimals (integer micros), not floats.
- Registration permission hints are not added to `ROUTE_PERMISSION_HINTS`: the API reference and OpenAPI schema don't name the token permission group, and we don't guess.
- Out of scope: `PATCH` registration (auto-renew), extensions discovery, and transfers (`transfer-in`, `domain-transfer-check`).

## Live findings (account f5262aa0…, 2026-11-09)
- The workflow status response has **no top-level `domain_name`**; it is in `context.domain_name`, and `context.registration` (shown in the docs) is absent. The client lifts the name to the top level, and the CLI calls `getRegistration` after a success to show expiry.
- The sandbox address book is separate from production. The sandbox had no default contact, but production did: the live purchase below used the account default.
- In the sandbox, without a default address-book contact, register fails with `No registrant contact provided and no default address book entry found for this account.` (code 10000), hence `--contact`.
- `registration-status` for a domain registered in the dashboard returns `No workflow found` (code 10000). The CLI points to `registrar get` instead.
- The sandbox rejects `.dev` as `extension_not_supported_via_api`; `.com` works. `Prefer: respond-async` returned `pending`, which completed in ~2s.

- **Live purchase:** `registrar register wapuuagent.com --maxPrice 11.17 --yes` (2026-11-09, user-requested) re-checked at 11.17 USD, completed synchronously (`succeeded`) in ~4s, and `getRegistration` showed `active`, expiring 2027-11-09, auto-renew off, redaction on, `locked: false`.
- There is no address-book or contacts endpoint in the OpenAPI schema; the default registrant contact is dashboard-only.

## Follow-up: permissions and explanatory errors
- Every MCP tool now declares annotations from `tools/annotations.ts` (`READ_ONLY`, `ADDITIVE_WRITE`, `DESTRUCTIVE_WRITE`); a registration test enforces it.
- `describeError` (SDK) explains any failure: code, request, permission, status meaning (401/403/404/429/5xx), known fixes (missing default registrant, no workflow, missing credentials), and docs. MCP applies it to every tool via `withExplanatoryErrors`; the CLI formatters call it.

## Verification
`bun run test` (sdk 191, mcp 11, cli 211), `bun run lint`, `bun run build`, and `node packages/cli/dist/bin.js registrar --help`. Live: search, check, list, and get in production. Register (sync and `--noWait`), status `--wait`, refusal paths, and every MCP tool were run in the sandbox.
