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
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
});

const records = await cf.listDnsRecords("<zone-id>");
```

### Legacy Global API Key auth

```ts
const cf = new CloudflareClient({
  apiKey: process.env.CLOUDFLARE_API_KEY,
  email: process.env.CLOUDFLARE_EMAIL,
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
