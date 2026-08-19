---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Read and modify zone custom (vanity) nameservers

Zone custom nameservers (ZCNS) are now a first-class surface across all three
packages, backed by `PATCH /zones/{zone_id}` with `vanity_name_servers`.

- SDK: `getZoneVanityNameServers`, `setZoneVanityNameServers`, and
  `clearZoneVanityNameServers` return a focused result carrying the configured
  names, the IPv4/IPv6 glue addresses Cloudflare assigned to them, and the
  Cloudflare nameservers they replace. `PATCH /zones/{zone_id}` now reports the
  `Zone Write` permission hint on failure.
- CLI: `cloudflare zones vanity-ns get|set|clear`. `set` validates the names
  against the zone before spending a request, and both writes confirm before
  changing authoritative DNS. `zones get` gained a `Vanity NS` line.
- MCP: `get_zone_vanity_nameservers`, `set_zone_vanity_nameservers`, and
  `clear_zone_vanity_nameservers`.
