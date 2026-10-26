import { buildCommand } from "@stricli/core";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type ListTunnelsResult,
  type Tunnel,
  type TunnelConnector,
  type TunnelInfo,
  type TunnelStatus,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface TunnelsDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    "listTunnels" | "getTunnelInfo"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: TunnelsDeps = {
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

const TUNNEL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function parseStatus(value: string): TunnelStatus {
  if (
    value === "inactive" ||
    value === "degraded" ||
    value === "healthy" ||
    value === "down"
  ) {
    return value;
  }
  throw new Error(
    `Status must be one of inactive|degraded|healthy|down, got '${value}'`
  );
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
  if (parsed > 1000) {
    throw new Error(`Items per page must be between 1 and 1000, got '${value}'`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// List tunnels
// ---------------------------------------------------------------------------

export interface TunnelsListFlags {
  readonly status?: TunnelStatus;
  readonly includeDeleted: boolean;
  readonly accountId?: string;
  readonly page?: number;
  readonly perPage?: number;
  readonly json: boolean;
}

function formatTunnelLine(tunnel: Tunnel): string {
  const fields = [
    `status=${orDash(tunnel.status)}`,
    `config=${orDash(tunnel.config_src)}`,
    `created=${orDash(tunnel.created_at)}`,
  ];
  if (tunnel.deleted_at) {
    fields.push(`deleted=${tunnel.deleted_at}`);
  }
  return `${tunnel.id}  ${orDash(tunnel.name)}  ${fields.join(" ")}`;
}

function formatTunnelsSummary(result: ListTunnelsResult): string {
  const info = result.resultInfo;
  const count = result.tunnels.length;
  const noun = count === 1 ? "tunnel" : "tunnels";
  if (info?.total_count !== undefined && info.total_count > count) {
    const page = info.page === undefined ? "" : ` (page ${info.page})`;
    return `Showing ${count} of ${info.total_count} tunnels${page}`;
  }
  return `Showing ${count} ${noun}`;
}

export async function runListTunnels(
  name: string | undefined,
  flags: TunnelsListFlags,
  deps: TunnelsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.listTunnels({
      name,
      status: flags.status,
      // Deleted tunnels linger in the API indefinitely; hide them unless asked.
      isDeleted: flags.includeDeleted ? undefined : false,
      accountId: flags.accountId,
      page: flags.page,
      perPage: flags.perPage,
    });

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(`${formatTunnelsSummary(result)}\n`);

    if (result.tunnels.length === 0) {
      deps.log(
        name === undefined ? "No tunnels matched." : `No tunnel is named '${name}'.`
      );
      return;
    }

    for (const tunnel of result.tunnels) {
      deps.log(formatTunnelLine(tunnel));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listTunnelsCommand = buildCommand({
  docs: {
    brief: "List Cloudflare Tunnels (cloudflared) in an account",
    customUsage: [
      "",
      "office-gateway",
      "--status down --json",
      "--includeDeleted --accountId <account-id>",
    ],
  },
  parameters: {
    flags: {
      status: {
        kind: "parsed",
        parse: parseStatus,
        optional: true,
        brief: "Filter by tunnel status (inactive|degraded|healthy|down)",
      },
      includeDeleted: {
        kind: "boolean",
        brief: "Include deleted tunnels",
        default: false,
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
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
        brief: "Items per page (1-1000)",
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
          brief: "Tunnel name to filter by",
          parse: String,
          optional: true,
          placeholder: "name",
        },
      ],
    },
  },
  async func(this: void, flags: TunnelsListFlags, name?: string) {
    await runListTunnels(name, flags);
  },
});

// ---------------------------------------------------------------------------
// Tunnel info
// ---------------------------------------------------------------------------

export interface TunnelsInfoFlags {
  readonly accountId?: string;
  readonly json: boolean;
}

function formatConnector(connector: TunnelConnector): string[] {
  const lines = [
    `  Connector ${orDash(connector.id)}`,
    `    Version:  ${orDash(connector.version)}  Arch: ${orDash(connector.arch)}`,
    `    Started:  ${orDash(connector.run_at)}`,
  ];
  const conns = connector.conns ?? [];
  for (const conn of conns) {
    lines.push(
      `    ${orDash(conn.colo_name)}  origin=${orDash(conn.origin_ip)}  opened=${orDash(conn.opened_at)}`
    );
  }
  if (conns.length === 0) {
    lines.push("    No edge connections");
  }
  return lines;
}

export function formatTunnelInfo(info: TunnelInfo): string {
  const { tunnel, connectors } = info;
  const lines = [
    `Tunnel ${tunnel.id}`,
    `Name:        ${orDash(tunnel.name)}`,
    `Status:      ${orDash(tunnel.status)}`,
    `Type:        ${orDash(tunnel.tun_type)}`,
    `Config:      ${orDash(tunnel.config_src)}`,
    `Created:     ${orDash(tunnel.created_at)}`,
    `Active at:   ${orDash(tunnel.conns_active_at)}`,
    `Inactive at: ${orDash(tunnel.conns_inactive_at)}`,
  ];
  if (tunnel.deleted_at) {
    lines.push(`Deleted:     ${tunnel.deleted_at}`);
  }

  lines.push("");
  if (connectors.length === 0) {
    lines.push("Connectors: none (no cloudflared is running for this tunnel)");
  } else {
    lines.push(`Connectors (${connectors.length}):`);
    for (const connector of connectors) {
      lines.push(...formatConnector(connector));
    }
  }

  return lines.join("\n");
}

async function resolveTunnelId(
  client: Pick<CloudflareClient, "listTunnels">,
  idOrName: string,
  accountId: string | undefined
): Promise<string> {
  if (TUNNEL_ID_PATTERN.test(idOrName)) return idOrName;

  const { tunnels } = await client.listTunnels({
    name: idOrName,
    isDeleted: false,
    accountId,
  });
  const matches = tunnels.filter((tunnel) => tunnel.name === idOrName);
  const [first, ...rest] = matches;

  if (first === undefined) {
    throw new Error(
      `No tunnel is named '${idOrName}'. Run \`cloudflare tunnels list\` to see available tunnels.`
    );
  }
  if (rest.length > 0) {
    const ids = matches.map((tunnel) => tunnel.id).join(", ");
    throw new Error(
      `Multiple tunnels are named '${idOrName}' (${ids}). Pass the tunnel ID instead.`
    );
  }
  return first.id;
}

export async function runTunnelInfo(
  idOrName: string,
  flags: TunnelsInfoFlags,
  deps: TunnelsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const tunnelId = await resolveTunnelId(client, idOrName, flags.accountId);
    const info = await client.getTunnelInfo(tunnelId, flags.accountId);

    if (flags.json) {
      deps.log(JSON.stringify(info, null, 2));
      return;
    }

    deps.log(formatTunnelInfo(info));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const tunnelInfoCommand = buildCommand({
  docs: {
    brief: "Show a tunnel's status and its running cloudflared connectors",
    customUsage: ["office-gateway", "<tunnel-id> --json"],
  },
  parameters: {
    flags: {
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
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
          brief: "Tunnel ID or name",
          parse: String,
          placeholder: "tunnel",
        },
      ],
    },
  },
  async func(this: void, flags: TunnelsInfoFlags, idOrName: string) {
    await runTunnelInfo(idOrName, flags);
  },
});
