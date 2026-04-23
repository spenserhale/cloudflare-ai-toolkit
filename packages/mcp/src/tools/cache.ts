import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

export function registerCacheTools(server: FastMCP) {
  server.addTool({
    name: "purge_cache_by_prefixes",
    description:
      "Purge cached content from a Cloudflare zone by URL prefix(es). " +
      "Zone ID falls back to the CLOUDFLARE_ZONE_ID environment variable if omitted.",
    parameters: z.object({
      zoneId: z
        .string()
        .optional()
        .describe("Cloudflare zone ID (defaults to CLOUDFLARE_ZONE_ID env var)"),
      prefixes: z
        .array(z.string())
        .min(1)
        .describe("URL prefix(es) to purge, e.g. example.com/assets"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.purgeCacheByPrefixes(
        [...args.prefixes],
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "purge_cache_by_tags",
    description:
      "Purge cached content from a Cloudflare zone by cache tag(s). " +
      "Zone ID falls back to the CLOUDFLARE_ZONE_ID environment variable if omitted.",
    parameters: z.object({
      zoneId: z
        .string()
        .optional()
        .describe("Cloudflare zone ID (defaults to CLOUDFLARE_ZONE_ID env var)"),
      tags: z
        .array(z.string())
        .min(1)
        .describe("Cache tag(s) to purge"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.purgeCacheByTags(
        [...args.tags],
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });
}
