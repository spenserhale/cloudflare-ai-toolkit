import { buildCommand } from "@stricli/core";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type CustomHostname,
  type ListCustomHostnamesResult,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface CustomHostnamesDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (
    config: ReturnType<typeof resolveConfig>
  ) => Pick<CloudflareClient, "listCustomHostnames" | "getCustomHostname">;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: CustomHostnamesDeps = {
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

function orDash(value: string | number | boolean | undefined): string {
  if (value === undefined) return "-";
  const text = String(value);
  return text.length > 0 ? text : "-";
}

function isReady(hostname: CustomHostname): boolean {
  return hostname.status === "active" && hostname.ssl?.status === "active";
}

// ---------------------------------------------------------------------------
// List custom hostnames
// ---------------------------------------------------------------------------

export interface CustomHostnamesListFlags {
  readonly hostname?: string;
  readonly id?: string;
  readonly ssl?: boolean;
  readonly order?: "ssl" | "ssl_status";
  readonly direction?: "asc" | "desc";
  readonly page?: number;
  readonly perPage?: number;
  readonly zoneId?: string;
  readonly json: boolean;
}

function parseOptionalBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean value 'true' or 'false', got '${value}'`);
}

function parseOrder(value: string): "ssl" | "ssl_status" {
  if (value === "ssl" || value === "ssl_status") return value;
  throw new Error(`Order must be 'ssl' or 'ssl_status', got '${value}'`);
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

function formatListLine(hostname: CustomHostname): string {
  const ssl = hostname.ssl;
  const fields = [
    `status=${orDash(hostname.status)}`,
    `ssl=${orDash(ssl?.status)}`,
    `type=${orDash(ssl?.type)}`,
    `method=${orDash(ssl?.method)}`,
    `expires=${orDash(ssl?.expires_on)}`,
  ];
  return `${hostname.id}  ${hostname.hostname}  ${fields.join(" ")}`;
}

function formatListSummary(result: ListCustomHostnamesResult): string {
  const info = result.resultInfo;
  const count = result.hostnames.length;
  const noun = count === 1 ? "custom hostname" : "custom hostnames";
  if (info?.page && info.total_pages) {
    const scope =
      info.total_count === undefined
        ? `${count} ${noun}`
        : `${count} of ${info.total_count} custom hostnames`;
    return `Showing ${scope} (page ${info.page} of ${info.total_pages})`;
  }
  return `Showing ${count} ${noun}`;
}

export async function runListCustomHostnames(
  flags: CustomHostnamesListFlags,
  deps: CustomHostnamesDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.listCustomHostnames(
      {
        hostname: flags.hostname,
        id: flags.id,
        ssl: flags.ssl,
        order: flags.order,
        direction: flags.direction,
        page: flags.page,
        perPage: flags.perPage,
      },
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    deps.log(`${formatListSummary(result)}\n`);
    if (result.hostnames.length === 0) {
      deps.log("No custom hostnames matched.");
      return;
    }
    for (const hostname of result.hostnames) {
      deps.log(formatListLine(hostname));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listCustomHostnamesCommand = buildCommand({
  docs: {
    brief: "List custom hostnames (SSL for SaaS) in a zone",
  },
  parameters: {
    flags: {
      hostname: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by fully qualified custom hostname",
      },
      id: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by custom hostname ID",
      },
      ssl: {
        kind: "parsed",
        parse: parseOptionalBoolean,
        optional: true,
        brief: "Filter by whether a certificate is attached (true|false)",
      },
      order: {
        kind: "parsed",
        parse: parseOrder,
        optional: true,
        brief: "Order by field (ssl|ssl_status)",
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
    },
  },
  async func(this: void, flags: CustomHostnamesListFlags) {
    await runListCustomHostnames(flags);
  },
});

// ---------------------------------------------------------------------------
// Get a custom hostname
// ---------------------------------------------------------------------------

export interface CustomHostnamesGetFlags {
  readonly zoneId?: string;
  readonly json: boolean;
}

export function formatCustomHostnameDetails(hostname: CustomHostname): string {
  const lines: string[] = [];
  const ssl = hostname.ssl;

  lines.push(`Custom hostname ${hostname.id}`);
  lines.push(`Hostname:   ${hostname.hostname}`);
  lines.push(`Status:     ${orDash(hostname.status)}`);
  lines.push(`Created:    ${orDash(hostname.created_at)}`);
  if (hostname.custom_origin_server) {
    lines.push(`Origin:     ${hostname.custom_origin_server}`);
  }
  if (hostname.custom_origin_sni) {
    lines.push(`Origin SNI: ${hostname.custom_origin_sni}`);
  }

  lines.push("");
  lines.push("Certificate");
  lines.push(`  Status:    ${orDash(ssl?.status)}`);
  lines.push(`  Type:      ${orDash(ssl?.type)} (method ${orDash(ssl?.method)})`);
  lines.push(`  Authority: ${orDash(ssl?.certificate_authority)}`);
  lines.push(`  Hosts:     ${ssl?.hosts?.join(", ") ?? "-"}`);
  lines.push(`  Issuer:    ${orDash(ssl?.issuer)}`);
  lines.push(`  Expires:   ${orDash(ssl?.expires_on)}`);
  lines.push(`  Wildcard:  ${orDash(ssl?.wildcard)}`);

  const validationErrors = ssl?.validation_errors ?? [];
  if (validationErrors.length > 0) {
    lines.push("  Validation errors:");
    for (const error of validationErrors) {
      lines.push(`    - ${orDash(error.message)}`);
    }
  }

  const validationRecords = ssl?.validation_records ?? [];
  if (validationRecords.length > 0) {
    lines.push("  Validation records (certificate issuance):");
    for (const record of validationRecords) {
      if (record.txt_name) {
        lines.push(`    - TXT ${record.txt_name} = ${orDash(record.txt_value)}`);
      }
      if (record.http_url) {
        lines.push(`    - HTTP ${record.http_url} body=${orDash(record.http_body)}`);
      }
      if (record.cname) {
        lines.push(`    - CNAME ${record.cname} -> ${orDash(record.cname_target)}`);
      }
      if (record.emails && record.emails.length > 0) {
        lines.push(`    - Emails ${record.emails.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push("Hostname ownership");
  const verificationErrors = hostname.verification_errors ?? [];
  if (verificationErrors.length > 0) {
    lines.push("  Verification errors:");
    for (const error of verificationErrors) {
      lines.push(`    - ${error}`);
    }
  }
  const ownership = hostname.ownership_verification;
  if (ownership?.name) {
    lines.push(
      `  ${(ownership.type ?? "txt").toUpperCase()} ${ownership.name} = ${orDash(ownership.value)}`
    );
  }
  const ownershipHttp = hostname.ownership_verification_http;
  if (ownershipHttp?.http_url) {
    lines.push(
      `  HTTP ${ownershipHttp.http_url} body=${orDash(ownershipHttp.http_body)}`
    );
  }
  if (verificationErrors.length === 0 && !ownership?.name && !ownershipHttp?.http_url) {
    lines.push("  Verified (no outstanding ownership challenges).");
  }

  lines.push("");
  lines.push(
    isReady(hostname)
      ? "Ready for production traffic (status=active, ssl.status=active), provided DNS points at your SaaS target."
      : `Not ready: production traffic needs status=active and ssl.status=active (currently ${orDash(hostname.status)} / ${orDash(ssl?.status)}).`
  );

  return lines.join("\n");
}

export async function runGetCustomHostname(
  customHostnameId: string,
  flags: CustomHostnamesGetFlags,
  deps: CustomHostnamesDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const hostname = await client.getCustomHostname(customHostnameId, flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(hostname, null, 2));
      return;
    }

    deps.log(formatCustomHostnameDetails(hostname));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const getCustomHostnameCommand = buildCommand({
  docs: {
    brief: "Show certificate and validation state for one custom hostname",
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
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Custom hostname ID (find it with `custom-hostnames list`)",
          parse: String,
          placeholder: "custom-hostname-id",
        },
      ],
    },
  },
  async func(this: void, flags: CustomHostnamesGetFlags, customHostnameId: string) {
    await runGetCustomHostname(customHostnameId, flags);
  },
});
