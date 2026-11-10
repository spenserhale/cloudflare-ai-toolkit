import type { FastMCP } from "fastmcp";
import { z } from "zod";
import {
  checkTokenPermissions,
  CloudflareClient,
  loadConfig,
  suggestPermissionNames,
} from "@cloudflare-ai-toolkit/sdk";
import { READ_ONLY } from "./annotations.js";

/** Reads env, .env, and the OS keychain on every call, so rotated keys apply without a restart. */
async function getClient(): Promise<CloudflareClient> {
  return new CloudflareClient(await loadConfig());
}

export function registerTokenTools(server: FastMCP) {
  server.addTool({
    name: "get_credential_status",
    annotations: READ_ONLY,
    description:
      "Report which credentials the server will use and where each one comes from (env, envfile:<path>, keychain, or missing), plus whether the OS keychain could be read. Never returns credential values and makes no Cloudflare API call. Use it to tell 'no credentials configured' apart from 'credentials rejected'. Credentials are managed outside MCP with the CLI: `cloudflare auth set api-token`.",
    parameters: z.object({}),
    execute: async () => {
      const config = await loadConfig();
      const configured =
        config.auth.type === "apiToken"
          ? config.auth.token.length > 0
          : config.auth.apiKey.length > 0 && config.auth.email.length > 0;
      return JSON.stringify(
        {
          configured,
          authType: configured ? config.auth.type : null,
          credentialSources: config.credentialSources,
          keychain: config.keychain,
          envFile: config.envFile,
          accountId: config.accountId ?? null,
          zoneId: config.zoneId ?? null,
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: "verify_api_token",
    annotations: READ_ONLY,
    description:
      "Check that the configured Cloudflare API token is active. Returns the token's id, status, and validity window only — it does NOT list permissions. This works with any token and needs no extra permission, so use it to tell 'the token is broken' apart from 'the token lacks a permission'.",
    parameters: z.object({
      accountId: z
        .string()
        .optional()
        .describe("Verify an account-owned token instead of a user-owned one"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const result = await client.verifyToken(args.accountId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_api_token",
    annotations: READ_ONLY,
    description:
      "Get an API token's full definition, including the policies that carry its permission groups. Defaults to the calling token. Requires the 'API Tokens Read' permission on the token itself; without it Cloudflare returns 403 code 9109.",
    parameters: z.object({
      tokenId: z
        .string()
        .optional()
        .describe("Token ID; defaults to the calling token, resolved via verify"),
      accountId: z
        .string()
        .optional()
        .describe("Read an account-owned token instead of a user-owned one"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const result = await client.getApiToken(args.tokenId, args.accountId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_token_permissions",
    annotations: READ_ONLY,
    description:
      "List the permission groups on an API token, flattened out of their policies so each entry carries its own effect (allow/deny), scope (user/account/zone), and the resources it applies to. Use this to answer 'what can this token do' before attempting a write. Requires the 'API Tokens Read' permission on the token itself.",
    parameters: z.object({
      tokenId: z
        .string()
        .optional()
        .describe("Token ID; defaults to the calling token, resolved via verify"),
      accountId: z
        .string()
        .optional()
        .describe("Read an account-owned token instead of a user-owned one"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const result = await client.getTokenPermissions(args.tokenId, args.accountId);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "check_token_permissions",
    annotations: READ_ONLY,
    description:
      "Check whether the API token holds specific permission groups, so 'can I do X' becomes a cheap lookup instead of a failed write. Each query matches a permission group ID (stable) or name (cosmetic; Cloudflare may change it). Names are matched case-insensitively, the dashboard's 'Edit' is treated as the API's 'Write', and a leading scope word is accepted, so 'Zone:Config Rules:Edit', 'Config Rules Write', and the group's ID all match the same permission. A query is granted only if it matches an allow and no deny.",
    parameters: z.object({
      permissions: z
        .array(z.string())
        .nonempty()
        .describe(
          "Permission group names or IDs to check, e.g. ['Zone Read', 'Zone:Config Rules:Edit']"
        ),
      tokenId: z
        .string()
        .optional()
        .describe("Token ID; defaults to the calling token, resolved via verify"),
      accountId: z
        .string()
        .optional()
        .describe("Read an account-owned token instead of a user-owned one"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const result = await client.getTokenPermissions(args.tokenId, args.accountId);
      const checks = checkTokenPermissions(result.permissions, args.permissions);

      return JSON.stringify(
        {
          tokenId: result.tokenId,
          allGranted: checks.every((check) => check.granted),
          checks: checks.map((check) => ({
            ...check,
            // Only useful when nothing matched; a near-miss name is the most
            // common reason a check fails against a token that can do the job.
            suggestions:
              check.granted || check.matched.length > 0
                ? undefined
                : suggestPermissionNames(result.permissions, check.query),
          })),
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: "list_token_permission_groups",
    annotations: READ_ONLY,
    description:
      "List the permission groups that can be assigned to a Cloudflare API token, with their stable IDs and scopes. Use this to resolve a permission name to the ID that check_token_permissions matches reliably. Requires the 'API Tokens Read' permission on the token.",
    parameters: z.object({
      name: z.string().optional().describe("Filter by permission group name"),
      scope: z
        .string()
        .optional()
        .describe(
          "Filter by scope URN: com.cloudflare.api.user, com.cloudflare.api.account, or com.cloudflare.api.account.zone"
        ),
      accountId: z
        .string()
        .optional()
        .describe("List account-owned token permission groups"),
    }),
    execute: async (args) => {
      const client = await getClient();
      const groups = await client.listTokenPermissionGroups({
        name: args.name,
        scope: args.scope,
        accountId: args.accountId,
      });
      return JSON.stringify(groups, null, 2);
    },
  });
}
