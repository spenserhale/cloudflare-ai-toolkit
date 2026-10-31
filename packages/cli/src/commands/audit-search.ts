import { buildCommand } from "@stricli/core";
import { encode } from "@toon-format/toon";
import {
  AUDIT_LOG_FILTER_FIELDS,
  AuditFacetCounter,
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  DAY_MS,
  DEFAULT_AUDIT_FACETS,
  DEFAULT_AUDIT_FIELDS,
  WEEK_MS,
  buildAuditLogPredicate,
  diagnoseEmptyAuditSearch,
  formatAuditFieldValue,
  parseAuditTime,
  parseAuditWhere,
  pickAuditFields,
  resolveAuditRange,
  resolveConfig,
  searchAuditLogs,
  type AuditLog,
  type AuditLogFilterField,
  type AuditLogFilters,
  type AuditSearchProgress,
  type AuditWhereClause,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared filter flags
// ---------------------------------------------------------------------------

export interface AuditFilterFlags {
  readonly accountId?: string;
  readonly since: string;
  readonly before?: string;
  readonly product?: readonly string[];
  readonly excludeProduct?: readonly string[];
  readonly includePurge: boolean;
  readonly resourceType?: readonly string[];
  readonly resourceId?: readonly string[];
  readonly zone?: readonly string[];
  readonly zoneId?: readonly string[];
  readonly actor?: readonly string[];
  readonly actorId?: readonly string[];
  readonly actorContext?: readonly string[];
  readonly action?: readonly string[];
  readonly excludeAction?: readonly string[];
  readonly result?: string;
  readonly method?: readonly string[];
  readonly status?: readonly string[];
  readonly uri?: readonly string[];
  readonly rayId?: readonly string[];
  readonly filter?: readonly string[];
  readonly match?: string;
  readonly where?: readonly AuditWhereClause[];
  readonly window: string;
  readonly concurrency: number;
  readonly quiet: boolean;
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

function parseTime(value: string): string {
  parseAuditTime(value);
  return value;
}

function parseNonEmpty(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error("Value cannot be empty");
  return trimmed;
}

function parseRegex(value: string): string {
  new RegExp(value, "iu");
  return value;
}

function parseWindow(value: string): string {
  resolveWindowMs(value);
  return value;
}

/**
 * `auto` picks week windows when an include filter narrows the result set
 * (few pages per window, so fewer requests wins) and day windows otherwise
 * (dense ranges page faster when split finer). Measured on a ~5k events/day
 * account: filtered 7-month search 1.6s week vs 7.4s day; unfiltered 14 days
 * 4.7s day vs 12.9s week vs 25s unsplit.
 */
export function resolveWindowMs(
  value: string,
  filters: AuditLogFilters = {}
): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto") {
    const narrowed = Object.values(filters).some((entry) => (entry?.in?.length ?? 0) > 0);
    return narrowed ? WEEK_MS : DAY_MS;
  }
  if (normalized === "none") return undefined;
  if (normalized === "hour") return DAY_MS / 24;
  if (normalized === "day") return DAY_MS;
  if (normalized === "week") return WEEK_MS;
  const relative = /^(\d+)([hdw])$/u.exec(normalized);
  if (relative && Number(relative[1]) > 0) {
    // parseAuditTime turns a duration into "that long before now".
    return 0 - parseAuditTime(normalized, 0);
  }
  throw new Error(`Invalid --window '${value}'. Use auto, hour, day, week, none, or e.g. 6h, 3d.`);
}

interface GenericFilter {
  readonly field: AuditLogFilterField;
  readonly negate: boolean;
  readonly value: string;
}

export function parseGenericFilter(expression: string): GenericFilter {
  const match = /^([a-z_]+)\s*(!=|=)\s*(.+)$/u.exec(expression.trim());
  const field = match?.[1] as AuditLogFilterField | undefined;
  if (!match || !field || !AUDIT_LOG_FILTER_FIELDS.includes(field)) {
    throw new Error(
      `Invalid --filter '${expression}'. Use field=value or field!=value where field is one of: ` +
        AUDIT_LOG_FILTER_FIELDS.join(", ")
    );
  }
  return { field, negate: match[2] === "!=", value: match[3]!.trim() };
}

/** Maps CLI flags onto the API's server-side filter fields. */
export function buildAuditFilters(flags: AuditFilterFlags): AuditLogFilters {
  const filters: Partial<Record<AuditLogFilterField, { in: string[]; not: string[] }>> = {};
  const add = (field: AuditLogFilterField, values: readonly string[] | undefined, negate = false) => {
    if (!values || values.length === 0) return;
    const entry = (filters[field] ??= { in: [], not: [] });
    (negate ? entry.not : entry.in).push(...values);
  };

  add("resource_product", flags.product);
  add("resource_product", flags.excludeProduct, true);
  add("resource_type", flags.resourceType);
  add("resource_id", flags.resourceId);
  add("zone_name", flags.zone);
  add("zone_id", flags.zoneId);
  add("actor_email", flags.actor);
  add("actor_id", flags.actorId);
  add("actor_context", flags.actorContext);
  add("action_type", flags.action);
  add("action_type", flags.excludeAction, true);
  add("action_result", flags.result ? [flags.result] : undefined);
  add("raw_method", flags.method?.map((method) => method.toUpperCase()));
  add("raw_status_code", flags.status);
  add("raw_uri", flags.uri);
  add("raw_cf_ray_id", flags.rayId);
  for (const expression of flags.filter ?? []) {
    const parsed = parseGenericFilter(expression);
    add(parsed.field, [parsed.value], parsed.negate);
  }

  // Cache purges are most of the volume on a typical account and almost never
  // what a search is after, so exclude them unless asked for.
  const wantsPurge =
    flags.includePurge || filters.resource_product?.in.includes("purge_cache") === true;
  if (!wantsPurge) add("resource_product", ["purge_cache"], true);

  return filters;
}

const multi = (brief: string) =>
  ({ kind: "parsed", parse: parseNonEmpty, variadic: true, optional: true, brief }) as const;

export const auditFilterFlagParameters = {
  accountId: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Cloudflare account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
  },
  since: {
    kind: "parsed",
    parse: parseTime,
    brief: "Start: ISO-8601, YYYY-MM-DD, or relative (7d, 24h, 2w). Clamped to 18-month retention",
    default: "7d",
  },
  before: {
    kind: "parsed",
    parse: parseTime,
    optional: true,
    brief: "End (exclusive): same formats as --since. Defaults to now",
  },
  product: multi("resource.product to include, e.g. custom_hostnames, dns_records; repeatable"),
  excludeProduct: multi("resource.product to exclude; repeatable"),
  includePurge: {
    kind: "boolean",
    brief: "Keep purge_cache events (excluded by default)",
    default: false,
  },
  resourceType: multi("resource.type to include, e.g. record; often empty, prefer --product"),
  resourceId: multi("resource.id to include; repeatable"),
  zone: multi("zone.name to include; repeatable"),
  zoneId: multi("zone.id to include; repeatable"),
  actor: multi("actor.email to include; repeatable"),
  actorId: multi("actor.id to include; repeatable"),
  actorContext: multi("actor.context: api, api_key, api_token, dash, oauth, origin_ca_key"),
  action: multi("action.type: create, view, update, delete; repeatable"),
  excludeAction: multi("action.type to exclude, e.g. view; repeatable"),
  result: {
    kind: "parsed",
    parse: parseNonEmpty,
    optional: true,
    brief: "action.result: success or failure",
  },
  method: multi("raw.method (HTTP method); repeatable"),
  status: multi("raw.status_code; repeatable"),
  uri: multi("raw.uri (exact path); repeatable"),
  rayId: multi("raw.cf_ray_id; repeatable"),
  filter: multi("Any server-side filter as field=value or field!=value (API field names)"),
  match: {
    kind: "parsed",
    parse: parseRegex,
    optional: true,
    brief: "Client-side regex over the whole event JSON (case-insensitive)",
  },
  where: {
    kind: "parsed",
    parse: parseAuditWhere,
    variadic: true,
    optional: true,
    brief: "Client-side field=value, field!=value, or field~regex on any dot path; repeatable",
  },
  window: {
    kind: "parsed",
    parse: parseWindow,
    brief: "Split the range into windows queried in parallel (auto|hour|day|week|none|6h|3d)",
    default: "auto",
  },
  concurrency: {
    kind: "parsed",
    parse: parsePositiveInt,
    brief: "Windows to query at once",
    default: "8",
  },
  quiet: {
    kind: "boolean",
    brief: "No progress or summary on stderr",
    default: false,
  },
} as const;

// ---------------------------------------------------------------------------
// Runtime plumbing
// ---------------------------------------------------------------------------

export interface AuditSearchDeps {
  readonly resolveConfig: () => ConstructorParameters<typeof CloudflareClient>[0];
  readonly createClient: (
    config: ConstructorParameters<typeof CloudflareClient>[0]
  ) => Pick<CloudflareClient, "listAuditLogs">;
  /** Writes to stdout. Returns false if the reader went away. */
  readonly write: (text: string) => boolean;
  /** Writes to stderr. */
  readonly writeErr: (text: string) => void;
  readonly isErrTTY: boolean;
  readonly exit: (code: number) => never;
  /** Registers a Ctrl-C handler; returns an unregister function. */
  readonly onInterrupt: (handler: () => void) => () => void;
  readonly now: () => number;
}

function createDefaultDeps(): AuditSearchDeps {
  let stdoutClosed = false;
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") stdoutClosed = true;
    else throw err;
  });
  return {
    resolveConfig,
    createClient: (config) => new CloudflareClient(config),
    write: (text) => {
      if (stdoutClosed) return false;
      process.stdout.write(text);
      return !stdoutClosed;
    },
    writeErr: (text) => {
      process.stderr.write(text);
    },
    isErrTTY: Boolean(process.stderr.isTTY),
    exit: (code) => process.exit(code),
    onInterrupt: (handler) => {
      process.once("SIGINT", handler);
      return () => process.off("SIGINT", handler);
    },
    now: () => Date.now(),
  };
}

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

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

export function formatProgress(progress: AuditSearchProgress): string {
  const parts = [
    `${progress.windowsDone}/${progress.windowsTotal} windows`,
    `${progress.pages} pages`,
    `${progress.scanned} scanned`,
    `${progress.matched} matched`,
  ];
  if (progress.currentTime) parts.push(`at ${progress.currentTime.slice(0, 10)}`);
  if (progress.retries > 0) parts.push(`${progress.retries} retries`);
  parts.push(formatDuration(progress.elapsedMs));
  if (progress.windowsDone > 0 && progress.windowsDone < progress.windowsTotal) {
    const remaining =
      (progress.elapsedMs / progress.windowsDone) * (progress.windowsTotal - progress.windowsDone);
    parts.push(`~${formatDuration(remaining)} left`);
  }
  return parts.join(", ");
}

/** Renders progress on stderr: a live line on a TTY, a periodic line otherwise. */
function createProgressReporter(deps: AuditSearchDeps, quiet: boolean) {
  let last = 0;
  let lastText = "";
  let drawn = false;
  const intervalMs = deps.isErrTTY ? 200 : 10_000;
  return {
    update(progress: AuditSearchProgress) {
      if (quiet) return;
      const now = deps.now();
      if (now - last < intervalMs) return;
      last = now;
      lastText = formatProgress(progress);
      if (deps.isErrTTY) {
        deps.writeErr(`\r\x1b[2K${lastText}`);
        drawn = true;
      } else {
        deps.writeErr(`${lastText}\n`);
      }
    },
    clear() {
      if (drawn) deps.writeErr("\r\x1b[2K");
      drawn = false;
    },
  };
}

interface SearchRun {
  readonly matched: number;
  readonly interrupted: boolean;
  readonly sinceMs: number;
  readonly beforeMs: number;
  readonly filters: AuditLogFilters;
  readonly last?: AuditSearchProgress;
}

/** Shared driver: runs the search, wiring progress, warnings, and Ctrl-C. */
async function runSearch(
  flags: AuditFilterFlags,
  deps: AuditSearchDeps,
  client: Pick<CloudflareClient, "listAuditLogs">,
  options: {
    readonly direction: "asc" | "desc";
    readonly maxResults?: number;
    readonly onEvent: (log: AuditLog) => boolean | void;
  }
): Promise<SearchRun> {
  const now = deps.now();
  const range = resolveAuditRange(flags.since, flags.before, now);
  for (const warning of range.warnings) deps.writeErr(`Warning: ${warning}\n`);
  const filters = buildAuditFilters(flags);
  const predicate = buildAuditLogPredicate({ match: flags.match, where: flags.where });
  const progress = createProgressReporter(deps, flags.quiet);
  const controller = new AbortController();
  let interrupted = false;
  const unregister = deps.onInterrupt(() => {
    interrupted = true;
    controller.abort();
  });

  let matched = 0;
  let last: AuditSearchProgress | undefined;
  try {
    for await (const log of searchAuditLogs(client, {
      accountId: flags.accountId,
      since: range.sinceMs,
      before: range.beforeMs,
      direction: options.direction,
      filters,
      predicate,
      maxResults: options.maxResults,
      windowMs: resolveWindowMs(flags.window, filters),
      concurrency: flags.concurrency,
      signal: controller.signal,
      now,
      onWarning: (message) => {
        progress.clear();
        deps.writeErr(`Warning: ${message}\n`);
      },
      onProgress: (p) => {
        last = p;
        progress.update(p);
      },
    })) {
      matched++;
      if (options.onEvent(log) === false) {
        controller.abort();
        break;
      }
    }
  } finally {
    progress.clear();
    unregister();
  }
  return { matched, interrupted, sinceMs: range.sinceMs, beforeMs: range.beforeMs, filters, last };
}

async function reportSummary(
  run: SearchRun,
  flags: AuditFilterFlags,
  deps: AuditSearchDeps,
  client: Pick<CloudflareClient, "listAuditLogs">
): Promise<void> {
  if (run.interrupted) {
    deps.writeErr(`Interrupted; kept ${run.matched} events already written.\n`);
    deps.exit(130);
    return;
  }
  if (!flags.quiet && run.last) {
    deps.writeErr(
      `${run.matched} events matched (scanned ${run.last.scanned} across ${run.last.pages} pages in ` +
        `${formatDuration(run.last.elapsedMs)}).\n`
    );
  }
  if (run.matched > 0) return;
  try {
    const hints = await diagnoseEmptyAuditSearch(client, {
      accountId: flags.accountId,
      filters: run.filters,
      sinceMs: run.sinceMs,
      beforeMs: run.beforeMs,
      now: deps.now(),
    });
    for (const hint of hints) deps.writeErr(`Hint: ${hint}\n`);
  } catch {
    // Diagnostics are best effort; the empty result already stands.
  }
}

// ---------------------------------------------------------------------------
// audit logs search
// ---------------------------------------------------------------------------

const OUTPUT_FORMATS = ["ndjson", "tsv", "json", "toon"] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface AuditSearchFlags extends AuditFilterFlags {
  readonly direction: "asc" | "desc";
  readonly first: boolean;
  readonly maxResults?: number;
  readonly format: OutputFormat;
  readonly fields?: string;
}

function parseFormat(value: string): OutputFormat {
  if (!OUTPUT_FORMATS.includes(value as OutputFormat)) {
    throw new Error(`Invalid --format '${value}'. Use ${OUTPUT_FORMATS.join(", ")}.`);
  }
  return value as OutputFormat;
}

function parseDirection(value: string): "asc" | "desc" {
  if (value !== "asc" && value !== "desc") {
    throw new Error(`Direction must be 'asc' or 'desc', got '${value}'`);
  }
  return value;
}

function parseFields(value: string): string {
  if (value.split(",").every((field) => field.trim().length === 0)) {
    throw new Error("--fields needs at least one field");
  }
  return value;
}

function tsvCell(value: unknown): string {
  return formatAuditFieldValue(value).replace(/[\t\r\n]+/gu, " ");
}

export async function runAuditLogsSearch(
  flags: AuditSearchFlags,
  deps: AuditSearchDeps = createDefaultDeps()
): Promise<void> {
  let client: Pick<CloudflareClient, "listAuditLogs">;
  try {
    client = deps.createClient(deps.resolveConfig());
  } catch (err) {
    deps.writeErr(`Error: ${formatError(err)}\n`);
    return deps.exit(1);
  }

  const fields = flags.fields
    ? flags.fields.split(",").map((field) => field.trim()).filter(Boolean)
    : undefined;
  const tableFields = fields ?? [...DEFAULT_AUDIT_FIELDS];
  const buffered: Array<Record<string, unknown> | AuditLog> = [];

  if (flags.format === "tsv") deps.write(`${tableFields.join("\t")}\n`);

  const onEvent = (log: AuditLog): boolean => {
    switch (flags.format) {
      case "ndjson":
        return deps.write(`${JSON.stringify(fields ? pickAuditFields(log, fields) : log)}\n`);
      case "tsv":
        return deps.write(
          `${tableFields.map((field) => tsvCell(pickAuditFields(log, [field])[field])).join("\t")}\n`
        );
      case "json":
        buffered.push(fields ? pickAuditFields(log, fields) : log);
        return true;
      case "toon":
        buffered.push(pickAuditFields(log, tableFields));
        return true;
    }
  };

  let run: SearchRun | undefined;
  let failure: unknown;
  try {
    run = await runSearch(flags, deps, client, {
      direction: flags.direction,
      maxResults: flags.first ? 1 : flags.maxResults,
      onEvent,
    });
  } catch (err) {
    failure = err;
  }

  // Buffered formats still flush whatever arrived before an error or Ctrl-C.
  if (flags.format === "json") deps.write(`${JSON.stringify(buffered, null, 2)}\n`);
  if (flags.format === "toon") {
    deps.write(`${encode({ events: buffered }, { keyFolding: "safe" })}\n`);
  }

  if (failure !== undefined) {
    deps.writeErr(`Error: ${formatError(failure)}\n`);
    return deps.exit(1);
  }
  await reportSummary(run!, flags, deps, client);
}

export const searchAuditLogsCommand = buildCommand({
  docs: {
    brief: "Search audit logs across all pages, streaming matches as they arrive",
    fullDescription:
      "Follows pagination automatically and splits the time range into windows queried in " +
      "parallel. Matches stream to stdout (NDJSON by default) so an interrupted run keeps " +
      "what it already printed; progress goes to stderr. purge_cache events are excluded " +
      "unless --include-purge or --product purge_cache is given.\n\n" +
      "Examples:\n" +
      "  cloudflare audit logs search --since 2026-03-01 --product custom_hostnames --action create\n" +
      "  cloudflare audit logs search --since 30d --direction asc --first --match www.example.com\n" +
      "  cloudflare audit logs search --since 7d --format tsv --fields time,actor,action,product,uri",
  },
  parameters: {
    flags: {
      ...auditFilterFlagParameters,
      direction: {
        kind: "parsed",
        parse: parseDirection,
        brief: "Sort order (asc = oldest first)",
        default: "desc",
      },
      first: {
        kind: "boolean",
        brief: "Stop after the first match (with --direction asc: the earliest)",
        default: false,
      },
      maxResults: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Stop after this many matches",
      },
      format: {
        kind: "parsed",
        parse: parseFormat,
        brief: "Output: ndjson|tsv (streamed), json|toon (buffered)",
        default: "ndjson",
      },
      fields: {
        kind: "parsed",
        parse: parseFields,
        optional: true,
        brief:
          "Comma-separated fields: dot paths or time, actor, action, description, product, type, resource_id, zone, method, status, uri, ip, ray",
      },
    },
  },
  async func(this: void, flags: AuditSearchFlags) {
    await runAuditLogsSearch(flags);
  },
});

// ---------------------------------------------------------------------------
// audit logs facets
// ---------------------------------------------------------------------------

export interface AuditFacetsFlags extends AuditFilterFlags {
  readonly facets?: string;
  readonly top: number;
  readonly json: boolean;
}

export async function runAuditLogsFacets(
  flags: AuditFacetsFlags,
  deps: AuditSearchDeps = createDefaultDeps()
): Promise<void> {
  let client: Pick<CloudflareClient, "listAuditLogs">;
  try {
    client = deps.createClient(deps.resolveConfig());
  } catch (err) {
    deps.writeErr(`Error: ${formatError(err)}\n`);
    return deps.exit(1);
  }

  const facetFields = flags.facets
    ? flags.facets.split(",").map((field) => field.trim()).filter(Boolean)
    : [...DEFAULT_AUDIT_FACETS];
  const counter = new AuditFacetCounter(facetFields);

  let run: SearchRun | undefined;
  let failure: unknown;
  try {
    run = await runSearch(flags, deps, client, {
      direction: "desc",
      onEvent: (log) => counter.add(log),
    });
  } catch (err) {
    failure = err;
  }

  const result = { total: counter.total, facets: counter.result(flags.top) };
  if (flags.json) {
    deps.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    deps.write(`${encode(result, { keyFolding: "safe" })}\n`);
  }

  if (failure !== undefined) {
    deps.writeErr(`Error: ${formatError(failure)}\n`);
    return deps.exit(1);
  }
  await reportSummary(run!, flags, deps, client);
}

export const auditLogFacetsCommand = buildCommand({
  docs: {
    brief: "Count events by product, type, action, actor, and zone to find filter values",
    fullDescription:
      "Scans the range with the same filters as `audit logs search` and counts distinct " +
      "values per field, so you can see which --product or --resource-type values exist " +
      "before searching.\n\nExample:\n  cloudflare audit logs facets --since 7d",
  },
  parameters: {
    flags: {
      ...auditFilterFlagParameters,
      facets: {
        kind: "parsed",
        parse: parseFields,
        optional: true,
        brief: `Comma-separated fields to count (default: ${DEFAULT_AUDIT_FACETS.join(",")})`,
      },
      top: {
        kind: "parsed",
        parse: parsePositiveInt,
        brief: "Values to show per field",
        default: "20",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: AuditFacetsFlags) {
    await runAuditLogsFacets(flags);
  },
});
