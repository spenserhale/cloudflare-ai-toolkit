import { describe, expect, it } from "bun:test";
import {
  AuditFacetCounter,
  auditLogRetentionStart,
  buildAuditLogPredicate,
  explainEmptyAuditFilters,
  parseAuditTime,
  parseAuditWhere,
  planAuditWindows,
  resolveAuditRange,
  searchAuditLogs,
  DAY_MS,
} from "../src/audit-search.js";
import { getCustomHostnameHistory } from "../src/audit-history.js";
import { CloudflareError } from "../src/errors.js";
import type { AuditLog, ListAuditLogsParams } from "../src/types.js";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");

function event(time: string, extra: Record<string, unknown> = {}): AuditLog {
  return { id: `id-${time}`, action: { time, type: "update" }, ...extra } as AuditLog;
}

/** Fake lister that pages `events` (already in the order the API would return). */
function fakeLister(
  respond: (params: ListAuditLogsParams) => { data: AuditLog[]; cursor?: string }
) {
  const calls: ListAuditLogsParams[] = [];
  return {
    calls,
    client: {
      async listAuditLogs(params: ListAuditLogsParams = {}) {
        calls.push(params);
        const { data, cursor } = respond(params);
        return { data, pagination: cursor ? { cursor } : undefined };
      },
    },
  };
}

async function collect(iter: AsyncIterable<AuditLog>): Promise<AuditLog[]> {
  const out: AuditLog[] = [];
  for await (const log of iter) out.push(log);
  return out;
}

describe("parseAuditTime", () => {
  it("accepts relative durations", () => {
    expect(parseAuditTime("7d", NOW)).toBe(NOW - 7 * DAY_MS);
    expect(parseAuditTime("24h", NOW)).toBe(NOW - DAY_MS);
    expect(parseAuditTime("2w", NOW)).toBe(NOW - 14 * DAY_MS);
  });

  it("accepts dates and ISO timestamps", () => {
    expect(parseAuditTime("2026-03-01", NOW)).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(parseAuditTime("2026-03-01T05:00:00Z", NOW)).toBe(
      Date.parse("2026-03-01T05:00:00Z")
    );
  });

  it("rejects garbage", () => {
    expect(() => parseAuditTime("yesterday", NOW)).toThrow("Invalid time");
  });
});

describe("resolveAuditRange", () => {
  it("clamps since to the retention limit with a warning", () => {
    const range = resolveAuditRange("2024-01-01", undefined, NOW);
    expect(range.sinceMs).toBe(auditLogRetentionStart(NOW));
    expect(range.warnings[0]).toContain("18-month");
  });

  it("rejects inverted ranges", () => {
    expect(() => resolveAuditRange("2026-10-02", "2026-10-01", NOW)).toThrow(
      "Invalid time range"
    );
  });
});

describe("planAuditWindows", () => {
  it("splits contiguously and orders by direction", () => {
    const since = Date.parse("2026-10-01T00:00:00Z");
    const before = Date.parse("2026-10-03T12:00:00Z");
    const asc = planAuditWindows(since, before, DAY_MS, "asc");
    expect(asc.map((w) => w.since)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    ]);
    expect(asc[2]!.before).toBe("2026-10-03T12:00:00.000Z");
    const desc = planAuditWindows(since, before, DAY_MS, "desc");
    expect(desc[0]!.since).toBe("2026-10-03T00:00:00.000Z");
  });

  it("uses one window when no size is given", () => {
    expect(planAuditWindows(0, 10 * DAY_MS, undefined, "asc")).toHaveLength(1);
  });
});

describe("searchAuditLogs", () => {
  it("follows cursors until a short page and forwards filters", async () => {
    const { client, calls } = fakeLister((params) => {
      if (!params.cursor) {
        return { data: [event("2026-10-29T03:00:00Z"), event("2026-10-29T02:00:00Z")], cursor: "c1" };
      }
      return { data: [event("2026-10-29T01:00:00Z")], cursor: "c2" };
    });

    const logs = await collect(
      searchAuditLogs(client, {
        since: "2026-10-29",
        before: "2026-10-30",
        pageSize: 2,
        filters: { resource_product: { in: ["custom_hostnames"], not: [] } },
        now: NOW,
      })
    );

    expect(logs).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.cursor).toBe("c1");
    expect(calls[0]!.filters).toEqual({
      resource_product: { in: ["custom_hostnames"], not: [] },
    });
  });

  it("emits windows in order even when queried in parallel", async () => {
    const { client } = fakeLister((params) => ({
      data: [event(params.since!)],
    }));

    const logs = await collect(
      searchAuditLogs(client, {
        since: "2026-10-01",
        before: "2026-10-05",
        windowMs: DAY_MS,
        concurrency: 3,
        direction: "desc",
        now: NOW,
      })
    );

    expect(logs.map((log) => log.action?.time)).toEqual([
      "2026-10-04T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("stops at maxResults without fetching further pages", async () => {
    const { client, calls } = fakeLister(() => ({
      data: [event("2026-10-29T03:00:00Z"), event("2026-10-29T02:00:00Z")],
      cursor: "more",
    }));

    const logs = await collect(
      searchAuditLogs(client, {
        since: "2026-10-29",
        before: "2026-10-30",
        pageSize: 2,
        maxResults: 1,
        now: NOW,
      })
    );

    // The fake always returns a cursor, so only the stop ends paging.
    expect(logs).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it("applies the client-side predicate before counting toward maxResults", async () => {
    const { client } = fakeLister(() => ({
      data: [
        event("2026-10-29T03:00:00Z", { raw: { uri: "/a" } }),
        event("2026-10-29T02:00:00Z", { raw: { uri: "/b" } }),
      ],
    }));

    const logs = await collect(
      searchAuditLogs(client, {
        since: "2026-10-29",
        before: "2026-10-30",
        predicate: buildAuditLogPredicate({ where: [parseAuditWhere("uri=/b")] }),
        maxResults: 1,
        now: NOW,
      })
    );

    expect(logs.map((log) => log.id)).toEqual(["id-2026-10-29T02:00:00Z"]);
  });

  it("retries 429 and 5xx responses with backoff", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const client = {
      async listAuditLogs() {
        attempts++;
        if (attempts === 1) throw new CloudflareError("rate limited", "429", 429);
        if (attempts === 2) throw new CloudflareError("HTTP 524", "UNKNOWN", 524);
        return { data: [event("2026-10-29T01:00:00Z")] };
      },
    };

    const logs = await collect(
      searchAuditLogs(client, {
        since: "2026-10-29",
        before: "2026-10-30",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: NOW,
      })
    );

    expect(logs).toHaveLength(1);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("does not retry client errors", async () => {
    const client = {
      async listAuditLogs(): Promise<never> {
        throw new CloudflareError("bad request", "400", 400);
      },
    };
    await expect(
      collect(searchAuditLogs(client, { since: "2026-10-29", before: "2026-10-30", now: NOW }))
    ).rejects.toThrow("bad request");
  });

  it("keeps already-yielded rows when a later window fails", async () => {
    const client = {
      async listAuditLogs(params: ListAuditLogsParams = {}) {
        if (params.since === "2026-10-01T00:00:00.000Z") {
          throw new CloudflareError("forbidden", "403", 403);
        }
        return { data: [event(params.since!)] };
      },
    };
    const seen: AuditLog[] = [];
    await expect(
      (async () => {
        for await (const log of searchAuditLogs(client, {
          since: "2026-10-01",
          before: "2026-10-03",
          windowMs: DAY_MS,
          direction: "desc",
          now: NOW,
        })) {
          seen.push(log);
        }
      })()
    ).rejects.toThrow("forbidden");
    expect(seen).toHaveLength(1);
  });
});

describe("explainEmptyAuditFilters", () => {
  it("points at the field a value actually lives in", () => {
    const hints = explainEmptyAuditFilters(
      { resource_type: { in: ["custom_hostnames"] } },
      [
        event("2026-10-29T01:00:00Z", { resource: { product: "custom_hostnames" } }),
        event("2026-10-29T02:00:00Z", { resource: { product: "dns_records", type: "record" } }),
      ]
    );
    expect(hints[0]).toContain("did you mean --product custom_hostnames");
  });

  it("lists known values when a value is unknown everywhere", () => {
    const hints = explainEmptyAuditFilters({ resource_product: { in: ["nope"] } }, [
      event("2026-10-29T01:00:00Z", { resource: { product: "dns_records" } }),
    ]);
    expect(hints[0]).toContain("Seen values: dns_records");
  });
});

describe("AuditFacetCounter", () => {
  it("counts values per field, most common first", () => {
    const counter = new AuditFacetCounter(["product"]);
    counter.add(event("1", { resource: { product: "dns" } }));
    counter.add(event("2", { resource: { product: "purge_cache" } }));
    counter.add(event("3", { resource: { product: "purge_cache" } }));
    counter.add(event("4"));
    expect(counter.result().product).toEqual([
      { value: "purge_cache", count: 2 },
      { value: "(empty)", count: 1 },
      { value: "dns", count: 1 },
    ]);
  });
});

describe("getCustomHostnameHistory", () => {
  it("links creates by hostname, updates by ID, and flags re-creates", async () => {
    const zone = { id: "zone-1", name: "saas.example" };
    const events: AuditLog[] = [
      event("2026-10-30T19:12:20.541Z", {
        action: { time: "2026-10-30T19:12:20.541Z", type: "delete", description: "Delete" },
        resource: { id: "old-id", product: "custom_hostnames" },
        zone,
      }),
      event("2026-10-30T19:13:02.209Z", {
        action: { time: "2026-10-30T19:13:02.209Z", type: "create", description: "Create" },
        resource: { product: "custom_hostnames", request: { hostname: "www.example.com" } },
        zone,
      }),
      event("2026-10-30T19:20:00.000Z", {
        action: { time: "2026-10-30T19:20:00.000Z", type: "update", description: "Edit" },
        resource: { id: "new-id", product: "custom_hostnames" },
        zone,
      }),
      event("2026-10-30T19:30:00.000Z", {
        action: { time: "2026-10-30T19:30:00.000Z", type: "delete", description: "Delete" },
        resource: { id: "unrelated", product: "custom_hostnames" },
        zone,
      }),
    ];
    const client = {
      async listAuditLogs(params: ListAuditLogsParams = {}) {
        if (params.limit === 1) return { data: [] };
        return {
          data: events.filter(
            (log) =>
              (log.action as { time: string }).time >= params.since! &&
              (log.action as { time: string }).time < params.before!
          ),
        };
      },
      async listCustomHostnames() {
        return {
          hostnames: [{ id: "new-id", hostname: "www.example.com" }],
          resultInfo: undefined,
        } as never;
      },
    };

    const history = await getCustomHostnameHistory(client, {
      hostname: "WWW.example.com",
      zoneId: "zone-1",
      since: "2026-10-01",
      before: "2026-10-31",
      now: NOW,
    });

    expect(history.currentIds).toEqual(["new-id"]);
    expect(history.entries.map((entry) => entry.action)).toEqual(["delete", "create", "update"]);
    expect(history.entries[0]!.note).toContain("42s before");
    expect(history.notes.some((note) => note.includes("Likely re-create"))).toBe(true);
  });
});

describe("searchAuditLogs edge cases", () => {
  const raceTimeout = <T>(promise: Promise<T>) =>
    Promise.race([promise, new Promise<string>((resolve) => setTimeout(() => resolve("HUNG"), 1000))]);

  it("does not stall when parallel windows return empty pages", async () => {
    const client = { async listAuditLogs() { return { data: [] }; } };
    const result = await raceTimeout(
      collect(
        searchAuditLogs(client, {
          since: "2026-10-01",
          before: "2026-10-20",
          windowMs: DAY_MS,
          concurrency: 2,
          now: NOW,
        })
      )
    );
    expect(result).toEqual([]);
  });

  it("yields nothing for maxResults 0", async () => {
    const { client, calls } = fakeLister(() => ({ data: [event("2026-10-29T01:00:00Z")] }));
    const logs = await collect(
      searchAuditLogs(client, { since: "2026-10-29", before: "2026-10-30", maxResults: 0, now: NOW })
    );
    expect(logs).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("stops yielding buffered rows once the signal aborts", async () => {
    const controller = new AbortController();
    const { client } = fakeLister(() => ({
      data: [event("2026-10-29T03:00:00Z"), event("2026-10-29T02:00:00Z"), event("2026-10-29T01:00:00Z")],
    }));
    const seen: AuditLog[] = [];
    for await (const log of searchAuditLogs(client, {
      since: "2026-10-29",
      before: "2026-10-30",
      signal: controller.signal,
      now: NOW,
    })) {
      seen.push(log);
      controller.abort();
    }
    expect(seen).toHaveLength(1);
  });

  it("passes an abort signal to in-flight requests", async () => {
    let received: AbortSignal | undefined;
    const client = {
      async listAuditLogs(_params?: ListAuditLogsParams, _account?: string, options?: { signal?: AbortSignal }) {
        received = options?.signal;
        return { data: [event("2026-10-29T01:00:00Z")] };
      },
    };
    await collect(searchAuditLogs(client, { since: "2026-10-29", before: "2026-10-30", maxResults: 1, now: NOW }));
    expect(received?.aborted).toBe(true);
  });

  it("stops paging a window when the cursor repeats", async () => {
    const warnings: string[] = [];
    const { client, calls } = fakeLister(() => ({
      data: [event("2026-10-29T02:00:00Z"), event("2026-10-29T01:00:00Z")],
      cursor: "same",
    }));
    const logs = await raceTimeout(
      collect(
        searchAuditLogs(client, {
          since: "2026-10-29",
          before: "2026-10-30",
          pageSize: 2,
          onWarning: (message) => warnings.push(message),
          now: NOW,
        })
      )
    );
    expect(calls).toHaveLength(2);
    expect(logs).toHaveLength(4);
    expect(warnings[0]).toContain("repeated a pagination cursor");
  });
});

describe("time edge cases", () => {
  it("uses the API's fixed 548-day limit plus a day of margin", () => {
    const start = auditLogRetentionStart(Date.parse("2026-10-31T05:23:00Z"));
    expect(new Date(start).toISOString()).toBe("2025-05-02T05:23:00.000Z");
  });

  it("keeps absurd relative durations inside the Date range", () => {
    const range = resolveAuditRange("100000001d", undefined, NOW);
    expect(range.sinceMs).toBe(auditLogRetentionStart(NOW));
    expect(range.warnings).toHaveLength(1);
  });
});
