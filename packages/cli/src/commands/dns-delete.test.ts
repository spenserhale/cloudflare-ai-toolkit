import { describe, it, expect, vi } from "vitest";
import { runDeleteDnsRecords } from "./dns-delete.js";

function makeDeps(
  deleteDnsRecord: (zoneId: string, recordId: string) => Promise<void>,
  overrides: { isTTY?: () => boolean; confirm?: (prompt: string) => Promise<boolean> } = {}
) {
  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
    })),
    createClient: vi.fn(() => ({ deleteDnsRecord })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    isTTY: overrides.isTTY ?? (() => true),
    confirm: overrides.confirm ?? vi.fn(async () => true),
  };
}

function outputOf(fn: { mock: { calls: unknown[][] } }): string {
  return fn.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("dns records delete", () => {
  it("refuses without --yes in non-interactive mode", async () => {
    const deleteDnsRecord = vi.fn(async () => undefined);
    const deps = makeDeps(deleteDnsRecord, { isTTY: () => false });

    await runDeleteDnsRecords("zone-1", ["rec-1"], { json: false, yes: false }, deps);

    expect(deleteDnsRecord).not.toHaveBeenCalled();
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to proceed non-interactively")
    );
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("aborts when the prompt is declined", async () => {
    const deleteDnsRecord = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => false);
    const deps = makeDeps(deleteDnsRecord, { confirm });

    await runDeleteDnsRecords("zone-1", ["rec-1", "rec-2"], { json: false, yes: false }, deps);

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("rec-1, rec-2"));
    expect(deleteDnsRecord).not.toHaveBeenCalled();
    expect(deps.error).toHaveBeenCalledWith("Aborted.");
  });

  it("deletes every record with --yes", async () => {
    const deleteDnsRecord = vi.fn(async () => undefined);
    const deps = makeDeps(deleteDnsRecord);

    await runDeleteDnsRecords("zone-1", ["rec-1", "rec-2"], { json: false, yes: true }, deps);

    expect(deleteDnsRecord).toHaveBeenNthCalledWith(1, "zone-1", "rec-1");
    expect(deleteDnsRecord).toHaveBeenNthCalledWith(2, "zone-1", "rec-2");
    expect(outputOf(deps.log)).toContain("Deleted DNS record rec-1.");
    expect(outputOf(deps.log)).toContain("Deleted DNS record rec-2.");
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("emits JSON when --json is passed", async () => {
    const deps = makeDeps(vi.fn(async () => undefined));

    await runDeleteDnsRecords("zone-1", ["rec-1"], { json: true, yes: true }, deps);

    expect(JSON.parse(outputOf(deps.log))).toEqual({ deleted: ["rec-1"] });
  });

  it("stops at the first failure and reports what was already deleted", async () => {
    const deleteDnsRecord = vi.fn(async (_zoneId: string, recordId: string) => {
      if (recordId === "rec-2") throw new Error("Record does not exist.");
    });
    const deps = makeDeps(deleteDnsRecord);

    await runDeleteDnsRecords(
      "zone-1",
      ["rec-1", "rec-2", "rec-3"],
      { json: false, yes: true },
      deps
    );

    expect(deleteDnsRecord).toHaveBeenCalledTimes(2);
    const errors = outputOf(deps.error);
    expect(errors).toContain("Deleted before failure: rec-1");
    expect(errors).toContain("Failed to delete DNS record rec-2: Record does not exist.");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("requires at least one record ID", async () => {
    const deleteDnsRecord = vi.fn(async () => undefined);
    const deps = makeDeps(deleteDnsRecord);

    await runDeleteDnsRecords("zone-1", [], { json: false, yes: true }, deps);

    expect(deleteDnsRecord).not.toHaveBeenCalled();
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("Specify at least one DNS record ID.")
    );
  });
});
