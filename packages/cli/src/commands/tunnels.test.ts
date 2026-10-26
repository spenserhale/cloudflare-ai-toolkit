import { describe, it, expect, vi } from "vitest";
import { formatTunnelInfo, runListTunnels, runTunnelInfo } from "./tunnels.js";

const TUNNEL_ID = "f70ff985-a4ef-4643-bbbc-4a0ed4fc8415";

const TUNNEL = {
  id: TUNNEL_ID,
  name: "office-gateway",
  status: "healthy",
  tun_type: "cfd_tunnel",
  config_src: "cloudflare",
  created_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  conns_active_at: "2026-10-01T00:00:00Z",
  conns_inactive_at: null,
};

const CONNECTOR = {
  id: "1bedc50d-42b3-473c-b108-ff3d10c0d925",
  arch: "linux_amd64",
  version: "2026.9.1",
  run_at: "2026-10-01T00:00:00Z",
  conns: [
    { colo_name: "sea01", origin_ip: "203.0.113.10", opened_at: "2026-10-01T00:00:01Z" },
    { colo_name: "pdx01", origin_ip: "203.0.113.10", opened_at: "2026-10-01T00:00:02Z" },
  ],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const listTunnels = vi.fn(async (_params: unknown) => ({
    tunnels: [TUNNEL],
    resultInfo: { page: 1, per_page: 20, count: 1, total_count: 1 },
  }));
  const getTunnelInfo = vi.fn(async (_id: string, _accountId?: string) => ({ tunnel: TUNNEL, connectors: [CONNECTOR] }));

  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
      accountId: "acc-1",
    })),
    createClient: vi.fn(() => ({ listTunnels, getTunnelInfo })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    listTunnels,
    getTunnelInfo,
    ...overrides,
  };
}

function outputOf(deps: { log: { mock: { calls: unknown[][] } } }): string {
  return deps.log.mock.calls.map((call) => String(call[0])).join("\n");
}

function errorsOf(deps: { error: { mock: { calls: unknown[][] } } }): string {
  return deps.error.mock.calls.map((call) => String(call[0])).join("\n");
}

describe("tunnels list", () => {
  it("hides deleted tunnels by default", async () => {
    const deps = makeDeps();
    await runListTunnels(undefined, { includeDeleted: false, json: false }, deps as never);

    expect(deps.listTunnels.mock.calls[0]![0]).toMatchObject({ isDeleted: false });
    expect(outputOf(deps)).toContain(`${TUNNEL_ID}  office-gateway  status=healthy`);
  });

  it("drops the is_deleted filter with --includeDeleted", async () => {
    const deps = makeDeps();
    await runListTunnels(
      "office-gateway",
      { includeDeleted: true, status: "down", accountId: "acc-2", json: false },
      deps as never
    );

    expect(deps.listTunnels.mock.calls[0]![0]).toMatchObject({
      name: "office-gateway",
      status: "down",
      isDeleted: undefined,
      accountId: "acc-2",
    });
  });

  it("prints JSON when asked", async () => {
    const deps = makeDeps();
    await runListTunnels(undefined, { includeDeleted: false, json: true }, deps as never);

    expect(JSON.parse(outputOf(deps)).tunnels[0].id).toBe(TUNNEL_ID);
  });

  it("explains an empty name match", async () => {
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listTunnels: vi.fn(async () => ({ tunnels: [] })),
        getTunnelInfo: vi.fn(),
      })),
    });
    await runListTunnels("nope", { includeDeleted: false, json: false }, deps as never);

    expect(outputOf(deps)).toContain("No tunnel is named 'nope'.");
  });
});

describe("tunnels info", () => {
  it("fetches by ID without a name lookup", async () => {
    const deps = makeDeps();
    await runTunnelInfo(TUNNEL_ID, { json: false }, deps as never);

    expect(deps.listTunnels).not.toHaveBeenCalled();
    expect(deps.getTunnelInfo).toHaveBeenCalledWith(TUNNEL_ID, undefined);
    expect(outputOf(deps)).toContain("Connectors (1):");
    expect(outputOf(deps)).toContain("sea01  origin=203.0.113.10");
  });

  it("resolves a tunnel name to its ID", async () => {
    const deps = makeDeps();
    await runTunnelInfo("office-gateway", { accountId: "acc-2", json: false }, deps as never);

    expect(deps.listTunnels.mock.calls[0]![0]).toMatchObject({
      name: "office-gateway",
      isDeleted: false,
      accountId: "acc-2",
    });
    expect(deps.getTunnelInfo).toHaveBeenCalledWith(TUNNEL_ID, "acc-2");
  });

  it("fails when no tunnel has the name", async () => {
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listTunnels: vi.fn(async () => ({ tunnels: [] })),
        getTunnelInfo: vi.fn(),
      })),
    });
    await runTunnelInfo("missing", { json: false }, deps as never);

    expect(errorsOf(deps)).toContain("No tunnel is named 'missing'");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("refuses an ambiguous name", async () => {
    const other = { ...TUNNEL, id: "00000000-0000-4000-8000-000000000000" };
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listTunnels: vi.fn(async () => ({ tunnels: [TUNNEL, other] })),
        getTunnelInfo: vi.fn(),
      })),
    });
    await runTunnelInfo("office-gateway", { json: false }, deps as never);

    expect(errorsOf(deps)).toContain("Multiple tunnels are named 'office-gateway'");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("reports a tunnel with no running connectors", () => {
    const text = formatTunnelInfo({ tunnel: { ...TUNNEL, status: "inactive" }, connectors: [] });
    expect(text).toContain("Status:      inactive");
    expect(text).toContain("Connectors: none");
  });
});
