import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

const zoneIdParam = z
  .string()
  .optional()
  .describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID");

const redirectActionFields = {
  targetUrl: z
    .string()
    .optional()
    .describe("Literal destination URL (mutually exclusive with targetExpression)"),
  targetExpression: z
    .string()
    .optional()
    .describe("Dynamic expression evaluating to the destination URL"),
  statusCode: z
    .union([z.literal(301), z.literal(302), z.literal(303), z.literal(307), z.literal(308)])
    .optional()
    .describe("Redirect status code (301|302|303|307|308)"),
  preserveQueryString: z
    .boolean()
    .optional()
    .describe("Preserve the original query string"),
};

export function registerRedirectTools(server: FastMCP) {
  server.addTool({
    name: "list_redirect_rules",
    description:
      "List redirect rules in a zone. Rules run in order — the first match wins.",
    parameters: z.object({
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listRedirectRules(args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_redirect_rule",
    description: "Get one redirect rule by ID: expression, target, status code, state.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Redirect rule ID"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getRedirectRule(args.ruleId, args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "create_redirect_rule",
    description:
      "Create a redirect rule from a rules-language expression. Pass targetUrl (fixed destination) or targetExpression (dynamic). Supports dryRun to validate without persisting.",
    parameters: z.object({
      expression: z
        .string()
        .min(1)
        .describe("Rules language expression, e.g. 'http.request.uri.path eq \"/old\"'"),
      ...redirectActionFields,
      description: z.string().optional().describe("Human-readable summary"),
      enabled: z.boolean().optional().describe("Create enabled (default) or disabled"),
      dryRun: z.boolean().optional().describe("Validate without creating"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.createRedirectRule(
        {
          expression: args.expression.trim(),
          targetUrl: args.targetUrl,
          targetExpression: args.targetExpression,
          statusCode: args.statusCode,
          preserveQueryString: args.preserveQueryString,
          description: args.description,
          enabled: args.enabled,
          dryRun: args.dryRun,
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "update_redirect_rule",
    description:
      "Partially update a redirect rule. Unspecified fields keep their values; changing any target/status field merges with the current redirect settings.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Redirect rule ID"),
      expression: z.string().min(1).optional().describe("New match expression"),
      ...redirectActionFields,
      description: z.string().optional().describe("New description"),
      enabled: z.boolean().optional().describe("Enable or disable the rule"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.updateRedirectRule(
        args.ruleId,
        {
          expression: args.expression,
          targetUrl: args.targetUrl,
          targetExpression: args.targetExpression,
          statusCode: args.statusCode,
          preserveQueryString: args.preserveQueryString,
          description: args.description,
          enabled: args.enabled,
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "delete_redirect_rule",
    description: "Delete a redirect rule. Destructive: matched URLs stop redirecting.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Redirect rule ID"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      await client.deleteRedirectRule(args.ruleId, args.zoneId);
      return JSON.stringify({ deleted: true, id: args.ruleId }, null, 2);
    },
  });
}
