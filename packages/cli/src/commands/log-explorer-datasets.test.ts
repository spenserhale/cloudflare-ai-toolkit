import { describe, expect, it, vi } from "vitest";
import type {
  AvailableLogExplorerDataset,
  CloudflareClient,
  LogExplorerDataset,
} from "@cloudflare-ai-toolkit/sdk";
import {
  runDeleteLogExplorerDataset,
  runGetLogExplorerDataset,
  runListAvailableLogExplorerDatasets,
  runListLogExplorerDatasets,
  runUpdateLogExplorerDataset,
  type DeleteDatasetFlags,
  type GetDatasetFlags,
  type ListDatasetsFlags,
  type UpdateDatasetFlags,
} from "./log-explorer-datasets.js";

type DatasetClientMethods = Pick<
  CloudflareClient,
  | "listLogExplorerDatasets"
  | "listAvailableLogExplorerDatasets"
  | "getLogExplorerDataset"
  | "updateLogExplorerDataset"
  | "deleteLogExplorerDataset"
>;

const dataset: LogExplorerDataset = {
  dataset: "http_requests",
  object_type: "zone",
  object_id: "zone-1",
  dataset_id: "ds-1",
  enabled: true,
  deletion_protection: false,
  fields: [
    { enabled: true, name: "ClientIP" },
    { enabled: false, name: "RayID" },
  ],
  created_at: "2026-05-12T00:00:00Z",
  updated_at: "2026-05-12T00:00:00Z",
};

const available: AvailableLogExplorerDataset = {
  dataset: "http_requests",
  object_type: "zone",
  timestamp_field: "EdgeStartTimestamp",
  schema: {
    type: "object",
    properties: { ClientIP: { type: "string" }, RayID: { type: "string" } },
    required: ["ClientIP"],
  },
};

function makeDeps(methods: Partial<DatasetClientMethods> = {}) {
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn((code: number) => {
    throw new Error(`EXIT:${code}`);
  });
  return {
    log,
    error,
    exit,
    deps: {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => methods as DatasetClientMethods),
      log,
      error,
      exit,
      isTTY: vi.fn(() => true),
      confirm: vi.fn(async () => true),
    },
  };
}

function listFlags(overrides: Partial<ListDatasetsFlags> = {}): ListDatasetsFlags {
  return { includeZones: false, json: false, ...overrides };
}

function getFlags(overrides: Partial<GetDatasetFlags> = {}): GetDatasetFlags {
  return { json: false, ...overrides };
}

describe("runListLogExplorerDatasets", () => {
  it("lists datasets in human format and forwards includeZones", async () => {
    const listLogExplorerDatasets = vi.fn(async () => [dataset]);
    const { log, error, exit, deps } = makeDeps({ listLogExplorerDatasets });

    await runListLogExplorerDatasets(listFlags({ includeZones: true }), deps);

    expect(listLogExplorerDatasets).toHaveBeenCalledWith(
      { scope: undefined, includeZones: true },
      { accountId: undefined, zoneId: undefined }
    );
    expect(log.mock.calls[0]?.[0]).toContain("Showing 1 dataset");
    expect(log.mock.calls[1]?.[0]).toContain("ds-1  http_requests  enabled=true zone/zone-1");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("outputs JSON when --json is set", async () => {
    const listLogExplorerDatasets = vi.fn(async () => [dataset]);
    const { log, deps } = makeDeps({ listLogExplorerDatasets });

    await runListLogExplorerDatasets(listFlags({ json: true }), deps);

    expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toEqual([dataset]);
  });

  it("hints at enable/available when empty", async () => {
    const listLogExplorerDatasets = vi.fn(async () => []);
    const { log, deps } = makeDeps({ listLogExplorerDatasets });

    await runListLogExplorerDatasets(listFlags(), deps);

    expect(log.mock.calls[1]?.[0]).toContain("datasets available");
  });
});

describe("runListAvailableLogExplorerDatasets", () => {
  it("lists available datasets with timestamp fields", async () => {
    const listAvailableLogExplorerDatasets = vi.fn(async () => [available]);
    const { log, error, deps } = makeDeps({ listAvailableLogExplorerDatasets });

    await runListAvailableLogExplorerDatasets(getFlags(), deps);

    expect(listAvailableLogExplorerDatasets).toHaveBeenCalledWith(
      { scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
    expect(log.mock.calls[1]?.[0]).toContain(
      "http_requests  zone  timestamp=EdgeStartTimestamp  fields=2"
    );
    expect(error).not.toHaveBeenCalled();
  });
});

describe("runGetLogExplorerDataset", () => {
  it("prints dataset details including field configuration", async () => {
    const getLogExplorerDataset = vi.fn(async () => dataset);
    const { log, deps } = makeDeps({ getLogExplorerDataset });

    await runGetLogExplorerDataset("ds-1", getFlags(), deps);

    expect(getLogExplorerDataset).toHaveBeenCalledWith(
      { datasetId: "ds-1", scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
    const out = log.mock.calls[0]?.[0] as string;
    expect(out).toContain("Dataset:      http_requests");
    expect(out).toContain("Fields:       1 of 2 enabled");
    expect(out).toContain("* ClientIP");
    expect(out).toContain("  RayID");
  });
});

describe("runUpdateLogExplorerDataset", () => {
  function updateFlags(overrides: Partial<UpdateDatasetFlags> = {}): UpdateDatasetFlags {
    return { json: false, ...overrides };
  }

  it("requires --enabled", async () => {
    const { error, deps } = makeDeps();

    await expect(
      runUpdateLogExplorerDataset("ds-1", updateFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --enabled true or --enabled false")
    );
  });

  it("PUTs fields, filter, and deletionProtection", async () => {
    const updateLogExplorerDataset = vi.fn(async () => dataset);
    const { deps } = makeDeps({ updateLogExplorerDataset });

    await runUpdateLogExplorerDataset(
      "ds-1",
      updateFlags({
        enabled: true,
        fields: [
          { name: "ClientIP", enabled: true },
          { name: "RayID", enabled: false },
        ],
        filter: '{http.request.method=="GET"}',
        deletionProtection: false,
        scope: "account",
        accountId: "acc-x",
      }),
      deps
    );

    expect(updateLogExplorerDataset).toHaveBeenCalledWith(
      {
        datasetId: "ds-1",
        enabled: true,
        fields: [
          { name: "ClientIP", enabled: true },
          { name: "RayID", enabled: false },
        ],
        filter: '{http.request.method=="GET"}',
        deletionProtection: false,
        scope: "account",
      },
      { accountId: "acc-x", zoneId: undefined }
    );
  });
});

describe("runDeleteLogExplorerDataset", () => {
  function deleteFlags(overrides: Partial<DeleteDatasetFlags> = {}): DeleteDatasetFlags {
    return { json: false, yes: false, ...overrides };
  }

  it("refuses to delete without confirmation in non-interactive mode", async () => {
    const deleteLogExplorerDataset = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteLogExplorerDataset });
    (deps.isTTY as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(
      runDeleteLogExplorerDataset("ds-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to proceed non-interactively")
    );
    expect(deleteLogExplorerDataset).not.toHaveBeenCalled();
  });

  it("skips the prompt with --yes and deletes", async () => {
    const deleteLogExplorerDataset = vi.fn(async () => undefined);
    const { log, error, exit, deps } = makeDeps({ deleteLogExplorerDataset });

    await runDeleteLogExplorerDataset("ds-1", deleteFlags({ yes: true }), deps);

    expect(deleteLogExplorerDataset).toHaveBeenCalledWith(
      { datasetId: "ds-1", scope: undefined },
      { accountId: undefined, zoneId: undefined }
    );
    expect(log).toHaveBeenCalledWith("Deleted Log Explorer dataset ds-1.");
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("aborts when the interactive confirmation is declined", async () => {
    const deleteLogExplorerDataset = vi.fn(async () => undefined);
    const { error, deps } = makeDeps({ deleteLogExplorerDataset });
    (deps.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await expect(
      runDeleteLogExplorerDataset("ds-1", deleteFlags(), deps)
    ).rejects.toThrow("EXIT:1");
    expect(error).toHaveBeenCalledWith("Aborted.");
    expect(deleteLogExplorerDataset).not.toHaveBeenCalled();
  });
});
