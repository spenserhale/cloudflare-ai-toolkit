import type { FastMCP } from "fastmcp";
import { z } from "zod";
import {
  CloudflareClient,
  resolveConfig,
  TunnelStatusSchema,
} from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

/** Registers the read-only `list_tunnels` and `get_tunnel` tools. */
export function registerTunnelTools(server: FastMCP) {
  server.addTool({
    name: "list_tunnels",
    description:
      "List Cloudflare Tunnels (cloudflared) in an account with their health status. Use this to resolve a tunnel name to its ID. Requires a 'Cloudflare Tunnel Read' API token.",
    parameters: z.object({
      name: z.string().optional().describe("Filter by exact tunnel name"),
      status: TunnelStatusSchema.optional().describe(
        "Filter by tunnel status (inactive, degraded, healthy, down)"
      ),
      isDeleted: z
        .boolean()
        .optional()
        .describe(
          "true returns only deleted tunnels, false excludes them; omit to include both"
        ),
      page: z.number().int().positive().optional().describe("Page number"),
      perPage: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .optional()
        .describe("Tunnels per page (1-1000)"),
      accountId: z
        .string()
        .optional()
        .describe("Account ID; defaults to CLOUDFLARE_ACCOUNT_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listTunnels(args);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_tunnel",
    description:
      "Get one Cloudflare Tunnel plus its running cloudflared connectors: version, architecture, and the Cloudflare data centers and origin IPs each connector is connected through. An empty connectors list means no cloudflared is running. Requires a 'Cloudflare Tunnel Read' API token.",
    parameters: z.object({
      tunnelId: z.string().describe("Tunnel UUID; use list_tunnels to look one up by name"),
      accountId: z
        .string()
        .optional()
        .describe("Account ID; defaults to CLOUDFLARE_ACCOUNT_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getTunnelInfo(args.tunnelId, args.accountId);
      return JSON.stringify(result, null, 2);
    },
  });
}
