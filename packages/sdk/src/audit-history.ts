import type { CloudflareClient } from "./client.js";
import {
  findOldestAuditLog,
  getAuditField,
  resolveAuditRange,
  searchAuditLogs,
  WEEK_MS,
  type AuditSearchProgress,
} from "./audit-search.js";
import type { AuditLog } from "./types.js";

export interface AuditHistoryEntry {
  readonly time: string;
  readonly action: string;
  readonly description: string;
  readonly resourceId?: string;
  readonly actor?: string;
  readonly zone?: string;
  readonly method?: string;
  readonly uri?: string;
  /** Why this event is in the timeline when it does not name the hostname. */
  readonly note?: string;
}

export interface CustomHostnameHistory {
  readonly hostname: string;
  /** IDs the hostname currently has (empty if it no longer exists). */
  readonly currentIds: readonly string[];
  /** IDs linked to the hostname via events, including deleted ones. */
  readonly knownIds: readonly string[];
  readonly since: string;
  readonly before: string;
  readonly entries: readonly AuditHistoryEntry[];
  /** Plain-language notes: likely re-creates, missing create events, retention. */
  readonly notes: readonly string[];
  readonly warnings: readonly string[];
}

export interface CustomHostnameHistoryOptions {
  readonly hostname: string;
  readonly accountId?: string;
  /** Zone to look up the hostname's current ID in. Skipped if absent. */
  readonly zoneId?: string;
  readonly since?: number | string;
  readonly before?: number | string;
  /** A delete this close before a create on the same zone is flagged. */
  readonly recreateWindowMs?: number;
  readonly concurrency?: number;
  readonly onProgress?: (progress: AuditSearchProgress) => void;
  readonly signal?: AbortSignal;
  readonly now?: number;
}

const DEFAULT_RECREATE_WINDOW_MS = 10 * 60_000;
const CUSTOM_HOSTNAME_ID_IN_URI = /\/custom_hostnames\/([0-9a-f-]{36})/iu;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventHostname(log: AuditLog): string | undefined {
  return (
    readString(getAuditField(log, "resource.request.hostname")) ??
    readString(getAuditField(log, "resource.response.hostname"))
  )?.toLowerCase();
}

function eventResourceId(log: AuditLog): string | undefined {
  return (
    readString(getAuditField(log, "resource.id")) ??
    CUSTOM_HOSTNAME_ID_IN_URI.exec(readString(getAuditField(log, "raw.uri")) ?? "")?.[1]
  );
}

function toEntry(log: AuditLog, note?: string): AuditHistoryEntry {
  return {
    time: readString(getAuditField(log, "action.time")) ?? "",
    action: readString(getAuditField(log, "action.type")) ?? "",
    description: readString(getAuditField(log, "action.description")) ?? "",
    resourceId: eventResourceId(log),
    actor:
      readString(getAuditField(log, "actor.email")) ??
      readString(getAuditField(log, "actor.context")),
    zone: readString(getAuditField(log, "zone.name")),
    method: readString(getAuditField(log, "raw.method")),
    uri: readString(getAuditField(log, "raw.uri")),
    note,
  };
}

/**
 * Builds a create/update/delete timeline for a custom hostname.
 *
 * Audit events do not carry the hostname consistently: creates have it in the
 * request body but no resource ID; updates and deletes have the ID but no
 * hostname. So this looks up the current ID, links every event by hostname or
 * ID, and flags deletes that land shortly before a create on the same zone as
 * likely re-creates (the deleted ID is otherwise unlinkable).
 */
export async function getCustomHostnameHistory(
  client: Pick<CloudflareClient, "listAuditLogs" | "listCustomHostnames">,
  options: CustomHostnameHistoryOptions
): Promise<CustomHostnameHistory> {
  const now = options.now ?? Date.now();
  const hostname = options.hostname.trim().toLowerCase();
  const recreateWindowMs = options.recreateWindowMs ?? DEFAULT_RECREATE_WINDOW_MS;
  const range = resolveAuditRange(options.since ?? 0, options.before, now);

  const currentIds: string[] = [];
  if (options.zoneId) {
    const current = await client.listCustomHostnames({ hostname }, options.zoneId);
    for (const entry of current.hostnames) {
      if (entry.hostname.toLowerCase() === hostname) currentIds.push(entry.id);
    }
  }

  const events: AuditLog[] = [];
  for await (const log of searchAuditLogs(client, {
    accountId: options.accountId,
    since: range.sinceMs,
    before: range.beforeMs,
    direction: "asc",
    filters: {
      resource_product: { in: ["custom_hostnames"] },
      action_type: { not: ["view"] },
    },
    windowMs: 4 * WEEK_MS,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
    signal: options.signal,
    now,
  })) {
    events.push(log);
  }

  // Pass 1: IDs linked to the hostname, from the lookup and from any event
  // that names both (e.g. a PATCH whose body echoes the hostname).
  const knownIds = new Set(currentIds);
  for (const log of events) {
    const id = eventResourceId(log);
    if (id && eventHostname(log) === hostname) knownIds.add(id);
  }

  const creates = events.filter(
    (log) => eventHostname(log) === hostname && getAuditField(log, "action.type") === "create"
  );

  const entries: AuditHistoryEntry[] = [];
  const notes: string[] = [];
  for (const log of events) {
    const id = eventResourceId(log);
    if (eventHostname(log) === hostname || (id && knownIds.has(id))) {
      entries.push(toEntry(log));
      continue;
    }
    if (getAuditField(log, "action.type") !== "delete") continue;

    const deletedAt = Date.parse(readString(getAuditField(log, "action.time")) ?? "");
    const zone = getAuditField(log, "zone.id");
    const followingCreate = creates.find((create) => {
      const createdAt = Date.parse(readString(getAuditField(create, "action.time")) ?? "");
      return (
        getAuditField(create, "zone.id") === zone &&
        createdAt >= deletedAt &&
        createdAt - deletedAt <= recreateWindowMs
      );
    });
    if (followingCreate) {
      const createdAt = readString(getAuditField(followingCreate, "action.time"));
      const seconds = Math.round(
        (Date.parse(createdAt ?? "") - deletedAt) / 1000
      );
      entries.push(
        toEntry(
          log,
          `likely the previous ID: deleted ${seconds}s before ${hostname} was created on the same zone`
        )
      );
      notes.push(
        `Likely re-create: ${id ?? "an ID"} was deleted at ${readString(getAuditField(log, "action.time"))} ` +
          `and ${hostname} was created ${seconds}s later at ${createdAt}.`
      );
    }
  }

  if (creates.length === 0) {
    const oldest = await findOldestAuditLog(client, { accountId: options.accountId, now });
    const oldestTime = readString(getAuditField(oldest ?? ({} as AuditLog), "action.time"));
    const searched = `${new Date(range.sinceMs).toISOString()} to ${new Date(range.beforeMs).toISOString()}`;
    notes.push(
      oldestTime
        ? `No create event found between ${searched}. The account's audit history starts at ` +
            `${oldestTime}; a create before that has expired from the audit log.`
        : `No create event found between ${searched}, and the account holds no audit history.`
    );
  }
  if (currentIds.length === 0 && options.zoneId) {
    notes.push(`${hostname} does not currently exist in zone ${options.zoneId}.`);
  }

  return {
    hostname,
    currentIds,
    knownIds: [...knownIds],
    since: new Date(range.sinceMs).toISOString(),
    before: new Date(range.beforeMs).toISOString(),
    entries,
    notes,
    // Defaulting since to 0 always clamps; only surface the warning when the
    // caller asked for an explicit start.
    warnings: options.since === undefined ? [] : range.warnings,
  };
}
