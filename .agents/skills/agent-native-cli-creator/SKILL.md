---
name: agent-native-cli-creator
description: Best practices for designing CLI tools that AI agents can drive reliably — non-interactive flags, structured output (TOON by default, JSON/CSV alternates), enumerated errors, idempotent mutations, bounded responses, consistent vocabulary, three-layer introspection, async-aware execution, profiles, and two-way I/O. Use this skill whenever the user is designing, building, scaffolding, refactoring, code-reviewing, or planning a CLI tool — even when they don't say "agent-native," and especially when they mention agents, MCP, automation, scripting, headless usage, --json output, "developer experience," or want their CLI to be usable by Claude/Codex/Cursor or other coding agents.
---

# Agent-Native CLI Creator

Design CLIs so an AI agent can drive them in production without burning tokens, retries, or surprise. The shorthand is **design for agents first** — everything that makes a CLI legible to an agent also makes it more pleasant for a human at a terminal. The opposite is not true.

## When to use

Activate this skill when the user is:

- Designing or scaffolding a new CLI (any language)
- Reviewing or refactoring an existing CLI for agent / automation usability
- Building an MCP server that wraps a CLI, or a CLI that wraps an HTTP API
- Asking how to make a tool "agent-friendly," "scriptable," "headless," or "Claude-Code-compatible"
- Debating flag names, output formats, error messages, or async ergonomics
- Discussing TOON vs JSON, structured output, exit codes, --json conventions
- Picking conventions for `get`/`list`/`create`/`update`/`delete`, `--force`, `--dry-run`, `--wait`, profiles
- Writing a CLI style guide, contributing guide, or schema for codegen

If a user is *using* an existing CLI (not designing one), pull a tool-specific skill instead — this one is for *building* CLIs.

## Core philosophy

The classic Command Line Interface Guidelines treat a human at a terminal as the primary user and agents as a tolerated secondary audience. That's the wrong default now. Cloudflare puts it directly in their schema-CLI post: *"Increasingly, agents are the primary customer of our APIs."* HeyGen launched their CLI with "agent" in the marketing copy. Design for agents first, and humans benefit. Designing for humans first and bolting on agent support is what produces the inconsistent, prompt-prone, stdout-only CLIs Tier 1 below exists to correct.

The 10 principles split into two tiers:

- **Tier 1 — Table stakes.** Don't break the agent. Fail any of these and the deck is stacked against the model on every call.
- **Tier 2 — Compounding.** Empower the agent. These make the CLI better the more it gets used and let one CLI compose with dozens of others the agent already knows.

Examples below use a fictional `aicli` for managing DNS records (a domain everyone has intuition for: `zone`, `record`, `type`, `name`, `content`, `ttl`).

---

## Tier 1 — Table stakes

### 1. Non-interactive by default

If a command can prompt, an agent will eventually hit it from a context where nothing answers — a subagent, a CI job, a piped invocation. The command hangs. Silently. Until something kills it.

```bash
# Hangs forever — there's no human to type "y"
$ aicli record delete rec_a14b9c < /dev/null
Are you sure you want to delete rec_a14b9c (A www.example.com)? [y/N]: ^C

# --force bypasses the prompt; agent gets through cleanly
$ aicli record delete rec_a14b9c --force
type: deleted
id: rec_a14b9c
```

**What good looks like:**
- `--force` on every destructive command (Cloudflare's standard; explicitly bans `--skip-confirmations`)
- `--yes` for non-destructive confirmation bypass
- Honest TTY detection — when stdout/stderr aren't a terminal, behave as headless automatically (don't paginate, don't prompt, don't color)
- Replace interactive menus with explicit flags or file input (`--from-file=records.csv`)

> **Blocker:** silent hang on a prompt. **Friction:** inconsistent prompt-bypass across subcommands. **Target:** one comprehensive non-interactive mode the agent never has to look up.

### 2. Structured, parseable output

Aligned tables with ANSI color are for humans. Agents extracting an ID need a parser-friendly format on stdout.

```bash
# TOON is the default machine format — compact, indentation-based,
# cheaper in tokens than JSON for typical record shapes
$ aicli record list
records[3]:
  - id: rec_a14b9c
    type: A
    name: www
    content: 192.0.2.10
  - id: rec_b22e71
    type: A
    name: api
    content: 192.0.2.11
  - id: rec_c8d04f
    type: CNAME
    name: docs
    content: www.example.com

# --json and --csv when the consumer prefers them
$ aicli record list --json | jq '.records[0].id'
"rec_a14b9c"

$ aicli record list --csv
id,type,name,content
rec_a14b9c,A,www,192.0.2.10
rec_b22e71,A,api,192.0.2.11
rec_c8d04f,CNAME,docs,www.example.com

# Errors go to stderr; exit codes signal failure class
$ aicli record get rec_does_not_exist
$ echo $?
4
# stderr: error: record not found: rec_does_not_exist (zone: example.com)
```

**Why TOON as default?** TOON (Token-Oriented Object Notation) was designed for LLM consumption: indentation-based, no quote noise, materially cheaper in tokens than JSON for typical record/list shapes. Agents are the primary consumer of structured CLI output, so the default should be optimized for them. JSON and CSV stay first-class for tooling that already speaks them (jq, Excel, dataframes). See https://github.com/johannschopplich/toon for the spec.

**What good looks like:**
- A single canonical machine format flag set: `--toon` (default), `--json`, `--csv` — never `--format=toon` mixed with `--output json`
- Coverage: every data-returning command supports all three; no "this one only does JSON" gaps
- Stable exit-code taxonomy (e.g., `0` ok, `1` generic error, `2` usage, `3` config, `4` not-found, `5` auth, `6` rate-limited)
- Results to stdout, diagnostics to stderr, ANSI suppressed when stdout isn't a TTY

> **Blocker:** no structured output. **Friction:** coverage gaps; some commands JSON-capable, others not. **Target:** uniform `--toon` / `--json` / `--csv` across the CLI with documented exit codes.

### 3. Errors that teach, and enumerate

Errors are the highest-signal moment an agent gets — they fire exactly when the agent doesn't know what to do next. Don't waste them.

```bash
# Useless — agent now has to read --help, parse, guess, retry
$ aicli record create --type=AAAAA --name=www --content=2001:db8::1
error: invalid type

# Better — names the valid set, agent self-corrects in one retry
$ aicli record create --type=AAAAA --name=www --content=2001:db8::1
error: --type must be one of: A, AAAA, CNAME, MX, TXT, NS, SRV, CAA (got: "AAAAA")
hint: did you mean AAAA?
```

The pattern generalizes. Any time the CLI rejects input against an enum, an enum-shaped resource list (zone names, profile names, region codes), or a schema, **surface the enumeration in the error itself**. Don't make the agent run `--help` to discover it.

**What good looks like:**
- Validate input early, before any side effects
- Echo the offending value in quotes (`got: "AAAAA"`) so the agent can grep its own state
- Enumerate valid values when the cause is enum-shaped
- Include a working example in the error text where the fix isn't obvious
- No raw stack traces — those are a sign your error layer is unfinished

> **Blocker:** silent or vague failure. **Friction:** error names the problem but not the solution. **Target:** error includes the valid set and a working invocation.

### 4. Safe retries and explicit mutation boundaries

Agents retry. A human glances at a duplicate row and notices; an agent doesn't.

```bash
# Idempotent create — second call returns the existing record, not a duplicate
$ aicli record create --type=A --name=www --content=192.0.2.10
id: rec_a14b9c
existing: false

$ aicli record create --type=A --name=www --content=192.0.2.10
id: rec_a14b9c
existing: true

# --dry-run shows what would happen, with no side effect
$ aicli record delete rec_a14b9c --dry-run
status: dry_run
would_delete:
  id: rec_a14b9c
  type: A
  name: www
  content: 192.0.2.10
```

**What good looks like:**
- Idempotency tokens (`--idempotency-key=...`) or natural keys (zone+type+name+content for DNS) so a retried `create` returns the existing resource, not a duplicate
- `--dry-run` on anything consequential, returning the same shape as the real call plus `status: dry_run`
- Destructive ops require an explicit `--force` (or `--idempotency-key`) — never default-yes
- Every mutation response returns the resource id and current state, so the agent has something to reference on the next call

**Async wrinkle (see Principle 8):** retries on long-running ops aren't just about idempotency at submission — they're about idempotency across the whole submit-poll-collect arc. If the agent's first invocation submits a job and dies mid-poll, the second invocation must find the in-flight job, not start a new one. A persistent job ledger solves this.

> **Blocker:** silent duplication on retry. **Friction:** scriptable destruction without preview. **Target:** idempotent mutations, durable job state, explicit destructive flags.

### 5. Bounded responses, at every layer

Tokens cost money and context. Big outputs are sometimes justified; the default should be narrow.

```bash
# Default page size is bounded; truncation tells the agent how to narrow
$ aicli record list
records[20]:
  - { id: rec_a14b9c, type: A, name: www, content: 192.0.2.10 }
  ...
truncated: true
total: 487
hint: add --limit=N, --filter=type:A, or --cursor=<next> to narrow

# Cursor for explicit continuation
$ aicli record list --cursor=eyJwYWdlIjoyfQ
records[20]:
  ...
next: eyJwYWdlIjozfQ
```

This applies at two layers:

1. **Runtime output.** `list` returning 10,000 rows, logs dumping forever, debug output the agent can't escape.
2. **Tool-description surface.** This is the layer most CLIs miss. Cloudflare's Code Mode MCP serves over 3,000 operations in under 1,000 tokens; most MCP servers spend 1,000 tokens on a single tool's description. A bloated description never gets read by a human, but every agent that loads the server pays the toll on every call.

**What good looks like:**
- Filtering, pagination, `--limit` on every list-style command
- Concise vs. detailed modes (`--summary` vs. `--detailed`)
- Truncation messages that teach the agent how to narrow the next query (don't just say "truncated" — name the flags)
- Summary-before-detail responses for nested structures
- For MCP wrappers: a per-tool description token budget, audited at build time — not "however much explanation felt natural"

> **Blocker:** routine commands dumping unbounded output. **Friction:** broad defaults with narrowing available but unhinted. **Target:** bounded defaults that *teach* better queries, plus an MCP surface where every tool description fits in a tweet.

---

## Tier 2 — Compounding

### 6. Cross-CLI vocabulary consistency

The principle most under-stated in the original list. Agents don't memorize one CLI at a time — they build a generalized model of what CLIs do, drawn from every CLI they've seen. When your tool uses `info` for what every other tool calls `get`, the agent doesn't fail; it succeeds slowly, with extra retries, after burning tokens on `--help`. Multiply across thousands of agent invocations per week and the cost is real.

```bash
# Conforming — agents recognize these immediately, zero retries
$ wrangler kv namespace list --json
$ heygen videos list --json
$ aicli record list --toon

# Off-convention versions an agent has to relearn for each tool
$ aicli record ls                    # use list, not ls
$ aicli record info rec_a14b9c       # use get, not info
$ aicli record delete rec_a14b9c \
    --skip-confirmations             # use --force, not --skip-*
$ aicli record list \
    --output=json                    # use --json, not --output=json or --format=json
```

**Canonical schema-layer rules** (extend / adjust to your community, but pick something and enforce it):

- Always `get`, never `info` / `show` / `describe`
- Always `list`, never `ls`
- Always `create` / `update` / `delete`, never `add` / `set` / `remove` / `rm`
- Always `--force`, never `--skip-confirmations` / `-y` for destructive bypass
- Always `--toon` / `--json` / `--csv`, never `--format=json` / `--output json`
- Always `--limit` for pagination size, `--cursor` for continuation
- Always `--profile` for named configuration
- Always `--dry-run` for preview
- Always `--wait` for synchronous async-completion

The framing Cloudflare used is right: *"manually enforcing consistency through reviews is Swiss cheese."* Vocabulary consistency has to be enforced mechanically — at the codegen layer, the schema layer, or a CI lint — because human review will let edge cases through.

**What good looks like:**
- A documented naming policy committed to the repo (single page, prominently linked)
- A static check in CI that fails on banned verbs and flag aliases
- Canonical names matching the dominant convention in the language community

> **Blocker:** verbs/flags contradicting universal conventions (`info` for `get`, `--skip-confirmations` for `--force`). **Friction:** internal inconsistency between subcommands. **Target:** schema-enforced vocabulary an agent trained on neighboring CLIs recognizes on first encounter.

### 7. Three-layer introspection

The classic principle was "progressive help discovery": top-level `--help` lists commands, subcommand `--help` shows usage. That's still true — and it's now the *bottom* layer of a three-layer stack. Each layer answers a different question.

```bash
# Layer 1 — what does this command do? (human-shaped text)
$ aicli --help
aicli  Manage DNS zones, records, and async operations.

USAGE: aicli <command> [flags]

COMMANDS:
  zone      Manage zones
  record    Manage DNS records
  jobs      Inspect async jobs (zone imports, scans, DNSSEC ops)
  profile   Manage saved configurations
  feedback  Send feedback upstream

# Layer 2 — what's the shape of everything? (structured, versioned)
$ aicli agent-context | jq '.schema_version, (.commands | keys)'
"1"
["feedback","jobs","profile","record","zone"]

$ aicli agent-context | jq '.commands.record.subcommands.create.flags'
{
  "--type":      {"type":"enum","values":["A","AAAA","CNAME","MX","TXT","NS","SRV","CAA"],"required":true},
  "--name":      {"type":"string","required":true},
  "--content":   {"type":"string","required":true},
  "--ttl":       {"type":"int","default":3600},
  "--proxied":   {"type":"bool","default":false},
  "--idempotency-key": {"type":"string"},
  "--toon":      {"type":"bool","default":true},
  "--json":      {"type":"bool","default":false},
  "--csv":       {"type":"bool","default":false},
  "--dry-run":   {"type":"bool","default":false}
}

# Layer 3 — when would I use this? (long-form skill manifest)
$ cat $(aicli skill-path)/SKILL.md
# Common DNS workflows
1. Save a profile for your default zone and credentials.
2. Create records with --idempotency-key derived from (zone,type,name) so retries are safe.
3. For bulk imports, use `aicli zone import --file=zone.txt --wait` and inspect via `aicli jobs list`.
```

- **Layer 1 — `--help`.** Necessary because some agents hit it before anything else, and humans dropping into the terminal need it.
- **Layer 2 — `agent-context`.** What an introspecting agent should actually consume: versioned, machine-readable JSON describing the full shape. Cloudflare's `/cdn-cgi/explorer/api` is the runtime version of this idea; the equivalent for a CLI is a top-level subcommand. The `schema_version` field matters — the consuming agent can detect breaking shape changes deterministically.
- **Layer 3 — skill manifest.** Long-form prose teaching the agent how to compose operations into useful workflows. HeyGen ships a skills repo of `SKILL.md` files alongside their CLI; Cloudflare's MCP server is the equivalent. A description of the CLI from the perspective of the *tasks* an agent might use it for, not the commands it exposes.

**What good looks like:** all three layers present, each versioned, each kept in sync with the implementation by the same generation step.

> **Blocker:** only `--help`, nothing structured. **Friction:** `agent-context` exists but isn't versioned, or skill manifests drift from the real command surface. **Target:** three layers, schema-versioned, machine-validated against the real implementation.

### 8. Async-aware execution

Most CLIs treat async APIs the way the underlying HTTP endpoint does: submit returns a job ID, poll returns a status, that's the agent's problem. Two failure modes follow. Either the agent writes its own poll loop (wastes tokens, gets it subtly wrong), or it doesn't, and the workflow fails because the result wasn't ready when the next step ran.

The fix is `--wait`.

```bash
# Without --wait — agent has to write its own polling loop
$ aicli zone import --file=example.com.zone
job_id: job_5fa2e0
status: queued

$ aicli jobs get job_5fa2e0
job_id: job_5fa2e0
status: running
progress: 0.34

$ aicli jobs get job_5fa2e0
job_id: job_5fa2e0
status: complete
records_imported: 142

# With --wait — same workflow, one command, no polling logic
$ aicli zone import --file=example.com.zone --wait
job_id: job_5fa2e0
status: complete
records_imported: 142

# The job ledger survives across invocations
$ aicli jobs list
JOB_ID      STATUS    KIND          STARTED              DURATION
job_5fa2e0  complete  zone.import   2026-05-08T18:22:11  37s
job_7c1422  running   zone.scan     2026-05-08T18:24:02  12s
```

`--wait` blocks until completion. Behind it, the CLI runs a poll loop with exponential backoff and jitter, and writes job state to a local ledger. A `jobs` subcommand exposes the ledger: `jobs list`, `jobs get <id>`, `jobs prune`.

This collapses several agent turns into one — same workflow, fewer tokens, no polling logic the agent has to get right. The job ledger is what makes retries safe (Principle 4): if the agent's `--wait` invocation gets killed mid-poll, the next invocation finds the existing job rather than submitting a new one.

**What good looks like:**
- `--wait` on every submitting command that wraps an async API
- Polling implementation with exponential backoff and jitter (don't hammer the upstream)
- Persistent job ledger (`~/.aicli/jobs.jsonl` is fine — append-only, easy to inspect)
- A `jobs` parent command exposing `list` / `get` / `prune`
- Idempotency keys propagated into the ledger so resubmissions resolve to existing jobs

> **Blocker:** async commands return a job ID and stop, forcing the agent to write its own poll loop. **Friction:** `--wait` exists but doesn't survive disconnect, or no way to inspect in-flight jobs. **Target:** `--wait` on every async submission with a durable, recoverable ledger.

### 9. Persistent identity through profiles

Agents don't show up once. They show up tomorrow, and the day after, and a week from now, in a different shell, with the same underlying intent and a different specific input. Stateless leaf-shaped CLIs make every invocation re-specify the same eight flags.

The fix is a profile system.

```bash
# Save a named bundle of configuration once
$ aicli profile save prod \
    --zone=example.com \
    --account=acct_9c2b \
    --default-ttl=300
profile_saved: prod

# Reuse on every subsequent invocation
$ aicli record create --profile=prod --type=A --name=api --content=192.0.2.20
id: rec_d44a01
using_profile: prod
zone: example.com

# Explicit flags win over profile values
$ aicli record create --profile=prod --zone=staging.example.com \
    --type=A --name=api --content=10.0.0.20
id: rec_e51b08
using_profile: prod
zone: staging.example.com   # explicit flag overrode the profile's zone

# Surfaced through introspection so agents discover available identities
$ aicli agent-context | jq '.available_profiles'
["prod","staging","sandbox"]
```

**Recommended precedence:** explicit flag > environment variable > profile > built-in default. Surfacing available profile names in `agent-context` is what lets an introspecting agent discover which identities exist without parsing a config file by hand.

Once an agent has a profile, the per-invocation flag burden drops to just the parts that actually vary. Cross-session identity is durable without the agent writing its own state file. The human and the agent share the same configuration vocabulary.

**What good looks like:**
- `profile save` / `use` / `list` / `show` / `delete` subcommands
- `--profile <name>` as a persistent root flag
- Profile contents enumerated in `agent-context`
- Stable storage location (`~/.aicli/profiles.json` or `~/.config/aicli/profiles.json`)

> **Blocker:** no way to persist configuration. **Friction:** profiles exist but aren't discoverable via introspection. **Target:** named profiles with clean precedence, surfaced through `agent-context`.

### 10. Two-way I/O

The classic principle covered stdin/stdout pipelining and that's still true. But agents don't only consume CLIs through pipes, and the CLI doesn't only emit through stdout. Two new mechanisms matter: a way for the CLI to put artifacts where the agent actually needs them, and a way for the agent to report friction back.

```bash
# --deliver routes the artifact to where it's actually needed
$ aicli zone export --zone=example.com --deliver=stdout
zone: example.com
records[142]:
  ...

$ aicli zone export --zone=example.com --deliver=file:./example.com.zone
delivered_to: file:./example.com.zone
bytes: 18432

$ aicli zone export --zone=example.com \
    --deliver=webhook:https://ops.example.com/zone-export
delivered_to: webhook:https://ops.example.com/zone-export
status: 201

# Unknown schemes get a structured refusal naming what's supported
$ aicli zone export --zone=example.com --deliver=s3:bucket/key
error: --deliver scheme must be one of: stdout, file:<path>, webhook:<url> (got: "s3:...")

# feedback closes the loop in the other direction
$ aicli feedback "the --proxied flag is rejected for TXT records but the docs imply it's universal"
feedback_recorded: local (1 entry)

$ aicli feedback list
2026-05-08T18:31:02  the --proxied flag is rejected for TXT records but the docs imply it's universal

# Optional upstream POST when configured
$ AICLI_FEEDBACK_ENDPOINT=https://maintainers.example.com/cli-feedback \
    aicli feedback "race condition in --wait when zone import completes during the first poll"
feedback_recorded: local + upstream
upstream_status: 200
```

`--deliver` routes the artifact directly: stdout, a file path, or a webhook URL. A zone export landing as a file at a known path, or POSTing to a webhook the agent already set up, is one fewer hop than "stdout to a temp file then move." File sinks should write atomically (write-and-rename) so a partial file is never observed. Webhook sinks POST and surface HTTP status. Unknown schemes return a structured refusal — same pattern as Principle 3's enumerated errors.

`feedback` runs the other way. Agents hit friction constantly: flags rejected for the wrong reason, race conditions in async paths, error messages that don't enumerate. Most of it never gets reported because there's no channel — the agent retries, eventually succeeds, the maintainer never learns the call was painful. `aicli feedback "..."` writes locally by default (JSONL is fine); with `AICLI_FEEDBACK_ENDPOINT` configured, the entry POSTs upstream too.

**What good looks like:**
- `--deliver` with `stdout` / `file:<path>` / `webhook:<url>` sinks; structured refusal on unknown schemes
- File sinks: write atomically (temp file + rename)
- Webhook sinks: POST and return HTTP status; don't swallow it
- `feedback <text>` with local JSONL by default, upstream POST when an endpoint is configured
- Both `--deliver` and `feedback` surfaced in `agent-context` so the agent knows the channels exist

> **Blocker:** stdout-only output, no feedback channel. **Friction:** sinks exist but aren't atomic; feedback exists but the upstream channel isn't discoverable. **Target:** structured delivery and discoverable feedback, both versioned in introspection.

---

## On output formats: TOON, JSON, CSV

The convention this skill recommends is `--toon` (default), `--json`, `--csv` — three first-class flags, one canonical name each, applied uniformly across every data-returning command.

| Format | When to default to it | Why |
|---|---|---|
| **TOON** | Agent / LLM consumers | Indentation-based, no quote noise, materially fewer tokens than JSON for typical record/list shapes. The format is designed for LLM context efficiency. |
| **JSON** | Tooling consumers (jq, scripts, other CLIs) | Universally parsed; the path of least surprise for non-LLM automation. |
| **CSV** | Tabular data, spreadsheets, dataframes | Frictionless handoff to Excel / pandas / dbt. Only makes sense for flat tabular outputs. |

The principle from Tier 1 still stands: **pick one canonical flag per format and apply it uniformly**. Don't ship `--toon` on some commands and `--format=toon` on others. Don't add `-j` as an alias "for convenience." Inconsistency at this layer is its own category of brokenness.

For nested objects, TOON and JSON both work; CSV doesn't and shouldn't be supported on commands whose output isn't naturally tabular. When CSV isn't supported, return a clean enumerated error: `error: --csv is only supported for list-style commands; this command returns a nested object. Use --toon (default) or --json.`

TOON spec: https://github.com/johannschopplich/toon

---

## The architecture beneath these principles

Most of Tier 2 is hard to apply by hand and easy to apply mechanically. Cross-CLI vocabulary, three-layer introspection, async detection, profile precedence, delivery routing — every one of them is the kind of thing you'd be inconsistent about across a dozen subcommands if you wrote them by hand, and trivially consistent about if a schema or codegen pipeline writes them.

That's why Cloudflare's TypeScript schema is the load-bearing detail of their post, not a side note. Generating the CLI, the SDKs, the Terraform provider, and the MCP server from one source is what makes ten principles hold across thousands of operations without drift.

If you're maintaining a hand-written CLI of any size, the consistency bar will keep rising, and the only way to keep up is to move enforcement out of code review and into the schema or the build. Concretely:

- A canonical schema (TypeScript, Protobuf, OpenAPI, JSONSchema — whichever your stack speaks) describing every command, subcommand, flag, type, enum, and return shape
- Codegen for: the CLI itself, the `agent-context` output, the help text, the MCP server (if applicable), and the test fixtures
- A CI lint that enforces the vocabulary policy (banned verbs, flag aliases, missing `--toon`/`--json`/`--csv` triplets, missing `--dry-run` on mutating commands, missing `--wait` on async commands)
- A token budget per MCP tool description, checked at build time

You can deliver Tier 1 by hand if the surface is small. Tier 2 lands cleanly only if it's mechanically generated, because the cost of inconsistency scales with the number of operations.

---

## Quick checklist when designing or reviewing

Run a CLI design through this list. If any answer is "no," figure out whether you're shipping a blocker, friction, or already at target.

**Tier 1 — Table stakes**
- [ ] Every command runs without prompting given `--force` / `--yes` (no silent hangs)
- [ ] Every data-returning command supports `--toon`, `--json`, `--csv` uniformly
- [ ] stdout = results, stderr = diagnostics, exit codes follow a documented taxonomy
- [ ] Errors enumerate valid values when the cause is enum-shaped
- [ ] Mutations are idempotent (key or natural-key based); `--dry-run` exists on consequential ops
- [ ] List commands paginate by default; truncation messages name the narrowing flag

**Tier 2 — Compounding**
- [ ] Verbs and flags match the cross-CLI convention (`get`/`list`/`create`/`update`/`delete`, `--force`, `--toon`/`--json`/`--csv`, `--limit`, `--cursor`, `--profile`, `--dry-run`, `--wait`)
- [ ] All three introspection layers exist: `--help`, `agent-context` (versioned), skill manifest
- [ ] Every async-wrapping command has `--wait` plus a durable job ledger and `jobs list`/`get`/`prune`
- [ ] Profiles via `profile save`/`use`/`list`/`show`/`delete`; precedence is explicit > env > profile > default; profiles enumerated in `agent-context`
- [ ] `--deliver` supports `stdout` / `file:` / `webhook:`; `feedback <text>` writes locally and optionally upstream

**Architecture**
- [ ] One canonical schema source generates CLI, `agent-context`, help, MCP, fixtures
- [ ] CI lint enforces vocabulary, format triplets, `--dry-run` / `--wait` coverage, MCP token budgets

---

## References

- Cloudflare — *Why we built Code Mode and what it means for agents using APIs* (schema-driven CLI / SDK / Terraform / MCP generation): https://blog.cloudflare.com/code-mode/
- HeyGen — agent-first CLI launch: https://heygen.com/blog
- TOON (Token-Oriented Object Notation): https://github.com/johannschopplich/toon
- Classic *Command Line Interface Guidelines* (the human-first reference these principles depart from): https://clig.dev/
