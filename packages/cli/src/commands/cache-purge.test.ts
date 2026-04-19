import { describe, it, expect, vi } from "vitest";
import {
  runPurgeCacheEverything,
  runPurgeCacheByUrls,
  runPurgeCacheByTags,
  runPurgeCacheByPrefixes,
  runPurgeCacheByHosts,
} from "./cache-purge.js";

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
      accountId: "test-account",
      zoneId: "test-zone",
    })),
    createClient: vi.fn(() => ({
      purgeCacheEverything: vi.fn(async () => ({ id: "purge-id-1" })),
      purgeCacheByUrls: vi.fn(async () => ({ id: "purge-id-2" })),
      purgeCacheByTags: vi.fn(async () => ({ id: "purge-id-3" })),
      purgeCacheByPrefixes: vi.fn(async () => ({ id: "purge-id-4" })),
      purgeCacheByHosts: vi.fn(async () => ({ id: "purge-id-5" })),
      ...overrides,
    })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn() as unknown as (code: number) => never,
    isTTY: vi.fn(() => true),
    confirm: vi.fn(async () => true),
  };
}

describe("runPurgeCacheEverything", () => {
  it("purges everything and logs success", async () => {
    const deps = makeDeps();
    await runPurgeCacheEverything({ json: false, yes: true }, deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheEverything).toHaveBeenCalledWith(undefined);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("Cache purge successful (everything)")
    );
  });

  it("passes zoneId flag to client", async () => {
    const deps = makeDeps();
    await runPurgeCacheEverything({ zoneId: "custom-zone", json: false, yes: true }, deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheEverything).toHaveBeenCalledWith("custom-zone");
  });

  it("outputs JSON when --json is set", async () => {
    const deps = makeDeps();
    await runPurgeCacheEverything({ json: true, yes: true }, deps);

    const logged = deps.log.mock.calls[0]![0] as string;
    expect(JSON.parse(logged)).toEqual({ id: "purge-id-1" });
  });

  it("reports errors and exits", async () => {
    const deps = makeDeps({
      purgeCacheEverything: vi.fn(async () => {
        throw new Error("zone not found");
      }),
    });
    await runPurgeCacheEverything({ json: false, yes: true }, deps);

    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("zone not found"));
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("prompts for confirmation when --yes not passed", async () => {
    const deps = makeDeps();
    await runPurgeCacheEverything({ json: false, yes: false }, deps);

    expect(deps.confirm).toHaveBeenCalledOnce();
    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheEverything).toHaveBeenCalled();
  });

  it("aborts when confirmation is declined", async () => {
    const deps = makeDeps();
    deps.confirm.mockResolvedValueOnce(false);
    await runPurgeCacheEverything({ json: false, yes: false }, deps);

    expect(deps.error).toHaveBeenCalledWith("Aborted.");
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.createClient).not.toHaveBeenCalled();
  });

  it("refuses without --yes when stdin is not a TTY", async () => {
    const deps = makeDeps();
    deps.isTTY.mockReturnValueOnce(false);
    await runPurgeCacheEverything({ json: false, yes: false }, deps);

    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("--yes to proceed non-interactively")
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.confirm).not.toHaveBeenCalled();
  });
});

describe("runPurgeCacheByUrls", () => {
  it("purges by URLs and logs success", async () => {
    const deps = makeDeps();
    const urls = ["https://example.com/a", "https://example.com/b"];
    await runPurgeCacheByUrls({ json: false }, urls, deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheByUrls).toHaveBeenCalledWith(urls, undefined);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("2 URL(s)")
    );
  });

  it("passes zoneId flag", async () => {
    const deps = makeDeps();
    await runPurgeCacheByUrls({ zoneId: "z1", json: false }, ["https://x.com"], deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheByUrls).toHaveBeenCalledWith(["https://x.com"], "z1");
  });
});

describe("runPurgeCacheByTags", () => {
  it("purges by tags and logs success", async () => {
    const deps = makeDeps();
    await runPurgeCacheByTags({ json: false }, ["tag-a", "tag-b"], deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheByTags).toHaveBeenCalledWith(["tag-a", "tag-b"], undefined);
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("2 tag(s)")
    );
  });
});

describe("runPurgeCacheByPrefixes", () => {
  it("purges by prefixes and logs success", async () => {
    const deps = makeDeps();
    await runPurgeCacheByPrefixes({ json: false, yes: true }, ["example.com/assets"], deps);

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheByPrefixes).toHaveBeenCalledWith(
      ["example.com/assets"],
      undefined
    );
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("1 prefix(es)")
    );
  });

  it("aborts when confirmation is declined", async () => {
    const deps = makeDeps();
    deps.confirm.mockResolvedValueOnce(false);
    await runPurgeCacheByPrefixes({ json: false, yes: false }, ["example.com/a"], deps);

    expect(deps.error).toHaveBeenCalledWith("Aborted.");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});

describe("runPurgeCacheByHosts", () => {
  it("purges by hosts and logs success", async () => {
    const deps = makeDeps();
    await runPurgeCacheByHosts(
      { json: false, yes: true },
      ["example.com", "cdn.example.com"],
      deps
    );

    const client = deps.createClient.mock.results[0]!.value;
    expect(client.purgeCacheByHosts).toHaveBeenCalledWith(
      ["example.com", "cdn.example.com"],
      undefined
    );
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("2 host(s)")
    );
  });

  it("outputs JSON when --json is set", async () => {
    const deps = makeDeps();
    await runPurgeCacheByHosts({ json: true, yes: true }, ["example.com"], deps);

    const logged = deps.log.mock.calls[0]![0] as string;
    expect(JSON.parse(logged)).toEqual({ id: "purge-id-5" });
  });

  it("refuses without --yes when stdin is not a TTY", async () => {
    const deps = makeDeps();
    deps.isTTY.mockReturnValueOnce(false);
    await runPurgeCacheByHosts({ json: false, yes: false }, ["example.com"], deps);

    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("--yes to proceed non-interactively")
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});
