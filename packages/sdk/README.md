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
