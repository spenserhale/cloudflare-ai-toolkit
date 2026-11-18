---
title: "0002: Inventory Rulesets without losing product-specific fields"
description: Preserve scope, evaluation order, and read failures while replacing retired WAF reads.
status: accepted
decision-makers: agent (unattended run)
date: 2026-11-18
---

# 0002: Inventory Rulesets without losing product-specific fields

## Context

The migration inventory fails with HTTP 410 because WAF reads use the retired
Firewall Rules API. The existing Ruleset schema is deliberately redirect-specific.
Reusing it for origin, managed WAF, rate-limit, or transform rules would discard
important action parameters. Inventory also needs explicit account versus zone
scope and must never interpret a failed read as an empty configuration.

## Decision

Expose a read-only `CloudflareClient.inventory` reader using the client's existing
authenticated HTTP transport. Use separate generic schemas that validate known
fields and preserve unknown product fields. Return scope and target identifiers,
retain array order, and add a one-based `order` on rules. Preserve execute targets,
versions, overrides, rate-limit parameters, and origin overrides without resolving
or flattening their semantics. Follow execute references with explicit Rulesets
get commands, using account scope for managed rulesets.

Keep WAF list/get as compatibility adapters over the zone custom-firewall phase.
Retain `filter.expression` and `paused`; add native fields and source metadata.
Filter and paginate locally after reading the full entrypoint. Existing WAF writes
remain legacy and are clearly labeled unsupported on zones where that API retired;
migrating writes is outside this read-only task.

Rulesets list exposes cursor pagination and an explicit `--all` option. Detail
reads return every ordered rule. Only a structured 404 explicitly identifying a
missing phase or entrypoint is represented as
`status: absent`, according to the documented endpoint contract; a ruleset-ID 404
remains an error because it can also mean missing managed-ruleset entitlement.
Preserve upstream codes, request paths, and failures. Redact credential-bearing
fields, header values, and credentials in URLs before output.
Conservatively redact entire expressions reading sensitive headers/query
arguments or cookie contents: comparison literals can embed shared credentials.
Do not try to rewrite literals without a rules-language parser.

## Alternatives

- Reuse redirect schemas: smaller change, but silently loses settings needed for
  migration and cannot model execute/skip/origin actions safely.
- Build a migration-specific all-in-one command: convenient, but duplicates working
  DNS/redirect readers and hides which request failed. Small composable readers
  preserve existing conventions and allow per-capability evidence.

## Consequences

The SDK adds an inventory namespace rather than enlarging the already large
client with every product-specific method. Read-only additions do not mutate
Cloudflare configuration. New inventory commands return JSON with explicit
scope; existing DNS and redirect formats remain unchanged. A successful read is
evidence of visible configuration, not proof of cross-plan feature parity.
