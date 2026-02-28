import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
  CloudflareClient,
  resolveConfig,
  toAuditLogTable,
  type AuditLogListResult,
} from "@cloudflare-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

const outputFormatSchema = z.enum(["json", "toon"]);
type OutputFormat = z.infer<typeof outputFormatSchema>;

function renderAuditLogs(
  result: AuditLogListResult,
  format: OutputFormat
): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return encode(
    {
      ...toAuditLogTable(result.data),
      nextCursor: result.pagination?.cursor ?? null,
    },
    { keyFolding: "safe" }
  );
}

export function registerAuditTools(server: FastMCP) {
  server.addTool({
    name: "list_audit_logs",
    description: "List Cloudflare audit logs with filters for users and actions",
    parameters: z.object({
      accountId: z.string().optional().describe("Cloudflare account ID"),
      since: z.string().describe("Start datetime in ISO-8601 format"),
      before: z.string().describe("End datetime in ISO-8601 format"),
      actorEmail: z.string().optional().describe("Filter by actor email"),
      actorId: z.string().optional().describe("Filter by actor ID"),
      actionType: z.string().optional().describe("Filter by action type"),
      actionResult: z.string().optional().describe("Filter by action result"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().int().positive().max(1000).default(100).describe("Max results to return"),
      direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
      format: outputFormatSchema.default("toon").describe("Output format: toon or json"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listAuditLogs(
        {
          since: args.since,
          before: args.before,
          actorEmail: args.actorEmail,
          actorId: args.actorId,
          actionType: args.actionType,
          actionResult: args.actionResult,
          cursor: args.cursor,
          limit: args.limit,
          direction: args.direction,
        },
        args.accountId
      );

      return renderAuditLogs(result, args.format);
    },
  });
}
