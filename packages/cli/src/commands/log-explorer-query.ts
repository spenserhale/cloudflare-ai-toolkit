import { readFileSync } from "node:fs";
import { buildCommand } from "@stricli/core";
import { encode } from "@toon-format/toon";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type LogExplorerScope,
  type QueryLogExplorerResult,
} from "@cloudflare-ai-toolkit/sdk";

export interface LogExplorerQueryFlags {
  readonly sql?: string;
  readonly file?: string;
  readonly stdin: boolean;
  readonly scope?: LogExplorerScope;
  readonly accountId?: string;
  readonly zoneId?: string;
  readonly json: boolean;
}

function parseScope(value: string): LogExplorerScope {
  if (value !== "account" && value !== "zone") {
    throw new Error(`Scope must be 'account' or 'zone', got '${value}'`);
  }
  return value;
}

interface LogExplorerQueryDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    "queryLogExplorer"
  >;
  readonly readFile: (path: string) => string;
  readonly readStdin: () => Promise<string>;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

async function readStdinDefault(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

const defaultDeps: LogExplorerQueryDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  readFile: (path) => readFileSync(path, "utf8"),
  readStdin: readStdinDefault,
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};

interface ZodLikeIssue {
  readonly path?: readonly unknown[];
  readonly message?: string;
}

function isZodError(err: unknown): err is { name: "ZodError"; issues?: readonly ZodLikeIssue[] } {
  return Boolean(
    err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "ZodError"
  );
}

function formatPermissionHint(err: unknown): string | undefined {
  if (!(err instanceof CloudflareError)) return undefined;
  if (!err.requiredPermissions || err.requiredPermissions.length === 0) return undefined;
  const clause =
    err.requiredPermissions.length === 1
      ? `'${err.requiredPermissions[0]}'`
      : err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
  const docs = err.docsUrl ? ` Docs: ${err.docsUrl}` : "";
  return `Required permission for this endpoint: ${clause}.${docs}`;
}

function formatError(err: unknown): string {
  if (isZodError(err)) {
    const issues = Array.isArray(err.issues) ? err.issues : [];
    const configIssue = issues.some((issue) => {
      const first = issue.path?.[0];
      return first === "auth" || first === "baseUrl";
    });
    if (configIssue) {
      return (
        "Invalid Cloudflare configuration. Set CLOUDFLARE_API_TOKEN, or set both CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL (or CLOUDFLARE_API_EMAIL)."
      );
    }
    const first = issues[0];
    const path = first?.path && first.path.length > 0 ? first.path.join(".") : "unknown";
    return `Unexpected Cloudflare API response shape (${path}): ${first?.message ?? "validation failed"}`;
  }

  const base =
    err instanceof CloudflareAuthError
      ? `Authentication failed: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  const hint = formatPermissionHint(err);
  return hint ? `${base}\n${hint}` : base;
}

async function resolveSql(
  flags: LogExplorerQueryFlags,
  deps: LogExplorerQueryDeps
): Promise<string> {
  const sources = [flags.sql, flags.file, flags.stdin ? "stdin" : undefined].filter(
    (s) => s !== undefined
  );
  if (sources.length === 0) {
    throw new Error(
      "Provide SQL via --sql <query>, --file <path>, or --stdin."
    );
  }
  if (sources.length > 1) {
    throw new Error("Pass SQL via exactly one of: --sql <query>, --file <path>, or --stdin.");
  }

  let sql: string;
  if (flags.sql !== undefined) {
    sql = flags.sql;
  } else if (flags.file !== undefined) {
    sql = deps.readFile(flags.file);
  } else {
    sql = await deps.readStdin();
  }

  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    throw new Error("SQL query is empty.");
  }
  return trimmed;
}

function renderRows(result: QueryLogExplorerResult): string {
  return encode({ rows: result.rows }, { keyFolding: "safe" });
}

export async function runLogExplorerQuery(
  flags: LogExplorerQueryFlags,
  deps: LogExplorerQueryDeps = defaultDeps
): Promise<void> {
  try {
    const sql = await resolveSql(flags, deps);
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.queryLogExplorer(
      { sql, scope: flags.scope },
      { accountId: flags.accountId, zoneId: flags.zoneId }
    );

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }
    deps.log(renderRows(result));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const logExplorerQueryCommand = buildCommand({
  docs: {
    brief: "Run a SQL query against Cloudflare Log Explorer",
  },
  parameters: {
    flags: {
      sql: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "SQL query string (alternatives: --file, --stdin)",
      },
      file: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Read SQL from a file",
      },
      stdin: {
        kind: "boolean",
        brief: "Read SQL from stdin",
        default: false,
      },
      scope: {
        kind: "parsed",
        parse: parseScope,
        optional: true,
        brief: "Query scope (account|zone). Defaults to zone if CLOUDFLARE_ZONE_ID is set, else account.",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Override CLOUDFLARE_ACCOUNT_ID",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Override CLOUDFLARE_ZONE_ID",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: LogExplorerQueryFlags) {
    await runLogExplorerQuery(flags);
  },
});
