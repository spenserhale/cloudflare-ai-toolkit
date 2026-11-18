# @cloudflare-ai-toolkit/sdk

Typed SDK for the Cloudflare API — shared foundation for the CLI and MCP server.

## Install

```bash
npm install @cloudflare-ai-toolkit/sdk
```

Requires Node 20+.

## Usage

```ts
import { CloudflareClient } from "@cloudflare-ai-toolkit/sdk";

const cf = new CloudflareClient({
  auth: { type: "apiToken", token: process.env.CLOUDFLARE_API_TOKEN! },
});

const records = await cf.listDnsRecords("<zone-id>");
```

### Find a zone

```ts
// Exact name match (the API default).
const { zones } = await cf.listZones({ name: "example.com" });

// Partial search — Cloudflare refines the filter with an operator prefix.
const matches = await cf.listZones({ name: "exam", nameOperator: "contains" });

const zone = await cf.getZone("<zone-id>"); // omit to use CLOUDFLARE_ZONE_ID
```

### Zone custom (vanity) nameservers

Names must be subdomains of the zone, and the zone must be on a Business or
Enterprise plan. Writes need a `Zone Write` token.

```ts
const current = await cf.getZoneVanityNameServers("<zone-id>");
// -> { zoneId, zoneName, enabled, nameServers, ips, assignedNameServers }

// Replaces the whole list; `ips` carries the glue addresses Cloudflare assigns.
await cf.setZoneVanityNameServers(
  ["ns1.example.com", "ns2.example.com"],
  "<zone-id>"
);

// Removes them plus the read-only A/AAAA records Cloudflare created.
await cf.clearZoneVanityNameServers("<zone-id>");
```

### Custom hostnames (SSL for SaaS)

```ts
const { hostnames } = await cf.listCustomHostnames(
  { hostname: "app.example.com" },
  "<zone-id>" // omit to use CLOUDFLARE_ZONE_ID
);

const hostname = await cf.getCustomHostname("<custom-hostname-id>");

// `status` tracks hostname activation, `ssl.status` tracks certificate issuance.
// Both must be "active" before the hostname serves production traffic.
const ready = hostname.status === "active" && hostname.ssl?.status === "active";

// Lifecycle
await cf.createCustomHostname({
  hostname: "app.example.com",
  ssl: { method: "http", certificate_authority: "google" },
});
await cf.updateCustomHostname("<custom-hostname-id>", {
  custom_origin_server: "origin.example.com",
});
await cf.deleteCustomHostname("<custom-hostname-id>");
```

### Firewall (WAF) rules

`listFirewallRules` and `getFirewallRule` read the Rulesets Engine's
`http_request_firewall_custom` phase. Rules retain native fields and one-based
`order`, plus compatibility `filter.expression` and `paused` (inverse of
`enabled`). Filters and numeric pagination run locally over the full entrypoint.
The result identifies scope, phase, ruleset and explicit phase absence.

The write methods below still target the **legacy Firewall Rules API**, which
Cloudflare has retired. They are not modern Rulesets mutations; do not use a
Rulesets read ID with these methods. Inventory never calls them.

```ts
const { rules } = await cf.listFirewallRules({ action: "block" });
const rule = await cf.getFirewallRule("<rule-id>");

await cf.createFirewallRule({
  expression: 'ip.src.country eq "CN"',
  action: "managed_challenge",
  description: "Challenge CN",
  paused: true, // stage without enforcing
});

// PUT: action + expression required on every update.
await cf.updateFirewallRule("<rule-id>", {
  expression: 'ip.src.country eq "RU"',
  action: "block",
  paused: false,
});

await cf.deleteFirewallRule("<rule-id>");
```

### Read-only configuration inventory

```ts
const target = { scope: "zone" as const, zoneId: "<zone-id>" };
const page = await cf.inventory.listRulesets(target, { perPage: 50 });
const all = await cf.inventory.listRulesets(target, { all: true });
const phase = await cf.inventory.getPhaseEntrypoint("http_request_origin", target);
const detail = await cf.inventory.getRuleset("<ruleset-id>", target);
const account = { scope: "account" as const, accountId: "<account-id>" };
const managed = await cf.inventory.getRuleset("<managed-ruleset-id>", account, "latest");
const ssl = await cf.inventory.getZoneSetting("ssl", "<zone-id>");
const bots = await cf.inventory.getBotManagement("<zone-id>");
const routes = await cf.inventory.listWorkerRoutes("<zone-id>");
const domains = await cf.inventory.listWorkerDomains({ accountId: "<account-id>", zoneId: "<zone-filter>" });
const pageRules = await cf.inventory.listPageRules("<zone-id>");
const transforms = await cf.inventory.getManagedTransforms("<zone-id>");
const normalization = await cf.inventory.getUrlNormalization("<zone-id>");
const lists = await cf.inventory.listLists(account, { kind: "redirect", all: true });
const namedList = await cf.inventory.listLists(account, { name: "office_ips", kind: "ip" });
const listMetadata = await cf.inventory.getList("<list-id>", account);
const listItems = await cf.inventory.listListItems("<list-id>", account, { all: true });
const matchingItems = await cf.inventory.listListItems("<list-id>", account, { search: "192.0.", perPage: 100 });
```

The reader reuses the client's authentication and validates success envelopes and
resource shapes. Unknown product fields survive, rule-array order and execute
overrides remain intact, and credential-bearing output is redacted. Expressions
reading sensitive headers/query arguments or cookie contents are conservatively
redacted in full so embedded shared credentials cannot leak. Rulesets list
uses cursor pagination (`resultInfo.cursors.after`, `truncated`); details contain
all rules. Only a structured phase-entrypoint not-found 404 becomes
`status: "absent"`, with the original diagnostic. HTML/ambiguous or explicit
entitlement-denied 404s remain errors. A ruleset-ID 404 can mean missing resource or managed entitlement and
remains an error. See the [inventory guide](../../docs/guides/migration-inventory.md).

Account Lists reads require explicit `scope: "account"` and reject a zone ID.
`listLists` filters by exact `name` and `kind` locally before numeric paging:
default `page: 1`, `perPage: 100`, maximum 500. Metadata has no upstream pagination;
`all: true` returns every matching list and cannot be combined with `page > 1`.
Collections include `resultInfo` and `truncated`. An empty filtered result means
no visible match, not that a referenced Managed List is exportable.

`listListItems` reads metadata first, then validates items for the actual `ip`,
`redirect`, `hostname`, or `asn` kind. It preserves item IDs, IPs/comments, redirect
source/target URLs, behavior flags/status, and unknown native fields. Item array
order is retained without inventing evaluation priority. Default page size is 100
(maximum 500); continue with `cursor: resultInfo.cursors.after` or opt into `all`.
`all` with a starting cursor collects only the remaining suffix. `search` uses the
API's IP-prefix, redirect/hostname-substring, and ASN-exact semantics; filtered
and resumed results are subsets, even when `truncated` is false. A complete
unfiltered collection cross-checks the metadata count and fails on inconsistency.
Any item page that advertises more data without a continuation cursor fails,
including bounded reads. Later-page failures never return partial success. These
reads are not an atomic snapshot; retry if concurrent changes cause a mismatch.
Bounded reads fail if a forward cursor is blank or redaction would change it;
retry from the beginning with `all: true` to keep that cursor internal. Resumed
reads do not compare the suffix length to collection-wide totals.
Pages larger than `perPage` and repeated item IDs within/across pages fail, so
duplicate rows cannot satisfy a full-list count while masking missing items.

Known empty lists return their metadata and `items: []`. Missing lists, permission
or entitlement denials, HTTP 410, malformed responses and upstream errors throw
with their diagnostics. URLs with credentials or secret query values are redacted,
including scheme-less Bulk Redirect source URLs. Cloudflare Managed Lists and
built-in datasets are not claimed as accessible through the account Lists API.
URL fields containing legal apostrophes are parsed in full. Ordinary comments
and descriptions preserve bare email addresses unless they match credentials.
Ambiguous compound URL text containing credentials is conservatively masked in
full; compound URLs without credentials remain intact.

### Redirect rules

```ts
// Rules run in order — first match wins. Targets are literal or dynamic.
await cf.createRedirectRule({
  expression: 'http.request.uri.path eq "/old"',
  targetUrl: "https://example.com/new", // or targetExpression for a dynamic URL
  statusCode: 301,
  preserveQueryString: false,
  dryRun: true, // validate without persisting
});

const { rules } = await cf.listRedirectRules();
const rule = await cf.getRedirectRule("<rule-id>");

// Partial update: unspecified fields keep their values; target/status
// changes merge with the current redirect settings.
await cf.updateRedirectRule("<rule-id>", { statusCode: 302 });
await cf.updateRedirectRule("<rule-id>", { enabled: false });

await cf.deleteRedirectRule("<rule-id>");
```

### Log Explorer

```ts
// SQL over logs. Scope defaults to zone (CLOUDFLARE_ZONE_ID), else account.
const { rows } = await cf.queryLogExplorer({
  sql: "SELECT count() FROM http_requests WHERE EdgeStartTimestamp >= now() - INTERVAL '1' DAY",
});

await cf.enableLogExplorerDataset({ dataset: "http_requests" });

// get/update/delete address datasets by dataset_id from listLogExplorerDatasets().
const datasets = await cf.listLogExplorerDatasets({ includeZones: true });
const detail = await cf.getLogExplorerDataset({ datasetId: datasets[0]!.dataset_id });
await cf.updateLogExplorerDataset({
  datasetId: datasets[0]!.dataset_id,
  enabled: false,                          // required on every update
  fields: [{ name: "ClientIP", enabled: true }],
  filter: '{http.request.method=="GET"}',  // "" clears the filter
  deletionProtection: false,
});
await cf.deleteLogExplorerDataset({ datasetId: datasets[0]!.dataset_id });

// Dataset types the account/zone can enable, with schemas and timestamp fields.
const available = await cf.listAvailableLogExplorerDatasets();
```

### Legacy Global API Key auth

```ts
const cf = new CloudflareClient({
  auth: {
    type: "globalApiKey",
    apiKey: process.env.CLOUDFLARE_API_KEY!,
    email: process.env.CLOUDFLARE_EMAIL!,
  },
});
```

### Config from environment and the OS keychain

```ts
import { CloudflareClient, loadConfig } from "@cloudflare-ai-toolkit/sdk";

const cf = new CloudflareClient(await loadConfig());
```

Reads `CLOUDFLARE_API_TOKEN` (preferred), `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_BASE_URL` from
the process environment and the nearest `.env`. Credentials neither supplies are
looked up in the OS keychain (service `cloudflare-ai-toolkit`) through
`Bun.secrets`; under Node the lookup is skipped and reported as `unavailable`.
Precedence is env > `.env` > keychain.

The result also carries `credentialSources` (`env`, `envfile:<path>`,
`keychain`, or `missing` per key, never values) and `keychain.status`
(`ok`, `disabled`, `unavailable`). Pass `secretStore: null` or set
`CLOUDFLARE_KEYCHAIN=0` to skip the keychain, or pass your own `SecretStore`.
`resolveConfig()` is the synchronous variant without the keychain.

## License

MIT — see [LICENSE](./LICENSE).
