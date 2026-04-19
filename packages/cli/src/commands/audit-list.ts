import { buildCommand } from "@stricli/core";
import { encode } from "@toon-format/toon";
import {
  CloudflareAuthError,
  CloudflareError,
  CloudflareClient,
  resolveConfig,
  toAuditLogTable,
  type AuditLog,
  type TokenVerificationResult,
} from "@cloudflare-ai-toolkit/sdk";

const allowedActionTypes = ["create", "view", "update", "delete"] as const;
type AuditActionType = (typeof allowedActionTypes)[number];

export interface AuditListFlags {
  readonly accountId?: string;
  readonly since?: string;
  readonly before?: string;
  readonly actorEmail?: string;
  readonly actorId?: string;
  readonly actionType?: AuditActionType;
  readonly actionResult?: string;
  readonly resourceType?: string;
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

function parseActionType(value: string): AuditActionType {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error("Action type cannot be empty");
  }

  if (!allowedActionTypes.includes(normalized as AuditActionType)) {
    throw new Error(
      `Invalid action type '${value}'. Valid values: create, view, update, delete.`
    );
  }

  return normalized as AuditActionType;
}

function parseResourceType(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("Resource type cannot be empty");
  }
  return normalized;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeResourceType(value: string): string {
  return value.trim().toLowerCase().replace(/[\s.-]+/g, "_");
}

function resolveLogResourceType(log: AuditLog): string | undefined {
  const root = readRecord(log);
  const resource = readRecord(root?.resource);

  return (
    readString(resource?.type) ??
    readString(resource?.product) ??
    readString(root?.resource_type) ??
    readString(root?.ResourceType) ??
    readString(root?.resource_product) ??
    readString(root?.ResourceProduct)
  );
}

function filterAuditLogsByResourceType(
  logs: readonly AuditLog[],
  requestedResourceType: string
): readonly AuditLog[] {
  const expected = normalizeResourceType(requestedResourceType);
  return logs.filter((log) => {
    const resourceType = resolveLogResourceType(log);
    if (!resourceType) return false;
    return normalizeResourceType(resourceType) === expected;
  });
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

export function resolveDateRange(flags: AuditListFlags): { since: string; before: string } {
  const before = flags.before ?? new Date().toISOString();
  const beforeMs = Date.parse(before);
  const since =
    flags.since ?? new Date(beforeMs - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceMs = Date.parse(since);

  if (sinceMs > beforeMs) {
    throw new Error(
      `Invalid date range: --since (${since}) must be before --before (${before})`
    );
  }

  return { since, before };
}

interface AuditListDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    "listAuditLogs" | "verifyToken" | "getAuthType"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: AuditListDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};

function isCloudflareAuthError(err: unknown): boolean {
  return (
    err instanceof CloudflareAuthError ||
    (typeof err === "object" &&
      err !== null &&
      "name" in err &&
      (err as { name?: string }).name === "CloudflareAuthError")
  );
}

function isLikelyAuthFailure(err: unknown): boolean {
  if (isCloudflareAuthError(err)) return true;

  if (err instanceof CloudflareError) {
    return (
      err.statusCode === 401 ||
      err.statusCode === 403 ||
      /authentication/iu.test(err.message)
    );
  }

  if (typeof err === "object" && err !== null && "name" in err) {
    const named = err as { name?: string; statusCode?: number; message?: string };
    if (named.name !== "CloudflareError") return false;
    return (
      named.statusCode === 401 ||
      named.statusCode === 403 ||
      (typeof named.message === "string" && /authentication/iu.test(named.message))
    );
  }

  return false;
}

interface ZodLikeIssue {
  readonly path?: readonly unknown[];
  readonly message?: string;
}

type ZodLikeError = {
  readonly name: "ZodError";
  readonly issues?: readonly unknown[];
};

function isZodError(err: unknown): err is ZodLikeError {
  return Boolean(
    err &&
      typeof err === "object" &&
      "name" in err &&
      err.name === "ZodError"
  );
}

function readZodIssues(err: unknown): readonly ZodLikeIssue[] | undefined {
  if (!isZodError(err)) return undefined;
  if (!("issues" in err) || !Array.isArray(err.issues)) return undefined;
  return err.issues as readonly ZodLikeIssue[];
}

function formatConfigValidationError(): string {
  return (
    "Invalid Cloudflare configuration. " +
    "Set CLOUDFLARE_API_TOKEN, or set both CLOUDFLARE_API_KEY and " +
    "CLOUDFLARE_EMAIL (or CLOUDFLARE_API_EMAIL)."
  );
}

function formatZodValidationError(issues: readonly ZodLikeIssue[]): string {
  const hasConfigIssue = issues.some((issue) => {
    const firstPath = issue.path?.[0];
    return (
      firstPath === "auth" ||
      firstPath === "baseUrl" ||
      firstPath === "accountId"
    );
  });

  if (hasConfigIssue) {
    return formatConfigValidationError();
  }

  const firstIssue = issues[0];
  const path =
    firstIssue?.path && firstIssue.path.length > 0
      ? firstIssue.path.join(".")
      : "unknown";
  const message = firstIssue?.message ?? "validation failed";

  return `Unexpected Cloudflare API response shape (${path}): ${message}`;
}

function formatPermissionHint(err: unknown): string | undefined {
  if (!(err instanceof CloudflareError)) return undefined;
  if (!err.requiredPermissions || err.requiredPermissions.length === 0) return undefined;

  const permissionClause =
    err.requiredPermissions.length === 1
      ? `'${err.requiredPermissions[0]}'`
      : err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
  const docsClause = err.docsUrl ? ` Docs: ${err.docsUrl}` : "";

  return `Required permission for this endpoint: ${permissionClause}.${docsClause}`;
}

function formatTokenVerifyResult(result: TokenVerificationResult): string {
  if (result.status.toLowerCase() === "active") {
    return (
      "Token verification succeeded via /client/v4/user/tokens/verify, " +
      "so the token is valid. The audit log request likely lacks required " +
      "token permissions or account access. Ensure the token can read audit logs " +
      "for the target account."
    );
  }

  return (
    `Token verification returned status '${result.status}' via ` +
    "/client/v4/user/tokens/verify. The token may be inactive or expired."
  );
}

async function diagnoseAuthFailure(
  err: unknown,
  client: Pick<CloudflareClient, "verifyToken" | "getAuthType"> | undefined
): Promise<string | undefined> {
  if (!isLikelyAuthFailure(err) || !client) return undefined;
  if (client.getAuthType() !== "apiToken") {
    return (
      "Token verification was skipped because this request used legacy Global API Key auth " +
      "(X-Auth-Key/X-Auth-Email), not API token auth."
    );
  }

  try {
    const verified = await client.verifyToken();
    return formatTokenVerifyResult(verified);
  } catch (verifyErr) {
    if (isLikelyAuthFailure(verifyErr)) {
      return (
        "Token verification via /client/v4/user/tokens/verify also failed with " +
        "authentication. The token is invalid, revoked, or malformed."
      );
    }

    return (
      "Authentication failed and token verification could not be completed: " +
      (verifyErr instanceof Error ? verifyErr.message : String(verifyErr))
    );
  }
}

function formatAuditError(err: unknown, authDiagnostic?: string): string {
  if (isZodError(err)) {
    const zodIssues = readZodIssues(err);
    if (!zodIssues || zodIssues.length === 0) {
      return formatConfigValidationError();
    }
    return formatZodValidationError(zodIssues);
  }
  const base = err instanceof Error ? err.message : String(err);
  const permissionHint = formatPermissionHint(err);
  const details = [authDiagnostic, permissionHint].filter(
    (value): value is string => Boolean(value && value.length > 0)
  );
  if (details.length === 0) return base;
  return `${base}\n${details.join("\n")}`;
}

function renderAuditLogsToon(logs: readonly AuditLog[], nextCursor?: string): string {
  return encode(
    {
      ...toAuditLogTable(logs),
      nextCursor: nextCursor ?? null,
    },
    { keyFolding: "safe" }
  );
}

export async function runAuditLogsList(
  flags: AuditListFlags,
  deps: AuditListDeps = defaultDeps
): Promise<void> {
  let client: Pick<CloudflareClient, "listAuditLogs" | "verifyToken" | "getAuthType"> | undefined;
  try {
    const config = deps.resolveConfig();
    client = deps.createClient(config);
    const { since, before } = resolveDateRange(flags);
    const result = await client.listAuditLogs(
      {
        since,
        before,
        actorEmail: flags.actorEmail,
        actorId: flags.actorId,
        actionType: flags.actionType,
        actionResult: flags.actionResult,
        resourceType: flags.resourceType,
        cursor: flags.cursor,
        limit: flags.limit,
        direction: flags.direction,
      },
      flags.accountId
    );
    const filteredData = flags.resourceType
      ? filterAuditLogsByResourceType(result.data, flags.resourceType)
      : result.data;
    const output = {
      ...result,
      data: filteredData,
    };

    if (flags.json) {
      deps.log(JSON.stringify(output, null, 2));
      return;
    }

    deps.log(renderAuditLogsToon(output.data, output.pagination?.cursor));
  } catch (err) {
    const authDiagnostic = await diagnoseAuthFailure(err, client);
    deps.error(`Error: ${formatAuditError(err, authDiagnostic)}`);
    deps.exit(1);
  }
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
        optional: true,
        brief: "Start datetime (ISO-8601)",
      },
      before: {
        kind: "parsed",
        parse: parseIsoDate,
        optional: true,
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
        parse: parseActionType,
        optional: true,
        brief: "Filter by action type",
      },
      actionResult: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by action result",
      },
      resourceType: {
        kind: "parsed",
        parse: parseResourceType,
        optional: true,
        brief: "Filter by resource type (for example dns_records)",
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
    await runAuditLogsList(flags);
  },
});
