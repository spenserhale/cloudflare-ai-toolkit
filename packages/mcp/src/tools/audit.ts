import type { FastMCP } from "fastmcp";
import { z } from "zod";
import { encode } from "@toon-format/toon";
import {
  AUDIT_LOG_FILTER_FIELDS,
  AuditFacetCounter,
  CloudflareClient,
  DAY_MS,
  DEFAULT_AUDIT_FACETS,
  DEFAULT_AUDIT_FIELDS,
  WEEK_MS,
  buildAuditLogPredicate,
  diagnoseEmptyAuditSearch,
  getCustomHostnameHistory,
  parseAuditWhere,
  pickAuditFields,
  resolveAuditRange,
  resolveConfig,
  searchAuditLogs,
  toAuditLogTable,
  type AuditLogFilterField,
  type AuditLogFilters,
  type AuditLogListResult,
} from "@cloudflare-ai-toolkit/sdk";

function getClient(): CloudflareClient {
  const config = resolveConfig();
  return new CloudflareClient(config);
}

const outputFormatSchema = z.enum(["json", "toon"]);
type OutputFormat = z.infer<typeof outputFormatSchema>;
const actionTypeSchema = z.enum(["create", "view", "update", "delete"]);

function renderAuditLogs(
  result: AuditLogListResult,
  format: OutputFormat
): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  return encode(
    {
      ...toAuditLogTable(result.data),
      nextCursor: result.pagination?.cursor ?? null,
    },
    { keyFolding: "safe" }
  );
}

const filterValuesSchema = z.object({
  in: z.array(z.string()).optional().describe("Values to include (OR'd)"),
  not: z.array(z.string()).optional().describe("Values to exclude"),
});

const filtersSchema = z
  .record(z.enum(AUDIT_LOG_FILTER_FIELDS), filterValuesSchema)
  .optional()
  .describe(
    "Server-side filters keyed by API field name, e.g. " +
      '{"resource_product":{"in":["custom_hostnames"]},"action_type":{"not":["view"]}}. ' +
      "Custom hostname, DNS, and most events leave resource_type empty; filter on resource_product instead."
  );

const searchWindowSchema = z
  .object({
    accountId: z.string().optional().describe("Cloudflare account ID"),
    since: z
      .string()
      .default("7d")
      .describe("Start: ISO-8601, YYYY-MM-DD, or relative like 7d/24h/2w. Clamped to 18-month retention"),
    before: z.string().optional().describe("End (exclusive). Defaults to now"),
    filters: filtersSchema,
    includePurge: z
      .boolean()
      .default(false)
      .describe("Keep purge_cache events, which are excluded by default because they dominate volume"),
    match: z.string().optional().describe("Client-side regex over the whole event JSON (case-insensitive)"),
    where: z
      .array(z.string())
      .optional()
      .describe("Client-side clauses: field=value, field!=value, field~regex (dot paths or aliases)"),
  });

type SearchWindowArgs = z.infer<typeof searchWindowSchema>;

function withPurgeDefault(args: SearchWindowArgs): AuditLogFilters {
  const filters: Partial<Record<AuditLogFilterField, { in?: string[]; not?: string[] }>> = {
    ...(args.filters ?? {}),
  };
  const product = filters.resource_product;
  if (!args.includePurge && !product?.in?.includes("purge_cache")) {
    filters.resource_product = {
      ...product,
      not: [...(product?.not ?? []), "purge_cache"],
    };
  }
  return filters;
}

function windowFor(filters: AuditLogFilters): number {
  const narrowed = Object.values(filters).some((entry) => (entry?.in?.length ?? 0) > 0);
  return narrowed ? WEEK_MS : DAY_MS;
}

export function registerAuditTools(server: FastMCP) {
  server.addTool({
    name: "list_audit_logs",
    description:
      "List one page of Cloudflare audit logs. For multi-page history questions use search_audit_logs",
    parameters: z.object({
      accountId: z.string().optional().describe("Cloudflare account ID"),
      since: z.string().describe("Start datetime in ISO-8601 format"),
      before: z.string().describe("End datetime in ISO-8601 format"),
      actorEmail: z.string().optional().describe("Filter by actor email"),
      actorId: z.string().optional().describe("Filter by actor ID"),
      actionType: actionTypeSchema.optional().describe("Filter by action type"),
      actionResult: z.string().optional().describe("Filter by action result"),
      resourceType: z
        .string()
        .optional()
        .describe("Filter by resource.type; often empty, prefer product"),
      product: z
        .string()
        .optional()
        .describe("Filter by resource.product, e.g. custom_hostnames, dns_records"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().int().positive().max(1000).default(100).describe("Max results to return"),
      direction: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
      format: outputFormatSchema.default("toon").describe("Output format: toon or json"),
    }),
    execute: async (args) => {
      const client = getClient();
      const result = await client.listAuditLogs(
        {
          since: args.since,
          before: args.before,
          actorEmail: args.actorEmail,
          actorId: args.actorId,
          actionType: args.actionType,
          actionResult: args.actionResult,
          resourceType: args.resourceType,
          filters: args.product ? { resource_product: { in: [args.product] } } : undefined,
          cursor: args.cursor,
          limit: args.limit,
          direction: args.direction,
        },
        args.accountId
      );

      return renderAuditLogs(result, args.format);
    },
  });

  server.addTool({
    name: "search_audit_logs",
    description:
      "Search Cloudflare audit logs across every page of a time range (auto-pagination, parallel " +
      "time windows, retries). Use this instead of list_audit_logs for history questions such as " +
      "'when was X created'. Use direction=asc with maxResults=1 for the earliest matching event. " +
      "If unsure which filter values exist, call audit_log_facets first.",
    parameters: searchWindowSchema.extend({
      direction: z.enum(["asc", "desc"]).default("desc").describe("asc = oldest first"),
      maxResults: z
        .number()
        .int()
        .positive()
        .max(5000)
        .default(200)
        .describe("Stop after this many matches"),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          `Fields to return (dot paths or aliases). Default: ${DEFAULT_AUDIT_FIELDS.join(", ")}. ` +
            "Use ['*'] for whole events"
        ),
      format: outputFormatSchema.default("toon").describe("Output format: toon or json"),
    }),
    execute: async (args) => {
      const client = getClient();
      const filters = withPurgeDefault(args);
      const range = resolveAuditRange(args.since, args.before);
      const predicate = buildAuditLogPredicate({
        match: args.match,
        where: args.where?.map(parseAuditWhere),
      });
      const wholeEvents = args.fields?.includes("*") === true;
      const fields = args.fields && !wholeEvents ? args.fields : [...DEFAULT_AUDIT_FIELDS];

      const events: unknown[] = [];
      for await (const log of searchAuditLogs(client, {
        accountId: args.accountId,
        since: range.sinceMs,
        before: range.beforeMs,
        direction: args.direction,
        filters,
        predicate,
        maxResults: args.maxResults,
        windowMs: windowFor(filters),
        concurrency: 8,
      })) {
        events.push(wholeEvents ? log : pickAuditFields(log, fields));
      }

      const hints =
        events.length === 0
          ? await diagnoseEmptyAuditSearch(client, {
              accountId: args.accountId,
              filters,
              sinceMs: range.sinceMs,
              beforeMs: range.beforeMs,
            }).catch(() => [])
          : [];
      const result = {
        since: new Date(range.sinceMs).toISOString(),
        before: new Date(range.beforeMs).toISOString(),
        count: events.length,
        truncated: events.length >= args.maxResults,
        warnings: range.warnings,
        hints,
        events,
      };
      return args.format === "json"
        ? JSON.stringify(result, null, 2)
        : encode(result, { keyFolding: "safe" });
    },
  });

  server.addTool({
    name: "audit_log_facets",
    description:
      "Count Cloudflare audit log events by product, resource type, action, actor, context, and " +
      "zone over a time range, to discover valid filter values before calling search_audit_logs.",
    parameters: searchWindowSchema.extend({
      facets: z
        .array(z.string())
        .optional()
        .describe(`Fields to count. Default: ${DEFAULT_AUDIT_FACETS.join(", ")}`),
      top: z.number().int().positive().max(200).default(20).describe("Values per field"),
    }),
    execute: async (args) => {
      const client = getClient();
      const filters = withPurgeDefault(args);
      const range = resolveAuditRange(args.since, args.before);
      const counter = new AuditFacetCounter(args.facets ?? [...DEFAULT_AUDIT_FACETS]);
      for await (const log of searchAuditLogs(client, {
        accountId: args.accountId,
        since: range.sinceMs,
        before: range.beforeMs,
        filters,
        predicate: buildAuditLogPredicate({
          match: args.match,
          where: args.where?.map(parseAuditWhere),
        }),
        windowMs: windowFor(filters),
        concurrency: 8,
      })) {
        counter.add(log);
      }
      return encode(
        { total: counter.total, warnings: range.warnings, facets: counter.result(args.top) },
        { keyFolding: "safe" }
      );
    },
  });

  server.addTool({
    name: "custom_hostname_history",
    description:
      "Timeline of create/update/delete audit events for a custom hostname (SSL for SaaS). " +
      "Links creates by hostname and updates/deletes by ID, flags likely delete-then-recreate " +
      "pairs, and says when history predates audit log retention.",
    parameters: z.object({
      hostname: z.string().min(1).describe("Fully qualified custom hostname"),
      accountId: z.string().optional().describe("Cloudflare account ID"),
      zoneId: z
        .string()
        .optional()
        .describe("Zone holding the hostname, to resolve its current ID (defaults to CLOUDFLARE_ZONE_ID)"),
      since: z.string().optional().describe("Start. Defaults to the retention limit"),
      before: z.string().optional().describe("End (exclusive). Defaults to now"),
    }),
    execute: async (args) => {
      const config = resolveConfig();
      const client = new CloudflareClient(config);
      const history = await getCustomHostnameHistory(client, {
        hostname: args.hostname,
        accountId: args.accountId,
        zoneId: args.zoneId ?? config.zoneId,
        since: args.since,
        before: args.before,
      });
      return JSON.stringify(history, null, 2);
    },
  });
}
