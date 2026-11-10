import type { FastMCP } from "fastmcp";
import { z } from "zod";
import {
  CloudflareClient,
  PrivacyModeSchema,
  RegistrationContactsSchema,
  prepareDomainRegistration,
  loadConfig,
} from "@cloudflare-ai-toolkit/sdk";
import { DESTRUCTIVE_WRITE, READ_ONLY } from "./annotations.js";

/** Reads env, .env, and the OS keychain on every call, so rotated keys apply without a restart. */
async function getClient(): Promise<CloudflareClient> {
  return new CloudflareClient(await loadConfig());
}

const accountId = z
  .string()
  .optional()
  .describe("Account ID; defaults to CLOUDFLARE_ACCOUNT_ID");

const sandbox = z
  .boolean()
  .optional()
  .describe(
    "Use Cloudflare's non-billing Registrar sandbox (/registrar-sandbox) instead of the live, billable API"
  );

const domainName = z.string().min(1).describe("Fully qualified domain name, e.g. example.com");

/**
 * Registers the Registrar tools. Every tool here reads, except
 * `register_domain`, which buys a domain and is guarded by a fresh
 * availability check and a caller-supplied price ceiling.
 */
export function registerRegistrarTools(server: FastMCP) {
  server.addTool({
    name: "search_domains",
    description:
      "Suggest available domain names for a keyword, phrase, or partial domain, with indicative pricing. Results use cached data and only cover extensions the Registrar API supports; confirm a choice with check_domains before registering.",
    annotations: READ_ONLY,
    parameters: z.object({
      query: z.string().min(1).describe("Keyword, phrase, or partial domain name"),
      extensions: z
        .array(z.string().min(1))
        .max(20)
        .optional()
        .describe("Limit suggestions to these extensions, without the dot (e.g. ['com', 'dev'])"),
      limit: z.number().int().min(1).max(50).optional().describe("Maximum suggestions (default 20)"),
      accountId,
      sandbox,
    }),
    execute: async (args) => {
      const result = await (await getClient()).searchDomains(args);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "check_domains",
    description:
      "Check real-time registry availability and pricing for up to 20 domains. Prices are decimal strings; registration_cost may be a first-year price below renewal_cost. When registrable is false, `reason` explains why (domain_unavailable, domain_premium, extension_not_supported_via_api, extension_not_supported, extension_disallows_registration).",
    annotations: READ_ONLY,
    parameters: z.object({
      domains: z.array(z.string().min(1)).min(1).max(20).describe("Domain names to check"),
      accountId,
      sandbox,
    }),
    execute: async (args) => {
      const result = await (await getClient()).checkDomains(args);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "register_domain",
    description: [
      "Register (purchase) a domain with Cloudflare Registrar.",
      "BILLABLE AND NON-REFUNDABLE outside sandbox: a successful registration charges the account's default payment method.",
      "Before calling: run check_domains, show the user the exact domain, registration_cost, renewal_cost and currency, and get their explicit confirmation to buy.",
      "Pass that confirmed registration_cost as maxRegistrationCost. The tool re-checks availability right before buying and refuses if the domain is unavailable, premium, priced in another currency, or now costs more.",
      "Uses the account's default registrant contact unless `contacts` is given.",
      "Returns the workflow status. If `completed` is false, poll get_domain_registration_status; do NOT call register_domain again for the same domain.",
    ].join(" "),
    // A purchase: clients list it with write tools, so admins can require
    // approval (Ask) or Block it independently of the read-only tools.
    annotations: DESTRUCTIVE_WRITE,
    parameters: z.object({
      domainName,
      maxRegistrationCost: z
        .string()
        .regex(/^\d+(\.\d{1,6})?$/u, "Decimal amount like 10.11")
        .describe(
          "Highest registration cost the user approved, as a decimal string from check_domains (e.g. '10.11'). The purchase is refused if the live price is higher."
        ),
      currency: z
        .string()
        .min(3)
        .describe("Currency the user approved, from check_domains (e.g. 'USD')"),
      years: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Registration term; omit to use the registry minimum (1 year for most, 2 for .ai). A multi-year term can cost more than the quoted registration_cost."
        ),
      autoRenew: z
        .boolean()
        .optional()
        .describe("Enable auto-renew (default false). true authorizes future renewal charges."),
      privacyMode: PrivacyModeSchema.optional().describe("WHOIS privacy; default 'redaction'"),
      contacts: RegistrationContactsSchema.optional().describe(
        "Override the account's default contact. registrant needs email, phone (+1.5555555555), and postal_info { name, organization?, address { street, city, state, postal_code, country_code } }."
      ),
      accountId,
      sandbox,
    }),
    execute: async (args) => {
      const client = await getClient();
      const target = { accountId: args.accountId, sandbox: args.sandbox };
      const assessment = await prepareDomainRegistration(client, args.domainName, {
        ...target,
        maxRegistrationCost: args.maxRegistrationCost,
        currency: args.currency,
      });

      if (!assessment.ok) {
        return JSON.stringify(
          {
            registered: false,
            refused: assessment.code,
            message: `Not registering. ${assessment.message}`,
            check: assessment.check,
          },
          null,
          2
        );
      }

      const status = await client.registerDomain({
        ...target,
        domainName: assessment.domain,
        years: args.years,
        autoRenew: args.autoRenew,
        privacyMode: args.privacyMode,
        contacts: args.contacts,
      });

      return JSON.stringify(
        {
          registered: status.state === "succeeded",
          sandbox: args.sandbox === true,
          pricing: assessment.pricing,
          status,
        },
        null,
        2
      );
    },
  });

  server.addTool({
    name: "get_domain_registration_status",
    description:
      "Get the state of a domain registration workflow started through the API: pending, in_progress, succeeded, failed, action_required, or blocked. Poll while pending/in_progress; stop and tell the user on action_required, blocked, or failed. Domains registered in the dashboard have no workflow; use get_domain_registration for those.",
    annotations: READ_ONLY,
    parameters: z.object({ domainName, accountId, sandbox }),
    execute: async (args) => {
      const result = await (await getClient()).getRegistrationStatus(args.domainName, args);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "get_domain_registration",
    description:
      "Get a domain registered to the account through Cloudflare Registrar: status, created/expiry dates, auto-renew, privacy mode, and lock state.",
    annotations: READ_ONLY,
    parameters: z.object({ domainName, accountId, sandbox }),
    execute: async (args) => {
      const result = await (await getClient()).getRegistration(args.domainName, args);
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    name: "list_domain_registrations",
    description:
      "List domains registered to the account through Cloudflare Registrar, one cursor-paginated page at a time. Pass nextCursor from the previous result to get the next page; it is absent on the last page.",
    annotations: READ_ONLY,
    parameters: z.object({
      cursor: z.string().optional().describe("nextCursor from a previous call"),
      perPage: z.number().int().min(1).max(50).optional().describe("Items per page (default 20)"),
      sortBy: z
        .enum(["registry_created_at", "registry_expires_at", "name"])
        .optional()
        .describe("Sort field (default registry_created_at)"),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)"),
      accountId,
      sandbox,
    }),
    execute: async (args) => {
      const result = await (await getClient()).listRegistrations(args);
      return JSON.stringify(result, null, 2);
    },
  });
}
