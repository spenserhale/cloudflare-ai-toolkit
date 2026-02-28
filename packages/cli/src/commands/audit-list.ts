import { buildCommand } from "@stricli/core";
import { CloudflareClient, resolveConfig } from "@cloudflare-toolkit/sdk";

interface AuditListFlags {
  readonly accountId?: string;
  readonly since: string;
  readonly before: string;
  readonly actorEmail?: string;
  readonly actorId?: string;
  readonly actionType?: string;
  readonly actionResult?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly direction: "asc" | "desc";
  readonly json: boolean;
}

function parseIsoDate(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ISO datetime: ${value}`);
  }
  return value;
}

function parseDirection(value: string): "asc" | "desc" {
  if (value !== "asc" && value !== "desc") {
    throw new Error(`Direction must be 'asc' or 'desc', got '${value}'`);
  }
  return value;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

export const listAuditLogsCommand = buildCommand({
  docs: {
    brief: "List audit logs with filters",
  },
  parameters: {
    flags: {
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Cloudflare account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
      },
      since: {
        kind: "parsed",
        parse: parseIsoDate,
        brief: "Start datetime (ISO-8601)",
      },
      before: {
        kind: "parsed",
        parse: parseIsoDate,
        brief: "End datetime (ISO-8601)",
      },
      actorEmail: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by actor email",
      },
      actorId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by actor ID",
      },
      actionType: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by action type",
      },
      actionResult: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by action result",
      },
      cursor: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Pagination cursor",
      },
      limit: {
        kind: "parsed",
        parse: parsePositiveInt,
        brief: "Maximum results to return",
        default: "100",
      },
      direction: {
        kind: "parsed",
        parse: parseDirection,
        brief: "Sort direction (asc|desc)",
        default: "desc",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: AuditListFlags) {
    const config = resolveConfig();
    const client = new CloudflareClient(config);

    try {
      const result = await client.listAuditLogs(
        {
          since: flags.since,
          before: flags.before,
          actorEmail: flags.actorEmail,
          actorId: flags.actorId,
          actionType: flags.actionType,
          actionResult: flags.actionResult,
          cursor: flags.cursor,
          limit: flags.limit,
          direction: flags.direction,
        },
        flags.accountId
      );

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Found ${result.data.length} audit log entries\n`);
      for (const log of result.data) {
        const when = log.when ?? "-";
        const actor = log.actor?.email ?? log.actor?.id ?? "-";
        const action = log.action?.type ?? "-";
        const actionResult = log.action?.result ?? "-";
        const resource = log.resource?.type ?? log.resource?.id ?? "-";

        console.log(`${when}  ${actor}  ${action} (${actionResult})  ${resource}`);
      }

      if (result.pagination?.cursor) {
        console.log(`\nNext cursor: ${result.pagination.cursor}`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  },
});
