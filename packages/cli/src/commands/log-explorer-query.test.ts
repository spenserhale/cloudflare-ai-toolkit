import { describe, expect, it, vi } from "vitest";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";
import {
  runLogExplorerQuery,
  type LogExplorerQueryFlags,
} from "./log-explorer-query.js";

function baseFlags(overrides: Partial<LogExplorerQueryFlags> = {}): LogExplorerQueryFlags {
  return {
    stdin: false,
    json: false,
    ...overrides,
  };
}

type QueryResult = { rows: Record<string, unknown>[] };

function makeDeps(overrides: Partial<Parameters<typeof runLogExplorerQuery>[1]> = {}) {
  const queryLogExplorer = vi.fn<(...args: unknown[]) => Promise<QueryResult>>(
    async () => ({ rows: [{ a: 1 }] })
  );
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn((code: number) => {
    throw new Error(`EXIT:${code}`);
  });
  return {
    queryLogExplorer,
    log,
    error,
    exit,
    deps: {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({ queryLogExplorer })),
      readFile: vi.fn(() => ""),
      readStdin: vi.fn(async () => ""),
      log,
      error,
      exit,
      // Progress off by default so existing assertions see a clean stderr.
      isStderrTTY: vi.fn(() => false),
      setInterval: vi.fn(() => 0 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn(),
      now: vi.fn(() => 0),
      ...overrides,
    },
  };
}

/**
 * Fake clock + timer so heartbeat tests advance time explicitly instead of
 * waiting on real intervals.
 */
function makeClock() {
  const handle = 1 as unknown as ReturnType<typeof setInterval>;
  const ticks: Array<() => void> = [];
  let current = 0;
  let registeredMs: number | undefined;
  const cleared: Array<ReturnType<typeof setInterval>> = [];

  return {
    handle,
    cleared,
    registeredMs: () => registeredMs,
    advance: (ms: number) => {
      current += ms;
    },
    tick: () => {
      for (const fn of ticks) fn();
    },
    deps: {
      now: vi.fn(() => current),
      setInterval: vi.fn((fn: () => void, ms: number) => {
        ticks.push(fn);
        registeredMs = ms;
        return handle;
      }),
      clearInterval: vi.fn((h: ReturnType<typeof setInterval>) => {
        cleared.push(h);
      }),
    },
  };
}

describe("runLogExplorerQuery", () => {
  it("runs a query passed via --sql and renders TOON by default", async () => {
    const { queryLogExplorer, log, error, exit, deps } = makeDeps();

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1" }), deps);

    expect(queryLogExplorer).toHaveBeenCalledWith(
      { sql: "SELECT 1", scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("rows");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json is set", async () => {
    const { queryLogExplorer, log, deps } = makeDeps();
    queryLogExplorer.mockResolvedValueOnce({ rows: [{ x: "y" }] });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT x", json: true }), deps);

    const out = log.mock.calls[0]?.[0];
    expect(typeof out).toBe("string");
    expect(JSON.parse(out as string)).toEqual({ rows: [{ x: "y" }] });
  });

  it("reads SQL from --file when --sql is not given", async () => {
    const { queryLogExplorer, deps } = makeDeps();
    (deps.readFile as ReturnType<typeof vi.fn>).mockReturnValue(
      "  SELECT count() FROM http_requests  \n"
    );

    await runLogExplorerQuery(baseFlags({ file: "query.sql" }), deps);

    expect(deps.readFile).toHaveBeenCalledWith("query.sql");
    expect(queryLogExplorer).toHaveBeenCalledWith(
      { sql: "SELECT count() FROM http_requests", scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
  });

  it("reads SQL from stdin when --stdin is set", async () => {
    const { queryLogExplorer, deps } = makeDeps();
    (deps.readStdin as ReturnType<typeof vi.fn>).mockResolvedValue("SELECT 7");

    await runLogExplorerQuery(baseFlags({ stdin: true }), deps);

    expect(deps.readStdin).toHaveBeenCalled();
    expect(queryLogExplorer).toHaveBeenCalledWith(
      { sql: "SELECT 7", scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
  });

  it("rejects when no SQL source is provided", async () => {
    const { error, deps } = makeDeps();

    await expect(runLogExplorerQuery(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Provide SQL via --sql")
    );
  });

  it("rejects when multiple SQL sources are provided", async () => {
    const { error, deps } = makeDeps();

    await expect(
      runLogExplorerQuery(baseFlags({ sql: "SELECT 1", stdin: true }), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("exactly one of")
    );
  });

  it("rejects empty SQL", async () => {
    const { error, deps } = makeDeps();

    await expect(
      runLogExplorerQuery(baseFlags({ sql: "   " }), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("SQL query is empty"));
  });

  it("forwards scope and explicit IDs to the client", async () => {
    const { queryLogExplorer, deps } = makeDeps();

    await runLogExplorerQuery(
      baseFlags({
        sql: "SELECT 1",
        scope: "account",
        accountId: "acc-x",
        zoneId: "zone-x",
      }),
      deps
    );

    expect(queryLogExplorer).toHaveBeenCalledWith(
      { sql: "SELECT 1", scope: "account" },
      { accountId: "acc-x", zoneId: "zone-x" }
    );
  });

  it("renders permission hints from CloudflareError", async () => {
    const { error, deps } = makeDeps();
    (deps.createClient as ReturnType<typeof vi.fn>).mockReturnValue({
      queryLogExplorer: vi.fn(async () => {
        throw new CloudflareError("Authentication error", "AUTH_ERROR", 403, {
          requiredPermissions: ["Logs Read"],
          docsUrl: "https://developers.cloudflare.com/log-explorer/api/",
        });
      }),
    });

    await expect(
      runLogExplorerQuery(baseFlags({ sql: "SELECT 1" }), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Required permission for this endpoint: 'Logs Read'")
    );
  });

  it("formats Zod response-shape errors with a clear message", async () => {
    const { error, deps } = makeDeps();
    (deps.createClient as ReturnType<typeof vi.fn>).mockReturnValue({
      queryLogExplorer: vi.fn(async () => {
        throw {
          name: "ZodError",
          issues: [{ path: ["rows", 0, "ts"], message: "Required" }],
        };
      }),
    });

    await expect(
      runLogExplorerQuery(baseFlags({ sql: "SELECT 1" }), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      "Error: Unexpected Cloudflare API response shape (rows.0.ts): Required"
    );
  });
});

describe("runLogExplorerQuery progress reporting", () => {
  it("stays silent by default when stderr is not a TTY", async () => {
    const clock = makeClock();
    const { error, deps } = makeDeps({ ...clock.deps, isStderrTTY: vi.fn(() => false) });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1" }), deps);

    expect(clock.deps.setInterval).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("reports progress by default when stderr is a TTY", async () => {
    const clock = makeClock();
    const { deps } = makeDeps({ ...clock.deps, isStderrTTY: vi.fn(() => true) });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1" }), deps);

    expect(clock.deps.setInterval).toHaveBeenCalled();
    expect(clock.registeredMs()).toBe(30_000);
  });

  it("emits elapsed-time notices on stderr, never stdout", async () => {
    const clock = makeClock();
    const queryLogExplorer = vi.fn(async () => {
      // Query is in flight: two heartbeat intervals pass.
      clock.advance(30_000);
      clock.tick();
      clock.advance(45_000);
      clock.tick();
      return { rows: [{ a: 1 }] };
    });
    const { log, error, deps } = makeDeps({
      ...clock.deps,
      createClient: vi.fn(() => ({ queryLogExplorer })),
    });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1", progress: true, json: true }), deps);

    const stderr = error.mock.calls.map((c) => String(c[0]));
    expect(stderr[0]).toBe("Still running... 30s elapsed.");
    expect(stderr[1]).toBe("Still running... 1m15s elapsed.");
    expect(stderr[2]).toBe("Completed in 1m15s (1 row).");

    // stdout carries only the JSON payload, so it stays pipeable to a file.
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({ rows: [{ a: 1 }] });
  });

  it("honors --no-progress even when stderr is a TTY", async () => {
    const clock = makeClock();
    const { error, deps } = makeDeps({ ...clock.deps, isStderrTTY: vi.fn(() => true) });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1", progress: false }), deps);

    expect(clock.deps.setInterval).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("honors a custom --progressInterval", async () => {
    const clock = makeClock();
    const { deps } = makeDeps({ ...clock.deps });

    await runLogExplorerQuery(
      baseFlags({ sql: "SELECT 1", progress: true, progressInterval: 5 }),
      deps
    );

    expect(clock.registeredMs()).toBe(5_000);
  });

  it("stops the heartbeat when the query fails", async () => {
    const clock = makeClock();
    const queryLogExplorer = vi.fn(async () => {
      throw new CloudflareError("HTTP 524", "UNKNOWN", 524);
    });
    const { error, deps } = makeDeps({
      ...clock.deps,
      createClient: vi.fn(() => ({ queryLogExplorer })),
    });

    await expect(
      runLogExplorerQuery(baseFlags({ sql: "SELECT 1", progress: true }), deps)
    ).rejects.toThrow("EXIT:1");

    expect(clock.cleared).toEqual([clock.handle]);
    // No bogus "Completed" line on the failure path.
    const stderr = error.mock.calls.map((c) => String(c[0]));
    expect(stderr.some((line) => line.startsWith("Completed"))).toBe(false);
    expect(stderr.some((line) => line.includes("524"))).toBe(true);
  });

  it("pluralizes the completion row count", async () => {
    const clock = makeClock();
    const queryLogExplorer = vi.fn(async () => ({ rows: [{ a: 1 }, { a: 2 }] }));
    const { error, deps } = makeDeps({
      ...clock.deps,
      createClient: vi.fn(() => ({ queryLogExplorer })),
    });

    await runLogExplorerQuery(baseFlags({ sql: "SELECT 1", progress: true }), deps);

    const stderr = error.mock.calls.map((c) => String(c[0]));
    expect(stderr.at(-1)).toBe("Completed in 0s (2 rows).");
  });
});
