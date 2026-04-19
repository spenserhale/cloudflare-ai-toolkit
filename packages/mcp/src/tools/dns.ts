import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

export function registerDnsTools(server: FastMCP) {
  server.addTool({
    name: "list_dns_records",
    description: "List DNS records for a Cloudflare zone",
    parameters: z.object({
      zoneId: z.string().describe("Cloudflare zone ID"),
      type: z.string().optional().describe("Filter by record type"),
      name: z.string().optional().describe("Filter by record name"),
      content: z.string().optional().describe("Filter by record content"),
      proxied: z.boolean().optional().describe("Filter by proxy status"),
      search: z.string().optional().describe("Search DNS records"),
      order: z
        .enum(["type", "name", "content", "ttl", "proxied"])
        .optional()
        .describe("Order by field"),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
      match: z.enum(["all", "any"]).optional().describe("Filter match mode"),
      page: z.number().int().positive().optional().describe("Page number"),
      perPage: z.number().int().positive().max(5000000).optional().describe("Items per page"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listDnsRecords(args.zoneId, {
        type: args.type,
        name: args.name,
        content: args.content,
        proxied: args.proxied,
        search: args.search,
        order: args.order,
        direction: args.direction,
        match: args.match,
        page: args.page,
        perPage: args.perPage,
      });

      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "update_dns_record",
    description: "Update a DNS record in a Cloudflare zone",
    parameters: z.object({
      zoneId: z.string().describe("Cloudflare zone ID"),
      recordId: z.string().describe("DNS record ID"),
      type: z.string().optional().describe("New record type"),
      name: z.string().optional().describe("New record name"),
      content: z.string().optional().describe("New record content"),
      ttl: z.number().int().nonnegative().optional().describe("TTL value"),
      proxied: z.boolean().optional().describe("Proxy status"),
      comment: z.string().nullable().optional().describe("Record comment"),
      tags: z.array(z.string()).optional().describe("Record tags"),
    }),
    execute: async (args) => {
      const client = getClient();

      const update = {
        type: args.type,
        name: args.name,
        content: args.content,
        ttl: args.ttl,
        proxied: args.proxied,
        comment: args.comment,
        tags: args.tags,
      };

      const hasAnyUpdate = Object.values(update).some((value) => value !== undefined);
      if (!hasAnyUpdate) {
        throw new Error("At least one field must be provided to update the DNS record.");
      }

      const result = await client.updateDnsRecord(args.zoneId, args.recordId, update);
      return JSON.stringify(result, null, 2);
    },
  });
}
