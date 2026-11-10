import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, loadConfig } from "@cloudflare-ai-toolkit/sdk";
import { ADDITIVE_WRITE, DESTRUCTIVE_WRITE, READ_ONLY } from "./annotations.js";

/** Reads env, .env, and the OS keychain on every call, so rotated keys apply without a restart. */
async function getClient(): Promise<CloudflareClient> {
  return new CloudflareClient(await loadConfig());
}

export function registerResourceTools(server: FastMCP) {
  server.addTool({
    name: "list_resources",
    annotations: READ_ONLY,
    description: "List Cloudflare resources with pagination",
    parameters: z.object({
      page: z.number().int().positive().default(1).describe("Page number"),
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .default(20)
        .describe("Items per page"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const result = await client.listResources({
        page: args.page,
        limit: args.limit,
      });

      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_resource",
    annotations: READ_ONLY,
    description: "Get a Cloudflare resource by its ID",
    parameters: z.object({
      id: z.string().describe("The resource ID"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const resource = await client.getResource(args.id);
      return JSON.stringify(resource, null, 2);
    },
  });

  server.addTool({
    name: "create_resource",
    annotations: ADDITIVE_WRITE,
    description: "Create a new Cloudflare resource",
    parameters: z.object({
      name: z.string().min(1).describe("Name for the new resource"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const resource = await client.createResource({ name: args.name });
      return JSON.stringify(resource, null, 2);
    },
  });

  server.addTool({
    name: "delete_resource",
    annotations: DESTRUCTIVE_WRITE,
    description: "Delete a Cloudflare resource by its ID",
    parameters: z.object({
      id: z.string().describe("The resource ID to delete"),
    }),
    execute: async (args) => {
      const client = await getClient();
      await client.deleteResource(args.id);
      return `Successfully deleted resource ${args.id}`;
    },
  });
}
