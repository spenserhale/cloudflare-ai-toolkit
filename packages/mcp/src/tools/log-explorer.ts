import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
  CloudflareClient,
  LogExplorerScopeSchema,
  resolveConfig,
  type QueryLogExplorerResult,
} from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

const outputFormatSchema = z.enum(["json", "toon"]);
type OutputFormat = z.infer<typeof outputFormatSchema>;

function renderQuery(result: QueryLogExplorerResult, format: OutputFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  return encode({ rows: result.rows }, { keyFolding: "safe" });
}

export function registerLogExplorerTools(server: FastMCP) {
  server.addTool({
    name: "query_log_explorer",
    description:
      "Run a SQL query against Cloudflare Log Explorer. Scope is account-level or zone-level; defaults to zone when CLOUDFLARE_ZONE_ID is set.",
    parameters: z.object({
      sql: z.string().min(1).describe("SQL query to execute"),
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
      format: outputFormatSchema.default("toon").describe("Output format: toon or json"),
    }),
    execute: async (args) => {
      const sql = args.sql.trim();
      if (sql.length === 0) {
        throw new Error("SQL query is empty.");
      }
      const client = getClient();
      const result = await client.queryLogExplorer(
        { sql, scope: args.scope },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return renderQuery(result, args.format);
    },
  });

  server.addTool({
    name: "enable_log_explorer_dataset",
    description:
      "Enable a Log Explorer dataset (e.g. http_requests, gateway_dns) for the account or zone.",
    parameters: z.object({
      dataset: z
        .string()
        .min(1)
        .describe("Dataset name (e.g. http_requests, firewall_events, gateway_dns)"),
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const dataset = args.dataset.trim();
      if (dataset.length === 0) {
        throw new Error("Dataset name is empty.");
      }
      const client = getClient();
      const result = await client.enableLogExplorerDataset(
        { dataset, scope: args.scope },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify(result, null, 2);
    },
  });
}
