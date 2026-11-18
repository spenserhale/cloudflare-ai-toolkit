---
title: "0003: Inspect Worker implementation through private artifacts"
description: Separate safe inventory metadata from potentially sensitive Worker source and reject unsupported environment mappings.
status: accepted
decision-makers: agent (unattended run)
date: 2026-11-18
---

## Context

Route and custom-domain assignments identify Workers but do not describe their
implementation. Worker source, plain-text/JSON bindings, annotations and URLs can
contain credentials. Generic passthrough redaction cannot safely sanitize code.
The current public API documents script settings, original script download,
deployments, version summaries and Beta version modules. It does not document a
legacy service-environment reader.

## Options considered

- Print source or return enumerable raw modules from the SDK: convenient, but
  encourages credentials to enter logs, chat and PR artifacts. Rejected.
- Use undocumented service/environment endpoints or infer suffixed script names:
  risks inspecting a different Worker. Rejected.
- Return projected metadata and optionally export source to private local files:
  preserves implementation without claiming code can be safely redacted. Chosen.

## Decision

Extend `client.inventory` with account-scoped GET-only Worker readers. Accept an
explicit script name, or a domain's literal service name and production environment;
preserve those identities. Reject nonproduction legacy environments before HTTP.
Modern environments use the actual assigned Worker name, never an inferred suffix.

Settings and version inspection preserve binding names/types and documented
resource references. Plain-text, JSON, secret and key material is always hidden,
regardless of binding name. Unknown binding types retain name/type with unavailable
details. Project selected settings and metadata rather than passthrough source,
annotations, descriptions, preview URLs or arbitrary upstream error messages.

Original script downloads are unpinned observations. Read deployment version IDs
and percentages separately. Use the documented Beta version detail with
`include=modules` for pinned implementation and bindings. Do not attach version
identity to an unpinned download. Missing modules/bindings remain unavailable.

Source inspection returns only names, media types, byte lengths and hashes. An
explicit output directory stores original module bytes under generated filenames
and a manifest mapping module names. Directories are new and private (0700), files
0600; existing destinations and unsafe paths are rejected. Source is sensitive,
may contain inline credentials, and must never be attached to PRs or printed by
agents. Limits bound bytes, module count and JSON metadata; exceeding a limit is
an error rather than a successful partial inventory.

Protocol-relative credential-bearing URLs in module identities receive the same
redaction as URLs with explicit schemes; filenames in artifacts remain generated.
Read each source response once, validating its enclosing metadata before export.
Do not clone a response for a second export pass: an unread tee branch can prevent
stream cancellation from settling when the bounded read fails under Node.

## Consequences

The SDK can write local inspection artifacts but never Cloudflare configuration.
Private source is intentionally not credential-free or a deployable archive.
Beta API availability and legacy environments can block inspection. Assignment,
settings, deployments and source are separate observations, not an atomic snapshot.
Metadata redaction sacrifices literal environment values to prevent credential
disclosure. Resource contents and secret values are outside scope.

## Revisit when

Cloudflare publishes a current legacy environment contract or changes its Beta
version response. Recheck the official API reference before extending either.

## Links

- [Inventory ADR](0002-read-only-migration-inventory.md)
- [Worker inspection plan](../plans/2026-11-18-worker-inspection.md)
- [Inventory guide](../guides/migration-inventory.md)
