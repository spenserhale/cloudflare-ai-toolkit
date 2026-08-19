import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type VanityNameServerIp,
  type ZoneVanityNameServers,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface VanityNsDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "getZoneVanityNameServers"
    | "setZoneVanityNameServers"
    | "clearZoneVanityNameServers"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: VanityNsDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: async (prompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(prompt);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  },
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

function orDash(value: string | null | undefined): string {
  if (value === undefined || value === null) return "-";
  return value.length > 0 ? value : "-";
}

function formatIpLine(ip: VanityNameServerIp): string {
  return `  ${orDash(ip.ns_name)}  A=${orDash(ip.ipv4)}  AAAA=${orDash(ip.ipv6)}`;
}

export function formatVanityNameServers(result: ZoneVanityNameServers): string {
  const lines = [
    `Zone ${result.zoneId} (${result.zoneName})`,
    `Custom nameservers: ${result.enabled ? "enabled" : "disabled"}`,
  ];

  if (result.nameServers.length > 0) {
    lines.push(`Names:       ${result.nameServers.join(", ")}`);
  }
  lines.push(`Cloudflare:  ${result.assignedNameServers.join(", ") || "-"}`);

  if (result.ips.length > 0) {
    lines.push("Glue records:");
    for (const ip of result.ips) {
      lines.push(formatIpLine(ip));
    }
  }

  return lines.join("\n");
}

/**
 * Zone custom nameservers must live under the zone they are configured on, so
 * catch the mistake before spending a round trip on a request the API rejects.
 */
function findNamesOutsideZone(
  zoneName: string,
  nameServers: readonly string[]
): string[] {
  const suffix = `.${zoneName.toLowerCase()}`;
  return nameServers.filter(
    (name) => !name.trim().toLowerCase().endsWith(suffix)
  );
}

// ---------------------------------------------------------------------------
// Get vanity nameservers
// ---------------------------------------------------------------------------

export interface VanityNsGetFlags {
  readonly json: boolean;
}

export async function runGetVanityNameServers(
  zoneId: string | undefined,
  flags: VanityNsGetFlags,
  deps: VanityNsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.getZoneVanityNameServers(zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(formatVanityNameServers(result));
    if (!result.enabled) {
      deps.log(
        `\nSet them with \`zones vanity-ns set ns1.${result.zoneName} ns2.${result.zoneName}\`.`
      );
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const getVanityNameServersCommand = buildCommand({
  docs: {
    brief: "Show a zone's custom (vanity) nameservers and their glue records",
    customUsage: ["", "<zone-id>", "<zone-id> --json"],
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
  async func(this: void, flags: VanityNsGetFlags, zoneId?: string) {
    await runGetVanityNameServers(zoneId, flags);
  },
});

// ---------------------------------------------------------------------------
// Set vanity nameservers
// ---------------------------------------------------------------------------

export interface VanityNsSetFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runSetVanityNameServers(
  nameServers: readonly string[],
  flags: VanityNsSetFlags,
  deps: VanityNsDeps = defaultDeps
): Promise<void> {
  try {
    if (nameServers.length === 0) {
      throw new Error(
        "At least one nameserver is required. Use `zones vanity-ns clear` to remove them."
      );
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const current = await client.getZoneVanityNameServers(flags.zoneId);

    const outsideZone = findNamesOutsideZone(current.zoneName, nameServers);
    if (outsideZone.length > 0) {
      throw new Error(
        `Zone custom nameservers must be subdomains of ${current.zoneName}. ` +
          `Offending name(s): ${outsideZone.join(", ")}`
      );
    }

    if (!flags.yes) {
      const from = current.enabled ? current.nameServers.join(", ") : "none";
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to change nameservers without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to change the custom nameservers for ${current.zoneName} from [${from}] ` +
          `to [${nameServers.join(", ")}]. DNS resolution breaks until the registrar ` +
          `is updated to match. Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const result = await client.setZoneVanityNameServers(
      [...nameServers],
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(formatVanityNameServers(result));
    deps.log(
      "\nNext: add these nameservers, plus their A/AAAA addresses as glue records, at your registrar."
    );
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const setVanityNameServersCommand = buildCommand({
  docs: {
    brief: "Replace a zone's custom (vanity) nameservers",
    customUsage: [
      "ns1.example.com ns2.example.com",
      "ns1.example.com ns2.example.com --zoneId <zone-id> --yes",
    ],
  },
  parameters: {
    flags: {
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      yes: {
        kind: "boolean",
        brief: "Skip the confirmation prompt",
        default: false,
      },
    },
    positional: {
      kind: "array",
      parameter: {
        brief: "Nameserver name(s), each a subdomain of the zone",
        parse: String,
      },
    },
  },
  async func(this: void, flags: VanityNsSetFlags, ...nameServers: string[]) {
    await runSetVanityNameServers(nameServers, flags);
  },
});

// ---------------------------------------------------------------------------
// Clear vanity nameservers
// ---------------------------------------------------------------------------

export interface VanityNsClearFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runClearVanityNameServers(
  flags: VanityNsClearFlags,
  deps: VanityNsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const current = await client.getZoneVanityNameServers(flags.zoneId);

    if (!current.enabled) {
      if (flags.json) {
        deps.log(JSON.stringify(current, null, 2));
        return;
      }
      deps.log(`${current.zoneName} has no custom nameservers configured.`);
      return;
    }

    if (!flags.yes) {
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to remove nameservers without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to remove the custom nameservers for ${current.zoneName} ` +
          `[${current.nameServers.join(", ")}] and their read-only A/AAAA records. ` +
          `Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const result = await client.clearZoneVanityNameServers(flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(formatVanityNameServers(result));
    deps.log(
      `\nNext: point ${result.zoneName} at ${result.assignedNameServers.join(", ") || "Cloudflare's nameservers"} at your registrar.`
    );
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const clearVanityNameServersCommand = buildCommand({
  docs: {
    brief: "Remove a zone's custom (vanity) nameservers",
    customUsage: ["", "--zoneId <zone-id> --yes"],
  },
  parameters: {
    flags: {
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      yes: {
        kind: "boolean",
        brief: "Skip the confirmation prompt",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [],
    },
  },
  async func(this: void, flags: VanityNsClearFlags) {
    await runClearVanityNameServers(flags);
  },
});
