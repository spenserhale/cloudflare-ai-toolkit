# DNS record creation

## Design
Add `dns records create <zone-id>` beside update, with required type, name and content and optional ttl, proxied, comment and json. The SDK validates input and POSTs to `/zones/{zone_id}/dns_records`, then returns the parsed record including ID. Use existing API error handling, with DNS Write permission guidance for POST. Pass content directly as a string so shell-quoted TXT values retain spaces.

## Rulings
- Follow update output and boolean flag conventions; no new output format or interactive prompt.
- Leave TTL defaults to Cloudflare; preserve server validation messages.
- This task adds the command only; no live DNS record will be created.

## Tasks
1. Add SDK and CLI integration regression tests for creation, exact TXT content, optional fields, required flags, validation errors and permission errors. Run failing tests first.
2. Add SDK schema, exports and client method; register CLI command following update.
3. Document usage and add release changeset. Run full tests, lint, build and JS help smoke test.

## Verification
Fast: `bun test packages/sdk/tests/dns-records.test.ts`; CLI: `bun run --cwd packages/cli test src/commands/read.e2e.test.ts`. Full: `bun run test`, `bun run lint`, `bun run build`.

## MCP and release follow-up
Expose `create_dns_record` using the shared SDK schema and return JSON including ID. Include API error codes and DNS Write permission guidance. Release all fixed-group packages as 0.9.0 through the existing main-branch release workflow.

Built CLI bundles SDK source via TypeScript paths while leaving zod external. Declare zod directly in CLI dependencies so the Node smoke test and published installs resolve it with isolated dependencies.

Validation: full tests, lint and build passed; Node CLI create help passed after declaring zod. MCP execution test confirms exact TXT content and returned ID.
