import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

export function registerCustomHostnameTools(server: FastMCP) {
  server.addTool({
    name: "list_custom_hostnames",
    description:
      "List custom hostnames (Cloudflare for SaaS / SSL for SaaS) in a zone, including hostname status and certificate status. Filter by hostname to inspect one domain.",
    parameters: z.object({
      hostname: z
        .string()
        .optional()
        .describe("Filter by fully qualified custom hostname, e.g. app.example.com"),
      id: z.string().optional().describe("Filter by custom hostname ID"),
      ssl: z
        .boolean()
        .optional()
        .describe("Filter by whether a certificate is attached"),
      order: z.enum(["ssl", "ssl_status"]).optional().describe("Order by field"),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
      page: z.number().int().positive().optional().describe("Page number"),
      perPage: z
        .number()
        .int()
        .min(5)
        .max(50)
        .optional()
        .describe("Hostnames per page (5-50)"),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listCustomHostnames(
        {
          hostname: args.hostname,
          id: args.id,
          ssl: args.ssl,
          order: args.order,
          direction: args.direction,
          page: args.page,
          perPage: args.perPage,
        },
        args.zoneId
      );

      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_custom_hostname",
    description:
      "Get one custom hostname's certificate and validation state: ssl.status, validation records and errors, and hostname ownership challenges. A hostname is ready for traffic when status and ssl.status are both 'active'.",
    parameters: z.object({
      customHostnameId: z.string().describe("Custom hostname ID"),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getCustomHostname(args.customHostnameId, args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });
}
