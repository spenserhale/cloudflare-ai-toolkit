import type { FastMCP } from "fastmcp";
import { z } from "zod";
import {
  CloudflareClient,
  FirewallRuleActionSchema,
  resolveConfig,
} from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

const zoneIdParam = z
  .string()
  .optional()
  .describe("Zone ID; defaults to CLOUDFLARE_ZONE_ID");

export function registerWafTools(server: FastMCP) {
  server.addTool({
    name: "list_firewall_rules",
    description:
      "List firewall (WAF custom) rules in a zone with their actions, filter expressions, and paused state.",
    parameters: z.object({
      action: FirewallRuleActionSchema.optional().describe("Filter by action"),
      description: z
        .string()
        .optional()
        .describe("Case-insensitive substring of the rule description"),
      paused: z.boolean().optional().describe("Filter by paused state"),
      page: z.number().int().positive().optional().describe("Page number"),
      perPage: z.number().int().min(1).max(100).optional().describe("Rules per page"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listFirewallRules(
        {
          action: args.action,
          description: args.description,
          paused: args.paused,
          page: args.page,
          perPage: args.perPage,
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_firewall_rule",
    description:
      "Get one firewall rule by ID, including its filter expression and priority.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Firewall rule ID"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.getFirewallRule(args.ruleId, args.zoneId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "create_firewall_rule",
    description:
      "Create a firewall (WAF custom) rule from a Cloudflare rules-language filter expression, e.g. 'ip.src.country eq \"CN\"'. Prefer paused=true to stage rules before enforcing them.",
    parameters: z.object({
      expression: z
        .string()
        .min(1)
        .describe("Filter expression (rules language)"),
      action: FirewallRuleActionSchema.describe(
        "Action on match: block, challenge, js_challenge, managed_challenge, allow, log, bypass"
      ),
      description: z.string().optional().describe("Human-readable summary"),
      paused: z.boolean().optional().describe("Create paused so it does not act yet"),
      priority: z.number().int().optional().describe("Lower runs first"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.createFirewallRule(
        {
          expression: args.expression.trim(),
          action: args.action,
          description: args.description,
          paused: args.paused,
          priority: args.priority,
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "update_firewall_rule",
    description:
      "Replace a firewall rule (PUT). Action and expression are required on every update — fetch the current values with get_firewall_rule first and resend unchanged fields.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Firewall rule ID"),
      expression: z.string().min(1).describe("New filter expression"),
      action: FirewallRuleActionSchema.describe("Action on match"),
      description: z.string().optional().describe("New description"),
      paused: z.boolean().optional().describe("Pause or unpause the rule"),
      priority: z.number().int().optional().describe("New priority"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.updateFirewallRule(
        args.ruleId,
        {
          expression: args.expression.trim(),
          action: args.action,
          description: args.description,
          paused: args.paused,
          priority: args.priority,
        },
        args.zoneId
      );
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "delete_firewall_rule",
    description:
      "Delete a firewall rule. Destructive: matched traffic immediately loses the rule's action.",
    parameters: z.object({
      ruleId: z.string().min(1).describe("Firewall rule ID"),
      zoneId: zoneIdParam,
    }),
    execute: async (args) => {
      const client = getClient();
      await client.deleteFirewallRule(args.ruleId, args.zoneId);
      return JSON.stringify({ deleted: true, id: args.ruleId }, null, 2);
    },
  });
}
