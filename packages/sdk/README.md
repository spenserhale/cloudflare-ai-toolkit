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

### Worker implementation inventory

Reuse `listWorkerRoutes(zoneId)` and `listWorkerDomains({accountId, zoneId})` to
find assignments. Worker implementation reads require account scope:

```ts
const target = { accountId: "<account-id>", script: "assigned-worker" };
const settings = await cf.inventory.getWorkerSettings(target);
const original = await cf.inventory.getWorkerSource(target); // safe hashes, not code
const deployments = await cf.inventory.listWorkerDeployments(target, { page: 1, perPage: 20 });
const versions = await cf.inventory.listWorkerVersions(target, { page: 1, perPage: 20 });

// Use a deployment's version_id to inspect the implementation serving traffic.
// "latest" instead means the most recently created version, possibly undeployed.
const implementation = await cf.inventory.getWorkerVersion(target, "<version-id>");
// Explicit private local export; parent directory must exist, destination must not.
const exported = await cf.inventory.getWorkerVersion(target, "<version-id>", {
  outDir: "/private/local/path/new-worker-inspection",
});
```

Targets also accept `{accountId, service: domain.service, environment:
domain.environment}`. The documented production domain service resolves literally
to that Worker name and preserves service/environment identity. Nonproduction
legacy service environments fail with `UNSUPPORTED_WORKER_ENVIRONMENT`; no name
suffix or endpoint is inferred. For modern environments use the actual assigned
Worker name. Configured account ID can fill an omitted `accountId`; a zone ID
never supplies account scope.

These methods only issue authenticated GET requests and reject redirects. Settings
use `/workers/scripts/{script}/settings`; original downloads use the raw script
endpoint. Original code and current settings are separate unpinned observations.
Pinned modules/bindings use the documented Beta Worker version endpoint with
`include=modules`; Beta availability is a limitation and failures are not empty
inventory. Deployment history preserves version IDs and traffic percentages; its
first item on page 1 is the currently serving deployment. Upload ordering in
`versions` does not establish deployment state.

Lists return one page with `resultInfo`, `truncated` and `nextPage`. Follow
`nextPage` until null; without totals a full page conservatively exposes another
page. Page size defaults to 20 and accepts 1–100. Malformed or contradictory
responses, denied/missing/retired resources and upstream errors remain failures.
Contradictory pagination totals are malformed responses, never completeness evidence.

Worker results project selected runtime settings and binding resource references
rather than preserving arbitrary server fields. Binding names/types, KV/D1/R2
identifiers, service and Durable Object targets, queues, Hyperdrive, Vectorize,
dispatch/workflow and Secrets Store references survive. Plain-text, JSON, secret
and key material always becomes `value: "[REDACTED]"`, even with an innocuous name.
Unknown binding kinds retain name/type and `detailsStatus: "unavailable"`.
An explicit empty binding array is `bindings: []`, `bindingsStatus: "present"`;
omitted bindings are null/unavailable. Missing requested modules similarly return
`source: null`, `sourceStatus: "unavailable"`; requesting export then fails with
`SOURCE_UNAVAILABLE`. An unavailable API response never establishes empty code.

Source results contain only module names, media types, byte lengths and SHA-256
hashes. Original JavaScript and defensively recognized multipart downloads are
supported; Beta modules preserve their exact decoded bytes. Source export creates
0700 directories and 0600 numbered module files plus a mapping manifest. Existing
or symlinked destinations are refused. Source files can contain inline credentials:
inspect privately, never print them to agents, logs, chat or PR artifacts. Export
does not produce a deployment archive or write to Cloudflare. Inspection limits
are 20 MiB source, 500 modules, 1,000 bindings and 1 MiB returned metadata; exceeding
them fails rather than silently truncating. Upstream error text and preview URLs
are withheld because they may contain credentials; HTTP status, numeric API code
and request identity remain available through `describeError`.
Source bodies are consumed once; oversized or unsupported streams fail without
waiting on an unread cloned response, including in Node JS builds.

See the [inventory guide](../../docs/guides/migration-inventory.md) for the
assignment-to-version workflow, official contracts and unsupported cases.

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
