---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add DNS record deletion

- SDK: `CloudflareClient.deleteDnsRecord(zoneId, recordId)` calls
  `DELETE /zones/{zone_id}/dns_records/{dns_record_id}`. A 403 reports the
  required `DNS Write` permission like the other DNS endpoints.
- CLI: `cloudflare dns records delete <zone-id> <record-id>...` deletes one or
  more records. It prompts for confirmation, and refuses to run
  non-interactively unless `--yes` is passed. Records are deleted one at a
  time and the command stops at the first failure, listing the records that
  were already deleted.
- MCP: new `delete_dns_record` tool.
