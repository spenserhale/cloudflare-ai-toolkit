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

### Config from environment

```ts
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

const cf = new CloudflareClient(resolveConfig());
```

Reads `CLOUDFLARE_API_TOKEN` (preferred), `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, and `CLOUDFLARE_BASE_URL`.

## License

MIT — see [LICENSE](./LICENSE).
