---
title: Inspect assigned Worker source and bindings
description: Extend migration assignments into supported account-scoped Worker inspection with private source artifacts.
status: in-progress
date: 2026-11-18
size: architectural
specs: []
---

## Intent

Extend PR #14's assignment readers from base e1cc1a1. The parent was merged during
this run as b90442b; the finished PR targets main. Implement, test and document
read-only Worker implementation inventory without release, deployment, migration,
live writes or repair of the separate Worker firewall block.

## Acceptance criteria

- Account-scoped settings, original source, deployments, version summaries and
  pinned Beta version modules are reachable from existing route/domain assignments.
- Preserve Worker/service/environment, deployment ID, version IDs/percentages,
  module bytes/names/media types, and binding names/types/resource identifiers.
- No code or binding values on stdout; optional source export uses private new
  directories/files. Credential-bearing URLs and upstream messages cannot leak.
- GET-only transport, strict envelopes/results, explicit numeric continuation,
  bounded source/metadata and nonzero errors distinguish empty, inaccessible,
  missing, retired, malformed and unsupported cases.
- Synthetic SDK and CLI HTTP/process tests cover multipart and pinned modules,
  redaction, scope, paging, 403/404/410/5xx and JSON/stderr/exit behavior.
- Existing DNS/redirect/WAF/assignment regressions stay green. Help, root/SDK/CLI
  README, CLI agent reference, guide and SDK/CLI changeset ship together.
- Recheck credential status without values; live reads only on authorized PBHS
  account/zones, only when configured. Missing access never implies empty data.

## Design

Use `WorkerInventoryReader` as the base for existing `InventoryReader`, keeping
Worker parsing/projection separate. Existing JSON GET transport remains; add an
authenticated response GET callback for original source, with shared HTTP error
classification and no writes. Only Worker readers suppress arbitrary error text;
retain HTTP status, API code and sanitized request identity through `describeError`.

Targets accept exactly `{script, accountId?}` or `{service, environment,
accountId?}`. The latter resolves literally only for `production`; other legacy
environments are unsupported. Do not use configured zone as account or environment.
Settings use `/workers/scripts/{name}/settings`, not `/script-settings` (which
contains script-level Logpush/tails only). Original source uses documented raw
`/workers/scripts/{name}`. Recognize JavaScript and HTTP multipart defensively;
do not claim undocumented headers prove pinned identity. Beta detail uses
`/workers/workers/{name}/versions/{version}?include=modules`.

`listWorkerDeployments` and `listWorkerVersions` return one numeric page, default
20, maximum 100, with `nextPage` and `truncated`. Honor explicit result_info and
use a conservative next page on a full page without totals. No automatic unbounded
`--all`. First deployment in page 1 is active according to API contract; uploaded
versions are not deployment proof. Never infer a successful empty history on error.

Settings project runtime fields; bindings use type-specific resource allowlists.
Plain-text/JSON/secret/key values are always redacted. Unknown fields/types remain
explicitly uninspected. Source helper returns metadata only, optionally writes
bytes to generated filenames with a manifest. No raw source in public return
objects. Enforce 20 MiB source, 500 modules, bounded names and 1 MiB metadata.
Alternative stdout source loses on credential safety; see ADR 0003.

## Spec delta

- D1 ADDED: Account-scoped Worker settings/source/deployment/version readers and
  production-domain target resolution; explicit unsupported legacy environments.
- D2 ADDED: Private source export, projected/redacted bindings, safe metadata,
  numeric continuation and truthful failure/unavailable semantics.
- D3 MODIFIED: Migration guide and CLI reference now resolve assignments into
  implementation inventory; installation uses this feature branch and JS builds.

## Docs impact

Root, SDK and CLI README; `cloudflare-cli/SKILL.md`; migration guide; minor SDK/CLI
changeset. Existing parent plan/evidence remains historical.

## Decisions

- [0003: Private Worker inspection](../decisions/0003-private-worker-inspection.md)
- [0002: Read-only inventory](../decisions/0002-read-only-migration-inventory.md)

## Rulings

- [source safety] Export original bytes only to private artifacts; never attempt
  heuristic code rewriting — cost if wrong: high, source can contain credentials.
- [API] Use documented Beta version module API for pinned source; raw downloads
  remain unpinned — cost if wrong: medium, Beta access may be unavailable.
- [environment] Domain service means Worker name; only production resolves
  literally; reject legacy environment names — cost if wrong: medium, manual
  supported-tool inspection remains necessary for legacy environments.
- [docs] Follow existing docs/plans, decisions, README and Changesets; no separate
  contribution guide or spec map — cost if wrong: low, files can move.
- [baseline] Frozen install, build, lint and tests pass: SDK 283/MCP 12/CLI 319
  (614); fast test forms verified — cost if wrong: low.
- [isolation] Harness already provides linked worktree and feature branch; no
  additional worktree — cost if wrong: low.
- [credentials] Status recheck shows keychain ok, all three credentials missing
  and active_source missing — cost if wrong: low, live inventory remains unknown.
- [target] User changed PR base to main after merging parent; no release or merge
  authorized for this feature — cost if wrong: low.
- [source helper] T1 has 35 passing tests, including failing-then-passing MIME,
  URL identity, encoding and manifest-limit regressions. Existing ancestors are
  canonicalized (macOS /tmp is a symlink); destination leaf must be new — cost if
  wrong: medium, local filesystem races require a hostile same-user process.
- [SDK review] Numeric-only upstream codes, pinned UUID/prefix identity checks,
  nonpaged completeness and metadata/binding validation before export are covered
  by failing-then-passing regressions. Explicit export of unavailable modules
  fails `SOURCE_UNAVAILABLE`; metadata-only reads remain unavailable — cost if
  wrong: medium, unsupported Beta responses need manual inspection.
- [URL review] Two more failing helper cases closed protocol-relative credential
  URL leaks; helper now has 37 passing cases. SDK projections cover the same
  form — cost if wrong: medium, conservative URL redaction hides some labels.
- [final review] Two findings reproduced before correction: Node exports could
  wait on cancellation of a cloned stream, and contradictory pagination totals
  could claim completeness. Source is now consumed once with metadata validation
  before export; numeric totals must be consistent. Node subprocess and SDK
  regressions fail before and pass after — cost if wrong: medium, malformed
  upstream responses now fail conservatively instead of exporting partial data.

## Deferred

Legacy service environments, dispatch namespaces, static assets, secret values,
resource contents and sourcemaps. Beta entitlement/permission failures remain
failed reads. Live PBHS verification depends on credentials unavailable at start.

## Tasks

For agentic workers: add-subagent-driven-development with test-first implementation.
Coordinator commits; implementers never change git state.

**Goal:** Supported private Worker inspection behind existing assignments.
**Architecture:** Worker reader plus private source helper, thin CLI commands.
**Tech stack:** TypeScript, Zod, Bun, Stricli, Vitest, Node filesystem APIs.
**Detail:** contracts.
**Verify:** fast `bun test packages/sdk/tests/inventory.test.ts` and
`bun run --filter '@cloudflare-ai-toolkit/cli' test -- src/commands/inventory.e2e.test.ts`;
full `bun run build && bun run lint && bun run test`.
**Global constraints:** Synthetic fixtures only, disable keychain in tests, no
live HTTP in tests, GET only. No release/live writes or local compiled binary smoke.

### T1: Private source inspection helper · design · standard model

**Owns:** `packages/sdk/src/worker-source.ts`, `packages/sdk/tests/worker-source.test.ts`.
**Depends on:** none.
**Consumes:** successful Response or Beta modules and safe identity.
**Produces:** `inspectWorkerContent(response, options)` and
`inspectWorkerModules(modules, mainModule, options)`;
options `{outDir?:string, identity:Record<string,string>, sanitize:(s:string)=>string}`.
Result `WorkerSourceInspection`: format service-worker|modules, optional entrypoint,
modules `{name,contentType,bytes,sha256,file?}[]`, totalBytes, artifactDirectory?,
sensitive:true, truncated:false. Never returns source bytes.
**Tests:** raw JavaScript, multipart multiple JS/text/binary modules, duplicate
names, bad boundary, metadata/entrypoint, unsupported MIME, oversize, base64,
new 0700/0600 artifacts, byte preservation, existing/symlink destination safety,
failure cleanup and no raw code in JSON/errors.
**Review:** yes — sensitive artifacts, traversal and module preservation.
**Docs:** coordinator SDK README D2; ADR 0003.
**Commit:** `feat(sdk): inspect Worker source through private artifacts`.

### T2: Account-scoped Worker readers · design · standard model

**Owns:** `packages/sdk/src/worker-inventory.ts`, `packages/sdk/src/inventory.ts`,
`packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`,
`packages/sdk/tests/worker-inventory.test.ts`, SDK README.
**Depends on:** T1 for verification (implementation can use contract).
**Consumes:** T1 source helper; existing JSON GET + new response GET callback.
**Produces:** inherited `client.inventory.getWorkerSettings(target)`,
`getWorkerSource(target,{outDir?})`, `listWorkerDeployments(target,{page?,perPage?})`,
`listWorkerVersions(target,{page?,perPage?})`,
`getWorkerVersion(target,version,{outDir?})`.
All results include scope:account, accountId, script and optional service/environment.
Settings result `{settings,bindings,bindingsStatus:'present'|'unavailable',truncated:false}`;
source `{source:WorkerSourceInspection}`; lists `{deployments|versions,resultInfo,
nextPage:number|null,truncated:boolean}`; version `{version,bindings,bindingsStatus,
source:WorkerSourceInspection|null,sourceStatus:'present'|'unavailable'}`.
e.g. settings of no bindings explicitly returned by API has bindings:[],
bindingsStatus:present; omission gives bindings:null, bindingsStatus:unavailable.
**Tests:** exact paths/query GET only, script/production-domain identity, unsupported
env, account defaults/conflicts, projected bindings and all value redaction,
no arbitrary error-body leaks, 403/404/410/5xx, malformed envelopes/results,
deployment splits/version identity and numeric continuation including incomplete info.
**Review:** yes — scope, validation, security, regression seam.
**Docs:** SDK README D1/D2, coordinator guide/changeset.
**Commit:** `feat(sdk): add supported account Worker inventory readers`.

### T3: CLI commands and HTTP subprocess tests · design · standard model

**Owns:** `packages/cli/src/commands/worker-inventory.ts`,
`packages/cli/src/commands/worker-inventory.e2e.test.ts`, `packages/cli/src/app.ts`,
CLI README.
**Depends on:** T2 for verification (tests can use mocked HTTP contract).
**Consumes:** T2 public reader methods.
**Produces:** `workers settings get <worker>`, `workers source get <worker>`,
`workers deployments list <worker>`, `workers versions list <worker>`,
`workers versions get <worker> <version>`; --account-id, --environment, --json;
lists --page/--per-page; source/version --out-dir. Default positional worker is
script; explicit --environment selects domain service/environment target.
**Tests:** JSON stdout/stderr/nonzero, parser/help, GET enforcement, exact
source bytes private on disk and never stdout, bindings, production/legacy env,
paging, denial/missing/retired/upstream/malformed/unsupported source.
**Review:** yes — process wiring and artifacts.
**Docs:** CLI README D1/D2; coordinator root README/agent reference/guide D3.
**Commit:** `feat(cli): expose safe Worker implementation inspection`.

### T4: Documentation, smoke evidence, final review and PR · design · standard model

**Owns:** shared docs, changeset, plan closure.
**Depends on:** T3.
**Consumes:** verified JS build and read commands.
**Produces:** copy-paste PBHS assignment resolution, installation and private
export recipe, API sources and unsupported cases, exact live access evidence;
reviewed PR targeting main with no release/merge.
**Tests:** full build/lint/tests; Node JS help; Bash recipe syntax and mocked
execution; credential status without values and conditional GET-only smoke.
**Review:** yes — fresh final reviewer reads base..HEAD and task requirements.
**Docs:** D3 and verification evidence.
**Commit:** `docs(inventory): document and verify Worker inspection workflow`.
