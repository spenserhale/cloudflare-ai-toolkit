import { buildCommand } from "@stricli/core";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  getCustomHostnameHistory,
  parseAuditTime,
  resolveConfig,
  type CustomHostnameHistory,
} from "@cloudflare-ai-toolkit/sdk";

export interface CustomHostnameHistoryFlags {
  readonly accountId?: string;
  readonly zoneId?: string;
  readonly since?: string;
  readonly before?: string;
  readonly json: boolean;
}

interface CustomHostnameHistoryDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (
    config: ReturnType<typeof resolveConfig>
  ) => Pick<CloudflareClient, "listAuditLogs" | "listCustomHostnames">;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: CustomHostnameHistoryDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};

function formatError(err: unknown): string {
  const base =
    err instanceof CloudflareAuthError
      ? `Authentication failed: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  if (!(err instanceof CloudflareError)) return base;
  const parts = [base];
  if (err.requiredPermissions && err.requiredPermissions.length > 0) {
    parts.push(`Required permission: ${err.requiredPermissions.map((p) => `'${p}'`).join(" or ")}`);
  }
  if (err.docsUrl) parts.push(`Docs: ${err.docsUrl}`);
  return parts.join("\n");
}

function parseTime(value: string): string {
  parseAuditTime(value);
  return value;
}

export function formatCustomHostnameHistory(history: CustomHostnameHistory): string {
  const lines = [
    `History for ${history.hostname} (${history.since} to ${history.before})`,
    `Current ID: ${history.currentIds.length > 0 ? history.currentIds.join(", ") : "-"}`,
  ];
  const otherIds = history.knownIds.filter((id) => !history.currentIds.includes(id));
  if (otherIds.length > 0) lines.push(`Other linked IDs: ${otherIds.join(", ")}`);
  lines.push("");

  if (history.entries.length === 0) {
    lines.push("No matching events.");
  }
  for (const entry of history.entries) {
    const columns = [
      entry.time,
      entry.action.padEnd(6),
      entry.resourceId ?? "-",
      entry.actor ?? "-",
      entry.zone ?? "-",
      entry.description,
    ];
    lines.push(columns.join("  "));
    if (entry.note) lines.push(`    note: ${entry.note}`);
  }

  if (history.notes.length > 0) {
    lines.push("");
    for (const note of history.notes) lines.push(`* ${note}`);
  }
  return lines.join("\n");
}

export async function runCustomHostnameHistory(
  hostname: string,
  flags: CustomHostnameHistoryFlags,
  deps: CustomHostnameHistoryDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const history = await getCustomHostnameHistory(client, {
      hostname,
      accountId: flags.accountId,
      zoneId: flags.zoneId ?? config.zoneId,
      since: flags.since,
      before: flags.before,
    });
    for (const warning of history.warnings) deps.error(`Warning: ${warning}`);

    if (flags.json) {
      deps.log(JSON.stringify(history, null, 2));
      return;
    }
    deps.log(formatCustomHostnameHistory(history));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const customHostnameHistoryCommand = buildCommand({
  docs: {
    brief: "Show the create/update/delete timeline for a custom hostname from audit logs",
    fullDescription:
      "Looks up the hostname's current ID, then searches custom_hostnames audit events. " +
      "Creates are matched by the hostname in the request body; updates and deletes by ID. " +
      "A delete shortly before a create on the same zone is flagged as a likely re-create. " +
      "If no create event exists, reports where the account's audit history starts.",
  },
  parameters: {
    flags: {
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Cloudflare account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone holding the hostname, to resolve its current ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      since: {
        kind: "parsed",
        parse: parseTime,
        optional: true,
        brief: "Start (ISO-8601, YYYY-MM-DD, or 30d). Defaults to the retention limit",
      },
      before: {
        kind: "parsed",
        parse: parseTime,
        optional: true,
        brief: "End (exclusive). Defaults to now",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Fully qualified custom hostname, e.g. www.example.com",
          parse: String,
          placeholder: "hostname",
        },
      ],
    },
  },
  async func(this: void, flags: CustomHostnameHistoryFlags, hostname: string) {
    await runCustomHostnameHistory(hostname, flags);
  },
});
