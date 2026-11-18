---
title: "0003: Resolve inventory references with account Lists reads"
description: Add typed, bounded account list inventory while preserving failure and credential contracts.
status: accepted
date: 2026-11-18
decision-makers: agent (unattended run)
---

## Context

[ADR 0002](0002-read-only-migration-inventory.md) exposes Bulk Redirect list and
custom-rule IP-list references, but excludes their contents. Inventory needs
those datasets to compare deployments. The public Lists API is account-scoped;
metadata is unpaginated, while items use cursors and support four kinds.

## Options considered

- A common account Lists reader preserves identity and uses the documented API
  directly. It can resolve both redirect and custom list references.
- Separate redirect/IP command families would duplicate endpoint, error and
  pagination logic and make other documented kinds appear unsupported.
- Raw HTTP recipes would bypass supported CLI validation and redaction.

## Decision

Extend the existing GET-only inventory namespace with `listLists`, `getList`,
and `listListItems`. Require explicit account scope. Validate list identity and
kind before items; preserve unknown native fields. Support `ip`, `redirect`,
`hostname`, and `asn`. Expose `lists list|get` and `lists items list` in the CLI.

Metadata filters and numeric pagination are local; default output is 100 entries,
with explicit truncation and optional all matches. Items default to 100 entries,
allow up to 500 per page, expose opaque cursors and support opt-in collection of
all remaining pages. Search follows the API's kind-specific semantics. Failed or
inconsistent reads never become empty or partial successful inventories.

Keep ADR 0002's credential redaction and error conventions, including URLs whose
source scheme is omitted. Managed/built-in datasets absent from the documented
account Lists API remain unresolved; do not claim their contents are exported.

## Consequences

Each item read costs an additional metadata GET. This ensures empty results have
identity and that missing resources fail before being mistaken for empty lists.
Complete collection can be large and is not an atomic snapshot; concurrent edits
can produce a detectable count mismatch requiring a retry. Redacted output is
for inventory and cannot be used as a write-back payload.

## Revisit when

Cloudflare changes supported kinds or pagination, exposes managed-list contents,
or introduces a consistent snapshot API.

## Links

- [Plan](../plans/2026-11-18-inventory-list-contents.md)
- [Guide](../guides/migration-inventory.md)
- [Metadata](https://developers.cloudflare.com/api/resources/rules/subresources/lists/methods/list/)
- [Detail](https://developers.cloudflare.com/api/resources/rules/subresources/lists/methods/get/)
- [Items](https://developers.cloudflare.com/api/resources/rules/subresources/lists/subresources/items/methods/list/)
