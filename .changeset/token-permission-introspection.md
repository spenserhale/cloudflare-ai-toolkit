---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add API token permission introspection to the SDK, CLI, and MCP server

Answering "does this token have permission to do X" previously meant attempting
a reversible write and reading the failure. Cloudflare does expose the answer,
so surface it.

**SDK**

- `getApiToken(tokenId?, accountId?)` fetches a token's full definition. It
  defaults to the calling token, resolving its own ID via `verifyToken`.
- `getTokenPermissions(tokenId?, accountId?)` flattens the token's policies into
  one entry per permission group, each carrying its own effect, scope
  (user/account/zone), and resources.
- `listTokenPermissionGroups({name, scope, accountId})` returns the assignable
  permission-group catalog, which is how a name resolves to a stable ID.
- `verifyToken` now takes an optional `accountId` for account-owned tokens.
- New pure helpers, usable without a client: `checkTokenPermissions`,
  `permissionMatchesQuery`, `flattenTokenPolicies`, `flattenPolicyResources`,
  `deriveTokenPermissionScope`, `normalizePermissionQuery`,
  `readPermissionGroupScopes`, and `suggestPermissionNames`.

**CLI** — `cloudflare tokens verify | show | permissions | groups`

`tokens permissions --check "<name|id>"` is repeatable and gates on exit status,
following `grep`'s convention: `0` every check granted, `1` at least one
definitively not granted, `2` the question could not be answered. The third code
is deliberate — collapsing it into `1` would report "you lack this permission"
when the truth is "nobody could tell".

**MCP** — `verify_api_token`, `get_api_token`, `get_token_permissions`,
`check_token_permissions`, `list_token_permission_groups`.

**Matching semantics.** Cloudflare documents a permission group's `id` as the
stable key and its `name` as "cosmetic and subject to change", so checks match
on either. Name matching is case-insensitive, treats the dashboard's `Edit` as
the API's `Write`, and accepts a leading scope word — `Zone:Config Rules:Edit`,
`Config Rules Write`, and the group's ID all match the same permission. A query
is granted only if it matches an `allow` and no `deny`; a matching deny anywhere
makes the check report not-granted, since as a gate a false negative costs a
retry while a false positive costs a failed write.

**Required permission.** Only `tokens verify` works with any token; it confirms
the token is active but returns no scope. Reading a token's own policies needs
`User -> API Tokens -> Read` on the token itself, and without it Cloudflare
answers `403` code `9109` — which reads like a generic authorization failure, so
the CLI names the missing permission and points at `tokens verify` as the
fallback.
