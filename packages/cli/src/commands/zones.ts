import { buildCommand } from "@stricli/core";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type ListZonesResult,
  type Zone,
  type ZoneNameFilterOperator,
  type ZoneStatus,
  type ZoneType,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface ZonesDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    "listZones" | "getZone"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: ZonesDeps = {
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
    const perms = err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
    parts.push(`Required permission: ${perms}`);
  }
  if (err.docsUrl) {
    parts.push(`Docs: ${err.docsUrl}`);
  }
  return parts.join("\n");
}

function orDash(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return "-";
  const text = String(value);
  return text.length > 0 ? text : "-";
}

const NAME_FILTER_OPERATORS = [
  "equal",
  "not_equal",
  "starts_with",
  "ends_with",
  "contains",
  "starts_with_case_sensitive",
  "ends_with_case_sensitive",
  "contains_case_sensitive",
] as const;

function parseNameOperator(value: string): ZoneNameFilterOperator {
  if ((NAME_FILTER_OPERATORS as readonly string[]).includes(value)) {
    return value as ZoneNameFilterOperator;
  }
  throw new Error(
    `Operator must be one of ${NAME_FILTER_OPERATORS.join("|")}, got '${value}'`
  );
}

function parseStatus(value: string): ZoneStatus {
  if (
    value === "initializing" ||
    value === "pending" ||
    value === "active" ||
    value === "moved"
  ) {
    return value;
  }
  throw new Error(
    `Status must be one of initializing|pending|active|moved, got '${value}'`
  );
}

function parseTypes(value: string): [ZoneType, ...ZoneType[]] {
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      if (
        entry === "full" ||
        entry === "partial" ||
        entry === "secondary" ||
        entry === "internal"
      ) {
        return entry;
      }
      throw new Error(
        `Zone type must be one of full|partial|secondary|internal, got '${entry}'`
      );
    });

  const [first, ...rest] = parsed;
  if (first === undefined) {
    throw new Error("Expected at least one zone type");
  }
  return [first, ...rest];
}

function parseMatch(value: string): "all" | "any" {
  if (value === "all" || value === "any") return value;
  throw new Error(`Match must be 'all' or 'any', got '${value}'`);
}

function parseOrder(
  value: string
): "name" | "status" | "account.id" | "account.name" | "plan.id" {
  if (
    value === "name" ||
    value === "status" ||
    value === "account.id" ||
    value === "account.name" ||
    value === "plan.id"
  ) {
    return value;
  }
  throw new Error(
    `Order must be one of name|status|account.id|account.name|plan.id, got '${value}'`
  );
}

function parseDirection(value: string): "asc" | "desc" {
  if (value === "asc" || value === "desc") return value;
  throw new Error(`Direction must be 'asc' or 'desc', got '${value}'`);
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

function parsePerPage(value: string): number {
  const parsed = parsePositiveInt(value);
  if (parsed < 5 || parsed > 50) {
    throw new Error(`Items per page must be between 5 and 50, got '${value}'`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// List zones
// ---------------------------------------------------------------------------

export interface ZonesListFlags {
  readonly operator?: ZoneNameFilterOperator;
  readonly status?: ZoneStatus;
  readonly type?: readonly ZoneType[];
  readonly accountId?: string;
  readonly accountName?: string;
  readonly match?: "all" | "any";
  readonly order?: "name" | "status" | "account.id" | "account.name" | "plan.id";
  readonly direction?: "asc" | "desc";
  readonly page?: number;
  readonly perPage?: number;
  readonly json: boolean;
}

function formatZoneLine(zone: Zone): string {
  const fields = [
    `status=${orDash(zone.status)}`,
    `type=${orDash(zone.type)}`,
    `plan=${orDash(zone.plan?.name)}`,
    `account=${orDash(zone.account?.name ?? zone.account?.id)}`,
  ];
  if (zone.paused) {
    fields.push("paused=true");
  }
  return `${zone.id}  ${zone.name}  ${fields.join(" ")}`;
}

function formatZonesSummary(result: ListZonesResult): string {
  const info = result.resultInfo;
  const count = result.zones.length;
  const noun = count === 1 ? "zone" : "zones";
  if (info?.page && info.total_pages) {
    const scope =
      info.total_count === undefined
        ? `${count} ${noun}`
        : `${count} of ${info.total_count} zones`;
    return `Showing ${scope} (page ${info.page} of ${info.total_pages})`;
  }
  return `Showing ${count} ${noun}`;
}

export async function runListZones(
  name: string | undefined,
  flags: ZonesListFlags,
  deps: ZonesDeps = defaultDeps
): Promise<void> {
  try {
    if (name === undefined && flags.operator !== undefined) {
      deps.error(
        "Error: --operator only applies to a zone name. Pass the name as an argument, e.g. `zones list example.com --operator contains`."
      );
      deps.exit(1);
      return;
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.listZones({
      name,
      nameOperator: flags.operator,
      status: flags.status,
      type: flags.type === undefined ? undefined : [...flags.type] as [ZoneType, ...ZoneType[]],
      accountId: flags.accountId,
      accountName: flags.accountName,
      match: flags.match,
      order: flags.order,
      direction: flags.direction,
      page: flags.page,
      perPage: flags.perPage,
    });

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(`${formatZonesSummary(result)}\n`);

    if (result.zones.length === 0) {
      if (name !== undefined && (flags.operator ?? "equal") === "equal") {
        deps.log(
          `No zone is named exactly '${name}'. Retry with --operator contains to search partial names.`
        );
      } else {
        deps.log("No zones matched.");
      }
      return;
    }

    for (const zone of result.zones) {
      deps.log(formatZoneLine(zone));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listZonesCommand = buildCommand({
  docs: {
    brief: "List, search, and filter zones",
    customUsage: [
      "example.com",
      "dental --operator contains",
      "--status pending --json",
      "--accountId <account-id> --order name",
    ],
  },
  parameters: {
    flags: {
      operator: {
        kind: "parsed",
        parse: parseNameOperator,
        optional: true,
        brief: `Name filter operator (${NAME_FILTER_OPERATORS.join("|")}); default equal`,
      },
      status: {
        kind: "parsed",
        parse: parseStatus,
        optional: true,
        brief: "Filter by zone status (initializing|pending|active|moved)",
      },
      type: {
        kind: "parsed",
        parse: parseTypes,
        optional: true,
        brief: "Comma-separated zone types (full|partial|secondary|internal)",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by account ID",
      },
      accountName: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by account name",
      },
      match: {
        kind: "parsed",
        parse: parseMatch,
        optional: true,
        brief: "Match all filters or any of them (all|any)",
      },
      order: {
        kind: "parsed",
        parse: parseOrder,
        optional: true,
        brief: "Order by field (name|status|account.id|account.name|plan.id)",
      },
      direction: {
        kind: "parsed",
        parse: parseDirection,
        optional: true,
        brief: "Sort direction (asc|desc)",
      },
      page: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Page number",
      },
      perPage: {
        kind: "parsed",
        parse: parsePerPage,
        optional: true,
        brief: "Items per page (5-50)",
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
          brief: "Zone name to filter by (exact unless --operator is given)",
          parse: String,
          optional: true,
          placeholder: "name",
        },
      ],
    },
  },
  async func(this: void, flags: ZonesListFlags, name?: string) {
    await runListZones(name, flags);
  },
});

// ---------------------------------------------------------------------------
// Get a zone
// ---------------------------------------------------------------------------

export interface ZonesGetFlags {
  readonly json: boolean;
}

export function formatZoneDetails(zone: Zone): string {
  const account = zone.account?.name
    ? `${zone.account.name}${zone.account.id ? ` (${zone.account.id})` : ""}`
    : orDash(zone.account?.id);

  return [
    `Zone ${zone.id}`,
    `Name:        ${zone.name}`,
    `Status:      ${orDash(zone.status)}`,
    `Type:        ${orDash(zone.type)}`,
    `Paused:      ${orDash(zone.paused)}`,
    `Account:     ${account}`,
    `Plan:        ${orDash(zone.plan?.name)}`,
    `Nameservers: ${zone.name_servers?.join(", ") ?? "-"}`,
    `Original NS: ${zone.original_name_servers?.join(", ") ?? "-"}`,
    `Registrar:   ${orDash(zone.original_registrar)}`,
    `Created:     ${orDash(zone.created_on)}`,
    `Activated:   ${orDash(zone.activated_on)}`,
    `Modified:    ${orDash(zone.modified_on)}`,
    `Dev mode:    ${orDash(zone.development_mode)}`,
  ].join("\n");
}

export async function runGetZone(
  zoneId: string | undefined,
  flags: ZonesGetFlags,
  deps: ZonesDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const zone = await client.getZone(zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(zone, null, 2));
      return;
    }

    deps.log(formatZoneDetails(zone));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const getZoneCommand = buildCommand({
  docs: {
    brief: "Show details for one zone",
  },
  parameters: {
    flags: {
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
          brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
          parse: String,
          optional: true,
          placeholder: "zone-id",
        },
      ],
    },
  },
  async func(this: void, flags: ZonesGetFlags, zoneId?: string) {
    await runGetZone(zoneId, flags);
  },
});
