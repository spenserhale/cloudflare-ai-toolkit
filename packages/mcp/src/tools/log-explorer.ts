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

  server.addTool({
    name: "list_log_explorer_datasets",
    description:
      "List configured Log Explorer datasets (IDs, enabled state) for the account or zone.",
    parameters: z.object({
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
      includeZones: z
        .boolean()
        .optional()
        .describe("Include zone-scoped datasets belonging to the account"),
    }),
    execute: async (args) => {
      const client = getClient();
      const datasets = await client.listLogExplorerDatasets(
        { scope: args.scope, includeZones: args.includeZones },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify(datasets, null, 2);
    },
  });

  server.addTool({
    name: "list_available_log_explorer_datasets",
    description:
      "List dataset types the account or zone can enable, with timestamp fields and schemas.",
    parameters: z.object({
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const datasets = await client.listAvailableLogExplorerDatasets(
        { scope: args.scope },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify(datasets, null, 2);
    },
  });

  server.addTool({
    name: "get_log_explorer_dataset",
    description:
      "Get one Log Explorer dataset by ID, including field configuration and filter.",
    parameters: z.object({
      datasetId: z.string().min(1).describe("Dataset ID from list_log_explorer_datasets"),
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const dataset = await client.getLogExplorerDataset(
        { datasetId: args.datasetId, scope: args.scope },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify(dataset, null, 2);
    },
  });

  server.addTool({
    name: "update_log_explorer_dataset",
    description:
      "Update a Log Explorer dataset: enable/disable ingest, restrict fields, set or clear a Logpush filter, or toggle deletion protection.",
    parameters: z.object({
      datasetId: z.string().min(1).describe("Dataset ID from list_log_explorer_datasets"),
      enabled: z.boolean().describe("Whether log ingest stays active"),
      fields: z
        .array(z.object({ name: z.string(), enabled: z.boolean() }))
        .optional()
        .describe("Field allowlist; omitted keeps current fields"),
      filter: z
        .string()
        .optional()
        .describe("Logpush filter predicate; empty string clears it"),
      deletionProtection: z.boolean().optional().describe("Set false to allow deletion"),
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const dataset = await client.updateLogExplorerDataset(
        {
          datasetId: args.datasetId,
          enabled: args.enabled,
          fields: args.fields,
          filter: args.filter,
          deletionProtection: args.deletionProtection,
          scope: args.scope,
        },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify(dataset, null, 2);
    },
  });

  server.addTool({
    name: "delete_log_explorer_dataset",
    description:
      "Delete a Log Explorer dataset, stopping its log ingest. Requires deletion protection to be off.",
    parameters: z.object({
      datasetId: z.string().min(1).describe("Dataset ID from list_log_explorer_datasets"),
      scope: LogExplorerScopeSchema.optional().describe("account or zone"),
      accountId: z.string().optional().describe("Override CLOUDFLARE_ACCOUNT_ID"),
      zoneId: z.string().optional().describe("Override CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      await client.deleteLogExplorerDataset(
        { datasetId: args.datasetId, scope: args.scope },
        { accountId: args.accountId, zoneId: args.zoneId }
      );
      return JSON.stringify({ deleted: true, datasetId: args.datasetId }, null, 2);
    },
  });
}
