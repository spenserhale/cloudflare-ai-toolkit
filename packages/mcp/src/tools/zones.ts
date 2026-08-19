import type { FastMCP } from "fastmcp";
import { z } from "zod";
import {
  CloudflareClient,
  resolveConfig,
  ZoneNameFilterOperatorSchema,
  ZoneStatusSchema,
  ZoneTypeSchema,
} from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

export function registerZoneTools(server: FastMCP) {
  server.addTool({
    name: "list_zones",
    description:
      "List, search, and filter Cloudflare zones. Use this to resolve a domain name to a zone ID before calling zone-scoped tools.",
    parameters: z.object({
      name: z
        .string()
        .optional()
        .describe("Domain name to filter by; exact match unless nameOperator is set"),
      nameOperator: ZoneNameFilterOperatorSchema.optional().describe(
        "How to match name (equal, contains, starts_with, ends_with, ...); defaults to equal"
      ),
      accountId: z.string().optional().describe("Filter by account ID"),
      accountName: z.string().optional().describe("Filter by account name"),
      accountNameOperator: ZoneNameFilterOperatorSchema.optional().describe(
        "How to match accountName; defaults to equal"
      ),
      status: ZoneStatusSchema.optional().describe(
        "Filter by zone status (initializing, pending, active, moved)"
      ),
      type: z
        .array(ZoneTypeSchema)
        .nonempty()
        .optional()
        .describe("Zone types to include (full, partial, secondary, internal)"),
      match: z.enum(["all", "any"]).optional().describe("Match all filters or any"),
      order: z
        .enum(["name", "status", "account.id", "account.name", "plan.id"])
        .optional()
        .describe("Order by field"),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
      page: z.number().int().positive().optional().describe("Page number"),
      perPage: z.number().int().min(5).max(50).optional().describe("Zones per page (5-50)"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listZones({
        name: args.name,
        nameOperator: args.nameOperator,
        accountId: args.accountId,
        accountName: args.accountName,
        accountNameOperator: args.accountNameOperator,
        status: args.status,
        type: args.type,
        match: args.match,
        order: args.order,
        direction: args.direction,
        page: args.page,
        perPage: args.perPage,
      });

      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_zone",
    description:
      "Get details for one Cloudflare zone (status, type, plan, nameservers). Defaults to CLOUDFLARE_ZONE_ID.",
    parameters: z.object({
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getZone(args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_zone_vanity_nameservers",
    description:
      "Read a zone's custom (vanity) nameservers, the glue-record addresses Cloudflare assigned to them, and the Cloudflare nameservers they replace. Defaults to CLOUDFLARE_ZONE_ID.",
    parameters: z.object({
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getZoneVanityNameServers(args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "set_zone_vanity_nameservers",
    description:
      "Replace a zone's custom (vanity) nameservers. Every name must be a subdomain of the zone itself (ns1.example.com for zone example.com), and the zone must be on a Business or Enterprise plan. This changes authoritative DNS: resolution breaks until the same nameservers and their glue records are set at the registrar. Requires a 'Zone Write' API token.",
    parameters: z.object({
      nameServers: z
        .array(z.string())
        .nonempty()
        .describe(
          "Fully qualified nameserver names, each a subdomain of the zone. To remove them, use clear_zone_vanity_nameservers."
        ),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.setZoneVanityNameServers(
        args.nameServers,
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "clear_zone_vanity_nameservers",
    description:
      "Remove a zone's custom (vanity) nameservers and the read-only A/AAAA records Cloudflare created for them. The zone falls back to its assigned Cloudflare nameservers, which must then be set at the registrar. Requires a 'Zone Write' API token.",
    parameters: z.object({
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.clearZoneVanityNameServers(args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });
}
