import { describe, it, expect, vi } from "vitest";
import { formatZoneDetails, runGetZone, runListZones } from "./zones.js";

const ZONE = {
  id: "zone-1",
  name: "myedgewooddental.com",
  status: "active",
  paused: false,
  type: "full",
  account: { id: "acc-1", name: "Example Account" },
  plan: { id: "plan-1", name: "Free Website" },
  name_servers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
  original_name_servers: null,
  original_registrar: "GoDaddy",
  development_mode: 0,
  created_on: "2024-01-01T05:20:00Z",
  activated_on: "2024-01-02T00:01:00Z",
  modified_on: "2026-08-01T00:00:00Z",
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const listZones = vi.fn(async () => ({
    zones: [ZONE],
    resultInfo: { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 },
  }));
  const getZone = vi.fn(async () => ZONE);

  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
      zoneId: "zone-from-env",
    })),
    createClient: vi.fn(() => ({ listZones, getZone })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    ...overrides,
  } as never;
}

function outputOf(deps: { log: { mock: { calls: unknown[][] } } }): string {
  return deps.log.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("zones list", () => {
  it("passes the positional name through as an exact filter", async () => {
    const deps = makeDeps();
    await runListZones("myedgewooddental.com", { json: false }, deps);

    const client = (deps as never as { createClient: { mock: { results: { value: { listZones: { mock: { calls: unknown[][] } } } }[] } } })
      .createClient.mock.results[0]!.value;
    expect(client.listZones.mock.calls[0]![0]).toMatchObject({
      name: "myedgewooddental.com",
      nameOperator: undefined,
    });
    expect(outputOf(deps as never)).toContain("myedgewooddental.com");
    expect(outputOf(deps as never)).toContain("status=active");
  });

  it("forwards the name operator for partial searches", async () => {
    const deps = makeDeps();
    await runListZones("dental", { operator: "contains", json: false }, deps);

    const client = (deps as never as { createClient: { mock: { results: { value: { listZones: { mock: { calls: unknown[][] } } } }[] } } })
      .createClient.mock.results[0]!.value;
    expect(client.listZones.mock.calls[0]![0]).toMatchObject({
      name: "dental",
      nameOperator: "contains",
    });
  });

  it("rejects --operator without a name argument", async () => {
    const deps = makeDeps();
    await runListZones(undefined, { operator: "contains", json: false }, deps);

    const errors = (deps as never as { error: { mock: { calls: unknown[][] } } }).error.mock.calls;
    expect(String(errors[0]![0])).toContain("--operator only applies to a zone name");
    expect((deps as never as { exit: { mock: { calls: unknown[][] } } }).exit).toHaveBeenCalledWith(1);
  });

  it("suggests --operator contains when an exact name match finds nothing", async () => {
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listZones: vi.fn(async () => ({ zones: [], resultInfo: undefined })),
        getZone: vi.fn(),
      })),
    });

    await runListZones("edgewood", { json: false }, deps);
    expect(outputOf(deps as never)).toContain("--operator contains");
  });

  it("emits JSON when --json is passed", async () => {
    const deps = makeDeps();
    await runListZones(undefined, { json: true }, deps);

    const parsed = JSON.parse(outputOf(deps as never));
    expect(parsed.zones[0].id).toBe("zone-1");
  });

  it("reports permission hints from failures", async () => {
    const failure = Object.assign(new Error("Unauthorized"), {
      requiredPermissions: ["Zone Read"],
      docsUrl: "https://developers.cloudflare.com/api/resources/zones/methods/list/",
    });
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listZones: vi.fn(async () => {
          throw failure;
        }),
        getZone: vi.fn(),
      })),
    });

    await runListZones(undefined, { json: false }, deps);
    const errors = (deps as never as { error: { mock: { calls: unknown[][] } } }).error.mock.calls;
    expect(String(errors[0]![0])).toContain("Unauthorized");
    expect((deps as never as { exit: { mock: { calls: unknown[][] } } }).exit).toHaveBeenCalledWith(1);
  });
});

describe("zones get", () => {
  it("falls back to the configured zone when no ID is given", async () => {
    const deps = makeDeps();
    await runGetZone(undefined, { json: false }, deps);

    const client = (deps as never as { createClient: { mock: { results: { value: { getZone: { mock: { calls: unknown[][] } } } }[] } } })
      .createClient.mock.results[0]!.value;
    expect(client.getZone.mock.calls[0]![0]).toBeUndefined();
    expect(outputOf(deps as never)).toContain("Zone zone-1");
  });
});

describe("formatZoneDetails", () => {
  it("renders nameservers and dashes for missing values", () => {
    const output = formatZoneDetails(ZONE);
    expect(output).toContain("Nameservers: bob.ns.cloudflare.com, lola.ns.cloudflare.com");
    expect(output).toContain("Original NS: -");
    expect(output).toContain("Account:     Example Account (acc-1)");
  });
});
