import { describe, expect, it, vi } from "vitest";
import type { AuditLog, ListAuditLogsParams } from "@cloudflare-ai-toolkit/sdk";
import {
  buildAuditFilters,
  parseGenericFilter,
  resolveWindowMs,
  runAuditLogsFacets,
  runAuditLogsSearch,
  type AuditFacetsFlags,
  type AuditSearchDeps,
  type AuditSearchFlags,
} from "./audit-search.js";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function baseFlags(overrides: Partial<AuditSearchFlags> = {}): AuditSearchFlags {
  return {
    since: "2026-10-29",
    before: "2026-10-30",
    includePurge: false,
    window: "none",
    concurrency: 1,
    quiet: true,
    direction: "desc",
    first: false,
    format: "ndjson",
    ...overrides,
  };
}

function event(id: string, extra: Record<string, unknown> = {}): AuditLog {
  return {
    id,
    action: { time: "2026-10-29T10:00:00Z", type: "create" },
    actor: { email: "a@example.com" },
    resource: { product: "custom_hostnames" },
    ...extra,
  } as AuditLog;
}

function createDeps(
  listAuditLogs: (params: ListAuditLogsParams) => Promise<{ data: AuditLog[]; pagination?: { cursor?: string } }>
) {
  const out: string[] = [];
  const err: string[] = [];
  const exit = vi.fn((code: number) => {
    throw new Error(`exit ${code}`);
  });
  const deps: AuditSearchDeps = {
    resolveConfig: () => ({ auth: { type: "apiToken", token: "t" }, baseUrl: "https://x", accountId: "acc" }),
    createClient: () => ({ listAuditLogs: listAuditLogs as never }),
    write: (text) => {
      out.push(text);
      return true;
    },
    writeErr: (text) => {
      err.push(text);
    },
    isErrTTY: false,
    exit: exit as unknown as AuditSearchDeps["exit"],
    onInterrupt: () => () => {},
    now: () => NOW,
  };
  return { deps, out, err, exit };
}

describe("buildAuditFilters", () => {
  it("maps flags to API field names and excludes purge_cache by default", () => {
    const filters = buildAuditFilters(
      baseFlags({
        product: ["custom_hostnames"],
        action: ["create"],
        method: ["post"],
        filter: ["actor_type=user", "raw_status_code!=200"],
      })
    );
    expect(filters).toEqual({
      resource_product: { in: ["custom_hostnames"], not: ["purge_cache"] },
      action_type: { in: ["create"], not: [] },
      raw_method: { in: ["POST"], not: [] },
      actor_type: { in: ["user"], not: [] },
      raw_status_code: { in: [], not: ["200"] },
    });
  });

  it("keeps purge_cache when asked for", () => {
    expect(buildAuditFilters(baseFlags({ includePurge: true }))).toEqual({});
    expect(buildAuditFilters(baseFlags({ product: ["purge_cache"] }))).toEqual({
      resource_product: { in: ["purge_cache"], not: [] },
    });
  });
});

describe("parseGenericFilter", () => {
  it("rejects unknown fields instead of letting the API ignore them", () => {
    expect(() => parseGenericFilter("resource.type=x")).toThrow("Invalid --filter");
    expect(parseGenericFilter("zone_name!=a.com")).toEqual({
      field: "zone_name",
      negate: true,
      value: "a.com",
    });
  });
});

describe("resolveWindowMs", () => {
  it("uses week windows for narrowed searches and day windows otherwise", () => {
    expect(resolveWindowMs("auto", { resource_product: { not: ["purge_cache"] } })).toBe(DAY);
    expect(resolveWindowMs("auto", { resource_product: { in: ["dns"] } })).toBe(7 * DAY);
    expect(resolveWindowMs("6h")).toBe(DAY / 4);
    expect(resolveWindowMs("none")).toBeUndefined();
    expect(() => resolveWindowMs("fortnight")).toThrow("Invalid --window");
  });
});

describe("runAuditLogsSearch", () => {
  it("pages through every result and streams NDJSON", async () => {
    const listAuditLogs = vi.fn(async (params: ListAuditLogsParams) =>
      params.cursor
        ? { data: [event("b")] }
        : { data: Array.from({ length: 1000 }, (_, i) => event(`a${i}`)), pagination: { cursor: "c" } }
    );
    const { deps, out, err } = createDeps(listAuditLogs);

    await runAuditLogsSearch(baseFlags({ product: ["custom_hostnames"] }), deps);

    expect(listAuditLogs).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(1001);
    expect(JSON.parse(out[1000]!).id).toBe("b");
    expect(listAuditLogs.mock.calls[0]![0].filters?.resource_product).toEqual({
      in: ["custom_hostnames"],
      not: ["purge_cache"],
    });
    expect(err).toEqual([]);
  });

  it("writes TSV with selected fields and aliases", async () => {
    const { deps, out } = createDeps(async () => ({
      data: [event("a", { raw: { uri: "/zones/z/custom_hostnames", method: "POST" } })],
    }));

    await runAuditLogsSearch(baseFlags({ format: "tsv", fields: "time,actor,uri" }), deps);

    expect(out).toEqual([
      "time\tactor\turi\n",
      "2026-10-29T10:00:00Z\ta@example.com\t/zones/z/custom_hostnames\n",
    ]);
  });

  it("stops after the first match with --first", async () => {
    const { deps, out } = createDeps(async () => ({ data: [event("a"), event("b")] }));
    await runAuditLogsSearch(baseFlags({ first: true, fields: "id" }), deps);
    expect(out).toEqual(['{"id":"a"}\n']);
  });

  it("applies --match and --where on the client", async () => {
    const { deps, out } = createDeps(async () => ({
      data: [
        event("a", { resource: { product: "custom_hostnames", request: { hostname: "x.com" } } }),
        event("b", { resource: { product: "custom_hostnames", request: { hostname: "y.com" } } }),
      ],
    }));
    await runAuditLogsSearch(
      baseFlags({
        match: "Y\\.COM",
        where: [{ field: "action", op: "=", value: "create" }],
        fields: "id",
      }),
      deps
    );
    expect(out).toEqual(['{"id":"b"}\n']);
  });

  it("explains an empty result caused by the wrong field", async () => {
    const listAuditLogs = vi.fn(async (params: ListAuditLogsParams) =>
      params.filters ? { data: [] } : { data: [event("sample")] }
    );
    const { deps, err } = createDeps(listAuditLogs);

    await runAuditLogsSearch(baseFlags({ resourceType: ["custom_hostnames"], quiet: false }), deps);

    expect(err.join("")).toContain("0 events matched");
    expect(err.join("")).toContain("did you mean --product custom_hostnames");
  });

  it("flushes buffered JSON before reporting a mid-search failure", async () => {
    let calls = 0;
    const { deps, out, err, exit } = createDeps(async () => {
      calls++;
      if (calls === 1) return { data: Array.from({ length: 1000 }, (_, i) => event(`a${i}`)), pagination: { cursor: "c" } };
      const failure = new Error("forbidden");
      throw failure;
    });

    await expect(runAuditLogsSearch(baseFlags({ format: "json", fields: "id" }), deps)).rejects.toThrow(
      "exit 1"
    );
    expect(JSON.parse(out[0]!)).toHaveLength(1000);
    expect(err.join("")).toContain("Error: forbidden");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("warns and clamps --since past retention", async () => {
    const listAuditLogs = vi.fn(async () => ({ data: [event("a")] }));
    const { deps, err } = createDeps(listAuditLogs);
    await runAuditLogsSearch(baseFlags({ since: "2023-01-01", before: undefined }), deps);
    expect(err.join("")).toContain("18-month audit log retention limit");
  });

  it("exits 130 after Ctrl-C, keeping rows already written", async () => {
    let interrupt: () => void = () => {};
    const { deps, out, err, exit } = createDeps(async () => ({
      data: Array.from({ length: 1000 }, (_, i) => event(`a${i}`)),
      pagination: { cursor: "c" },
    }));
    const withInterrupt: AuditSearchDeps = {
      ...deps,
      write: (text) => {
        const ok = deps.write(text);
        // Ctrl-C arrives after the third row is printed.
        if (out.length === 3) interrupt();
        return ok;
      },
      onInterrupt: (handler) => {
        interrupt = handler;
        return () => {};
      },
    };

    await expect(runAuditLogsSearch(baseFlags({ fields: "id" }), withInterrupt)).rejects.toThrow("exit 130");
    expect(out.slice(0, 3)).toEqual(['{"id":"a0"}\n', '{"id":"a1"}\n', '{"id":"a2"}\n']);
    expect(err.join("")).toContain("Interrupted; kept 3 events");
    expect(exit).toHaveBeenCalledWith(130);
  });

  it("accepts repeated --result values", () => {
    expect(buildAuditFilters(baseFlags({ result: ["success", "failure"] })).action_result).toEqual({
      in: ["success", "failure"],
      not: [],
    });
  });
});

describe("runAuditLogsFacets", () => {
  it("counts values per field", async () => {
    const { deps, out } = createDeps(async () => ({
      data: [
        event("a"),
        event("b", { resource: { product: "dns_records" } }),
        event("c"),
      ],
    }));
    const flags: AuditFacetsFlags = { ...baseFlags(), facets: "product", top: 10, json: true };

    await runAuditLogsFacets(flags, deps);

    expect(JSON.parse(out[0]!)).toEqual({
      total: 3,
      facets: {
        product: [
          { value: "custom_hostnames", count: 2 },
          { value: "dns_records", count: 1 },
        ],
      },
    });
  });
});
