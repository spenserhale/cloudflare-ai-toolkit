import type { CloudflareClient } from "./client.js";
import { CloudflareError } from "./errors.js";
import type { AuditLog, ListAuditLogsParams } from "./types.js";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Server-side filter fields accepted by `GET /accounts/{id}/logs/audit`, using
 * the API's own query parameter names. Each accepts repeated values (OR'd) and
 * a `.not` form for exclusion.
 *
 * The endpoint silently ignores unknown params, so keep this list in sync with
 * the API reference rather than guessing names.
 */
export const AUDIT_LOG_FILTER_FIELDS = [
  "id",
  "account_name",
  "action_result",
  "action_type",
  "actor_context",
  "actor_email",
  "actor_id",
  "actor_ip_address",
  "actor_token_id",
  "actor_token_name",
  "actor_type",
  "raw_cf_ray_id",
  "raw_method",
  "raw_status_code",
  "raw_uri",
  "resource_id",
  "resource_product",
  "resource_scope",
  "resource_type",
  "zone_id",
  "zone_name",
] as const;

export type AuditLogFilterField = (typeof AUDIT_LOG_FILTER_FIELDS)[number];

export interface AuditLogFilterValues {
  readonly in?: readonly string[];
  readonly not?: readonly string[];
}

export type AuditLogFilters = Partial<Record<AuditLogFilterField, AuditLogFilterValues>>;

/** Dot path into an event for each server-side filter field. */
export const AUDIT_LOG_FILTER_PATHS: Record<AuditLogFilterField, string> = {
  id: "id",
  account_name: "account.name",
  action_result: "action.result",
  action_type: "action.type",
  actor_context: "actor.context",
  actor_email: "actor.email",
  actor_id: "actor.id",
  actor_ip_address: "actor.ip_address",
  actor_token_id: "actor.token_id",
  actor_token_name: "actor.token_name",
  actor_type: "actor.type",
  raw_cf_ray_id: "raw.cf_ray_id",
  raw_method: "raw.method",
  raw_status_code: "raw.status_code",
  raw_uri: "raw.uri",
  resource_id: "resource.id",
  resource_product: "resource.product",
  resource_scope: "resource.scope",
  resource_type: "resource.type",
  zone_id: "zone.id",
  zone_name: "zone.name",
};

// ---------------------------------------------------------------------------
// Time handling
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

const RELATIVE_UNITS: Record<string, number> = {
  m: MINUTE_MS,
  h: HOUR_MS,
  d: DAY_MS,
  w: WEEK_MS,
};

/**
 * Parses an ISO-8601 timestamp, a `YYYY-MM-DD` date (UTC midnight), or a
 * relative duration such as `30m`, `24h`, `7d`, `2w` (meaning "that long
 * before `now`"). Returns epoch milliseconds.
 */
export function parseAuditTime(value: string, now: number = Date.now()): number {
  const trimmed = value.trim();
  const relative = /^(\d+)\s*([mhdw])$/iu.exec(trimmed);
  if (relative) {
    const unit = RELATIVE_UNITS[relative[2]!.toLowerCase()]!;
    return now - Number(relative[1]) * unit;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new Error(
      `Invalid time '${value}'. Use ISO-8601, YYYY-MM-DD, or a relative duration like 7d, 24h, 2w.`
    );
  }
  return parsed;
}

/**
 * Earliest `since` the API accepts. Requests older than this fail with
 * "Audit Logs expire after 18 months". Accounts often hold far less history
 * than this in practice, so it is an upper bound, not where data starts.
 */
export function auditLogRetentionStart(now: number = Date.now()): number {
  const limit = new Date(now);
  limit.setUTCMonth(limit.getUTCMonth() - 18);
  // One day of margin so a request built now is still valid when it arrives.
  return limit.getTime() + DAY_MS;
}

export interface AuditTimeWindow {
  readonly since: string;
  readonly before: string;
}

/**
 * Splits `[since, before)` into contiguous windows of `windowMs`, ordered to
 * match `direction` so concatenating each window's results stays sorted.
 * The API treats `since` as inclusive and `before` as exclusive, so adjacent
 * windows neither overlap nor drop boundary events.
 */
export function planAuditWindows(
  sinceMs: number,
  beforeMs: number,
  windowMs: number | undefined,
  direction: "asc" | "desc"
): AuditTimeWindow[] {
  const windows: AuditTimeWindow[] = [];
  if (!windowMs || windowMs <= 0 || beforeMs - sinceMs <= windowMs) {
    windows.push({
      since: new Date(sinceMs).toISOString(),
      before: new Date(beforeMs).toISOString(),
    });
  } else {
    for (let start = sinceMs; start < beforeMs; start += windowMs) {
      windows.push({
        since: new Date(start).toISOString(),
        before: new Date(Math.min(start + windowMs, beforeMs)).toISOString(),
      });
    }
  }
  return direction === "desc" ? windows.reverse() : windows;
}

// ---------------------------------------------------------------------------
// Field access & client-side matching
// ---------------------------------------------------------------------------

/** Short names accepted anywhere a field path is expected. */
export const AUDIT_FIELD_ALIASES: Record<string, string> = {
  time: "action.time",
  action: "action.type",
  result: "action.result",
  description: "action.description",
  actor: "actor.email",
  actor_type: "actor.type",
  context: "actor.context",
  ip: "actor.ip_address",
  token: "actor.token_name",
  product: "resource.product",
  type: "resource.type",
  resource_id: "resource.id",
  scope: "resource.scope",
  zone: "zone.name",
  zone_id: "zone.id",
  method: "raw.method",
  status: "raw.status_code",
  uri: "raw.uri",
  ray: "raw.cf_ray_id",
  user_agent: "raw.user_agent",
};

export const DEFAULT_AUDIT_FIELDS = [
  "time",
  "actor",
  "action",
  "product",
  "resource_id",
  "zone",
  "method",
  "uri",
] as const;

export function resolveAuditFieldPath(field: string): string {
  return AUDIT_FIELD_ALIASES[field] ?? field;
}

/** Reads a dot path (or alias) from an event. */
export function getAuditField(log: AuditLog, field: string): unknown {
  let current: unknown = log;
  for (const segment of resolveAuditFieldPath(field).split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function formatAuditFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function pickAuditFields(
  log: AuditLog,
  fields: readonly string[]
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    picked[field] = getAuditField(log, field) ?? null;
  }
  return picked;
}

export interface AuditWhereClause {
  readonly field: string;
  readonly op: "=" | "!=" | "~";
  readonly value: string;
}

/**
 * Parses `path=value`, `path!=value`, or `path~regex`. Paths accept the same
 * aliases as `--fields`.
 */
export function parseAuditWhere(expression: string): AuditWhereClause {
  const match = /^([^=!~]+?)\s*(!=|=|~)\s*(.*)$/su.exec(expression);
  if (!match || match[1]!.trim().length === 0) {
    throw new Error(
      `Invalid --where '${expression}'. Use field=value, field!=value, or field~regex.`
    );
  }
  return {
    field: match[1]!.trim(),
    op: match[2] as AuditWhereClause["op"],
    value: match[3]!,
  };
}

export interface AuditMatchOptions {
  /** Regex tested against the whole JSON-serialised event. */
  readonly match?: string;
  readonly where?: readonly AuditWhereClause[];
}

/** Returns a predicate for client-side matching, or undefined if none needed. */
export function buildAuditLogPredicate(
  options: AuditMatchOptions
): ((log: AuditLog) => boolean) | undefined {
  const tests: Array<(log: AuditLog) => boolean> = [];
  if (options.match) {
    const regex = new RegExp(options.match, "iu");
    tests.push((log) => regex.test(JSON.stringify(log)));
  }
  for (const clause of options.where ?? []) {
    if (clause.op === "~") {
      const regex = new RegExp(clause.value, "iu");
      tests.push((log) => regex.test(formatAuditFieldValue(getAuditField(log, clause.field))));
    } else {
      const wantEqual = clause.op === "=";
      tests.push(
        (log) =>
          (formatAuditFieldValue(getAuditField(log, clause.field)) === clause.value) ===
          wantEqual
      );
    }
  }
  if (tests.length === 0) return undefined;
  return (log) => tests.every((test) => test(log));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

type AuditLogLister = Pick<CloudflareClient, "listAuditLogs">;

export interface AuditSearchProgress {
  readonly pages: number;
  readonly scanned: number;
  readonly matched: number;
  readonly windowsDone: number;
  readonly windowsTotal: number;
  /** `action.time` of the most recent event emitted, if any. */
  readonly currentTime?: string;
  readonly retries: number;
  readonly elapsedMs: number;
}

export interface AuditSearchOptions {
  readonly accountId?: string;
  /** Epoch ms or any value accepted by {@link parseAuditTime}. */
  readonly since: number | string;
  readonly before?: number | string;
  readonly direction?: "asc" | "desc";
  readonly filters?: AuditLogFilters;
  /** Client-side predicate applied after server-side filters. */
  readonly predicate?: (log: AuditLog) => boolean;
  /** Stop after this many matching events. */
  readonly maxResults?: number;
  /** Split the range into windows of this size and query them in parallel. */
  readonly windowMs?: number;
  readonly concurrency?: number;
  readonly pageSize?: number;
  /** Attempts per page on 429/5xx/network errors (including the first). */
  readonly maxAttempts?: number;
  readonly onProgress?: (progress: AuditSearchProgress) => void;
  readonly onWarning?: (message: string) => void;
  readonly signal?: AbortSignal;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: number;
}

export interface ResolvedAuditRange {
  readonly sinceMs: number;
  readonly beforeMs: number;
  readonly warnings: readonly string[];
}

/**
 * Normalises `since`/`before` and clamps `since` to the API's retention limit,
 * returning a warning instead of letting the request fail with a 400.
 */
export function resolveAuditRange(
  since: number | string,
  before: number | string | undefined,
  now: number = Date.now()
): ResolvedAuditRange {
  const warnings: string[] = [];
  const beforeMs =
    before === undefined
      ? now
      : typeof before === "number"
        ? before
        : parseAuditTime(before, now);
  let sinceMs = typeof since === "number" ? since : parseAuditTime(since, now);

  const retentionStart = auditLogRetentionStart(now);
  if (sinceMs < retentionStart) {
    warnings.push(
      `--since ${new Date(sinceMs).toISOString()} is past the 18-month audit log ` +
        `retention limit; searching from ${new Date(retentionStart).toISOString()} instead.`
    );
    sinceMs = retentionStart;
  }
  if (sinceMs >= beforeMs) {
    throw new Error(
      `Invalid time range: since (${new Date(sinceMs).toISOString()}) must be before ` +
        `before (${new Date(beforeMs).toISOString()}).`
    );
  }
  return { sinceMs, beforeMs, warnings };
}

export function isRetryableAuditError(err: unknown): boolean {
  if (err instanceof CloudflareError) {
    return err.statusCode === 429 || (err.statusCode !== undefined && err.statusCode >= 500);
  }
  // fetch() network failures surface as TypeError.
  return err instanceof TypeError;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface WindowState {
  readonly pages: AuditLog[][];
  done: boolean;
  error?: unknown;
  wake?: () => void;
}

class SearchStopped extends Error {}

/**
 * Streams every audit log event matching `options`, following pagination
 * cursors automatically. When `windowMs` is set the range is split into
 * windows fetched `concurrency` at a time; events are still yielded in
 * `direction` order. Stops early at `maxResults` or when `signal` aborts.
 */
export async function* searchAuditLogs(
  client: AuditLogLister,
  options: AuditSearchOptions
): AsyncGenerator<AuditLog, void, undefined> {
  const now = options.now ?? Date.now();
  const direction = options.direction ?? "desc";
  const pageSize = options.pageSize ?? 1000;
  const maxAttempts = options.maxAttempts ?? 5;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();

  const range = resolveAuditRange(options.since, options.before, now);
  for (const warning of range.warnings) options.onWarning?.(warning);

  const windows = planAuditWindows(range.sinceMs, range.beforeMs, options.windowMs, direction);
  const filters: ListAuditLogsParams["filters"] = {};
  for (const [field, values] of Object.entries(options.filters ?? {})) {
    if (!values) continue;
    filters[field] = {
      in: values.in ? [...values.in] : undefined,
      not: values.not ? [...values.not] : undefined,
    };
  }

  let stopped = false;
  let pages = 0;
  let scanned = 0;
  let matched = 0;
  let windowsDone = 0;
  let retries = 0;
  let currentTime: string | undefined;

  const report = () =>
    options.onProgress?.({
      pages,
      scanned,
      matched,
      windowsDone,
      windowsTotal: windows.length,
      currentTime,
      retries,
      elapsedMs: Date.now() - startedAt,
    });

  const fetchPage = async (window: AuditTimeWindow, cursor: string | undefined) => {
    for (let attempt = 1; ; attempt++) {
      if (stopped || options.signal?.aborted) throw new SearchStopped();
      try {
        return await client.listAuditLogs(
          {
            since: window.since,
            before: window.before,
            direction,
            limit: pageSize,
            cursor,
            filters,
          },
          options.accountId
        );
      } catch (err) {
        if (attempt >= maxAttempts || !isRetryableAuditError(err)) throw err;
        retries++;
        report();
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 30_000));
      }
    }
  };

  const states: WindowState[] = windows.map(() => ({ pages: [], done: false }));

  const runWindow = async (index: number) => {
    const state = states[index]!;
    try {
      let cursor: string | undefined;
      do {
        const result = await fetchPage(windows[index]!, cursor);
        pages++;
        scanned += result.data.length;
        state.pages.push(result.data);
        state.wake?.();
        report();
        const next = result.pagination?.cursor;
        // A short page is the last one; some responses still carry a cursor.
        cursor = next && result.data.length >= pageSize ? next : undefined;
      } while (cursor && !stopped);
    } catch (err) {
      if (!(err instanceof SearchStopped)) state.error = err;
    } finally {
      state.done = true;
      windowsDone++;
      state.wake?.();
      report();
    }
  };

  let nextToStart = 0;
  const running = new Set<Promise<void>>();
  const startMore = (head: number) => {
    // Only run ahead of the window being emitted by `concurrency` windows so
    // memory stays bounded on long ranges.
    while (
      !stopped &&
      nextToStart < windows.length &&
      running.size < concurrency &&
      nextToStart < head + concurrency
    ) {
      const task = runWindow(nextToStart++);
      running.add(task);
      void task.finally(() => {
        running.delete(task);
      });
    }
  };

  const onAbort = () => {
    stopped = true;
    for (const state of states) state.wake?.();
  };
  options.signal?.addEventListener("abort", onAbort);

  try {
    for (let head = 0; head < windows.length; head++) {
      const state = states[head]!;
      for (;;) {
        startMore(head);
        const page = state.pages.shift();
        if (page) {
          for (const log of page) {
            if (options.predicate && !options.predicate(log)) continue;
            matched++;
            currentTime = typeof log.action?.time === "string" ? log.action.time : currentTime;
            yield log;
            if (options.maxResults !== undefined && matched >= options.maxResults) {
              stopped = true;
              return;
            }
          }
          continue;
        }
        if (state.error) throw state.error;
        if (state.done || stopped) break;
        await new Promise<void>((resolve) => {
          state.wake = resolve;
          // Re-check after installing the waker in case the window finished
          // between the checks above and here.
          if (state.pages.length > 0 || state.done || stopped) resolve();
        });
        state.wake = undefined;
      }
      if (stopped) return;
    }
  } finally {
    stopped = true;
    options.signal?.removeEventListener("abort", onAbort);
    await Promise.allSettled([...running]);
    report();
  }
}

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

export const DEFAULT_AUDIT_FACETS = [
  "product",
  "type",
  "action",
  "actor",
  "context",
  "zone",
] as const;

export type AuditFacetCounts = Record<string, Array<{ value: string; count: number }>>;

/** Incrementally counts distinct values per field; feed it every event. */
export class AuditFacetCounter {
  private readonly counts = new Map<string, Map<string, number>>();
  total = 0;

  constructor(private readonly fields: readonly string[] = DEFAULT_AUDIT_FACETS) {
    for (const field of fields) this.counts.set(field, new Map());
  }

  add(log: AuditLog): void {
    this.total++;
    for (const field of this.fields) {
      const value = formatAuditFieldValue(getAuditField(log, field)) || "(empty)";
      const bucket = this.counts.get(field)!;
      bucket.set(value, (bucket.get(value) ?? 0) + 1);
    }
  }

  result(top?: number): AuditFacetCounts {
    const out: AuditFacetCounts = {};
    for (const [field, bucket] of this.counts) {
      const sorted = [...bucket.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      out[field] = top === undefined ? sorted : sorted.slice(0, top);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Empty-result diagnostics
// ---------------------------------------------------------------------------

/** Flag name used by the CLI for each filter field, for hint messages. */
const FILTER_FLAG_NAMES: Partial<Record<AuditLogFilterField, string>> = {
  resource_product: "--product",
  resource_type: "--resource-type",
  action_type: "--action",
  actor_email: "--actor",
  zone_name: "--zone",
  raw_method: "--method",
  raw_status_code: "--status",
  resource_id: "--resource-id",
  zone_id: "--zone-id",
};

function flagFor(field: AuditLogFilterField): string {
  return FILTER_FLAG_NAMES[field] ?? `--filter ${field}=`;
}

/**
 * Given a sample of unfiltered events, explains why `filters` might match
 * nothing: values that never occur, and values that occur under a different
 * field (e.g. `custom_hostnames` is a `resource.product`, not a
 * `resource.type`).
 */
export function explainEmptyAuditFilters(
  filters: AuditLogFilters,
  sample: readonly AuditLog[]
): string[] {
  const hints: string[] = [];
  if (sample.length === 0) return hints;

  const valuesByField = new Map<AuditLogFilterField, Set<string>>();
  for (const field of AUDIT_LOG_FILTER_FIELDS) {
    const seen = new Set<string>();
    for (const log of sample) {
      const value = formatAuditFieldValue(getAuditField(log, AUDIT_LOG_FILTER_PATHS[field]));
      if (value) seen.add(value);
    }
    valuesByField.set(field, seen);
  }

  for (const [rawField, values] of Object.entries(filters)) {
    const field = rawField as AuditLogFilterField;
    const seen = valuesByField.get(field);
    if (!seen || !values?.in) continue;
    for (const value of values.in) {
      if (seen.has(value)) continue;
      const elsewhere = AUDIT_LOG_FILTER_FIELDS.filter(
        (other) => other !== field && valuesByField.get(other)?.has(value)
      );
      if (elsewhere.length > 0) {
        const other = elsewhere[0]!;
        hints.push(
          `'${value}' never appears in ${AUDIT_LOG_FILTER_PATHS[field]} but does appear in ` +
            `${AUDIT_LOG_FILTER_PATHS[other]}; did you mean ${flagFor(other)} ${value}?`
        );
        continue;
      }
      if (seen.size === 0) {
        hints.push(
          `${AUDIT_LOG_FILTER_PATHS[field]} is never set in the sampled events, so ` +
            `${flagFor(field)} cannot match.`
        );
        continue;
      }
      const known = [...seen].sort().slice(0, 15).join(", ");
      hints.push(
        `'${value}' was not seen in ${AUDIT_LOG_FILTER_PATHS[field]} in ${sample.length} ` +
          `sampled events. Seen values: ${known}${seen.size > 15 ? ", ..." : ""}.`
      );
    }
  }
  return hints;
}

/** Returns the oldest event at or after `sinceMs`, or undefined if none. */
export async function findOldestAuditLog(
  client: AuditLogLister,
  options: { readonly accountId?: string; readonly sinceMs?: number; readonly now?: number } = {}
): Promise<AuditLog | undefined> {
  const now = options.now ?? Date.now();
  const since = Math.max(options.sinceMs ?? 0, auditLogRetentionStart(now));
  const result = await client.listAuditLogs(
    {
      since: new Date(since).toISOString(),
      before: new Date(now).toISOString(),
      direction: "asc",
      limit: 1,
    },
    options.accountId
  );
  return result.data[0];
}

/**
 * Samples recent unfiltered events in the searched range and explains why the
 * filters matched nothing. Also reports when the range starts before the
 * oldest event the account still holds.
 */
export async function diagnoseEmptyAuditSearch(
  client: AuditLogLister,
  options: {
    readonly accountId?: string;
    readonly filters: AuditLogFilters;
    readonly sinceMs: number;
    readonly beforeMs: number;
    readonly now?: number;
  }
): Promise<string[]> {
  const hints: string[] = [];
  const sample = await client.listAuditLogs(
    {
      since: new Date(Math.max(options.sinceMs, options.beforeMs - WEEK_MS)).toISOString(),
      before: new Date(options.beforeMs).toISOString(),
      direction: "desc",
      limit: 1000,
    },
    options.accountId
  );
  hints.push(...explainEmptyAuditFilters(options.filters, sample.data));

  if (sample.data.length === 0) {
    const oldest = await findOldestAuditLog(client, {
      accountId: options.accountId,
      now: options.now,
    });
    const oldestTime = oldest?.action?.time;
    if (typeof oldestTime === "string" && Date.parse(oldestTime) > options.sinceMs) {
      hints.push(
        `The oldest audit log event this account still holds is ${oldestTime}; ` +
          "history before that has expired."
      );
    } else {
      hints.push("No events at all exist in the last week of the searched range.");
    }
  }
  return hints;
}
