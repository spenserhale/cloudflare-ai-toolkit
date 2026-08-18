import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

interface SslToolArgs {
  readonly method?: "http" | "txt" | "email";
  readonly wildcard?: boolean;
  readonly certificateAuthority?: "digicert" | "google" | "lets_encrypt" | "ssl_com";
}

function toSslInput(ssl: SslToolArgs | undefined) {
  if (ssl === undefined) return undefined;
  return {
    method: ssl.method,
    wildcard: ssl.wildcard,
    certificate_authority: ssl.certificateAuthority,
    type: "dv" as const,
  };
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

  server.addTool({
    name: "create_custom_hostname",
    description:
      "Create a custom hostname (SSL for SaaS) and request its certificate. Returns the ownership validation records the customer must add.",
    parameters: z.object({
      hostname: z.string().min(1).describe("Fully qualified custom hostname, e.g. app.example.com"),
      customOriginServer: z
        .string()
        .optional()
        .describe("Origin server the hostname proxies to (A/AAAA/CNAME in your zone)"),
      customOriginSni: z.string().optional().describe("SNI sent to the custom origin"),
      customMetadata: z
        .record(z.unknown())
        .optional()
        .describe("Per-hostname metadata key/value pairs"),
      ssl: z
        .object({
          method: z.enum(["http", "txt", "email"]).optional().describe("DCV method; http recommended"),
          wildcard: z.boolean().optional().describe("Request a wildcard certificate"),
          certificateAuthority: z
            .enum(["digicert", "google", "lets_encrypt", "ssl_com"])
            .optional()
            .describe("Certificate authority"),
        })
        .optional()
        .describe("SSL/certificate settings; omit for API defaults"),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.createCustomHostname(
        {
          hostname: args.hostname.trim(),
          custom_origin_server: args.customOriginServer,
          custom_origin_sni: args.customOriginSni,
          custom_metadata: args.customMetadata,
          ssl: toSslInput(args.ssl),
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "update_custom_hostname",
    description:
      "Update a custom hostname's origin, metadata, or SSL config. Resending SSL config with unchanged values retriggers domain control validation.",
    parameters: z.object({
      customHostnameId: z.string().min(1).describe("Custom hostname ID"),
      customOriginServer: z.string().optional().describe("New origin server"),
      customOriginSni: z.string().optional().describe("New SNI for the custom origin"),
      customMetadata: z
        .record(z.unknown())
        .optional()
        .describe("Replace per-hostname metadata"),
      ssl: z
        .object({
          method: z.enum(["http", "txt", "email"]).optional(),
          wildcard: z.boolean().optional(),
          certificateAuthority: z
            .enum(["digicert", "google", "lets_encrypt", "ssl_com"])
            .optional(),
        })
        .optional(),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.updateCustomHostname(
        args.customHostnameId,
        {
          custom_origin_server: args.customOriginServer,
          custom_origin_sni: args.customOriginSni,
          custom_metadata: args.customMetadata,
          ssl: toSslInput(args.ssl),
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "delete_custom_hostname",
    description:
      "Delete a custom hostname and its certificate. Destructive: the customer's traffic stops passing through Cloudflare for this hostname.",
    parameters: z.object({
      customHostnameId: z.string().min(1).describe("Custom hostname ID"),
      zoneId: z.string().optional().describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID"),
    }),
    execute: async (args) => {
      const client = getClient();
      await client.deleteCustomHostname(args.customHostnameId, args.zoneId);
      return JSON.stringify({ deleted: true, id: args.customHostnameId }, null, 2);
    },
  });
}
