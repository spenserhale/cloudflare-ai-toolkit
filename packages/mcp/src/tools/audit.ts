import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
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

      return JSON.stringify(result, null, 2);
    },
  });
}
