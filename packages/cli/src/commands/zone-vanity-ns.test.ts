import { describe, it, expect, vi } from "vitest";
import {
  formatVanityNameServers,
  runClearVanityNameServers,
  runGetVanityNameServers,
  runSetVanityNameServers,
} from "./zone-vanity-ns.js";

const DISABLED = {
  zoneId: "zone-1",
  zoneName: "myedgewooddental.com",
  enabled: false,
  nameServers: [] as string[],
  ips: [] as { ns_name?: string; ipv4?: string | null; ipv6?: string | null }[],
  assignedNameServers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
};

const ENABLED = {
  ...DISABLED,
  enabled: true,
  nameServers: ["ns1.myedgewooddental.com", "ns2.myedgewooddental.com"],
  ips: [
    { ns_name: "ns1.myedgewooddental.com", ipv4: "198.51.100.1", ipv6: "2606:4700::1" },
    { ns_name: "ns2.myedgewooddental.com", ipv4: "198.51.100.2", ipv6: "2606:4700::2" },
  ],
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const getZoneVanityNameServers = vi.fn(async () => DISABLED);
  const setZoneVanityNameServers = vi.fn(async () => ENABLED);
  const clearZoneVanityNameServers = vi.fn(async () => DISABLED);

  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
      zoneId: "zone-from-env",
    })),
    createClient: vi.fn(() => ({
      getZoneVanityNameServers,
      setZoneVanityNameServers,
      clearZoneVanityNameServers,
    })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    isTTY: vi.fn(() => false),
    confirm: vi.fn(async () => true),
    ...overrides,
  } as never;
}

function clientOf(deps: unknown) {
  return (
    deps as {
      createClient: {
        mock: {
          results: {
            value: {
              getZoneVanityNameServers: { mock: { calls: unknown[][] } };
              setZoneVanityNameServers: { mock: { calls: unknown[][] } };
              clearZoneVanityNameServers: { mock: { calls: unknown[][] } };
            };
          }[];
        };
      };
    }
  ).createClient.mock.results[0]!.value;
}

function outputOf(deps: unknown): string {
  return (deps as { log: { mock: { calls: unknown[][] } } }).log.mock.calls
    .map((call) => String(call[0]))
    .join("\n");
}

function errorsOf(deps: unknown): string {
  return (deps as { error: { mock: { calls: unknown[][] } } }).error.mock.calls
    .map((call) => String(call[0]))
    .join("\n");
}

describe("formatVanityNameServers", () => {
  it("renders names, Cloudflare nameservers, and glue records", () => {
    const output = formatVanityNameServers(ENABLED);
    expect(output).toContain("Custom nameservers: enabled");
    expect(output).toContain("ns1.myedgewooddental.com, ns2.myedgewooddental.com");
    expect(output).toContain("Glue records:");
    expect(output).toContain("A=198.51.100.1");
    expect(output).toContain("AAAA=2606:4700::2");
  });

  it("reports disabled zones without a glue record section", () => {
    const output = formatVanityNameServers(DISABLED);
    expect(output).toContain("Custom nameservers: disabled");
    expect(output).not.toContain("Glue records:");
  });
});

describe("zones vanity-ns get", () => {
  it("passes the positional zone ID through", async () => {
    const deps = makeDeps();
    await runGetVanityNameServers("zone-9", { json: false }, deps);

    expect(clientOf(deps).getZoneVanityNameServers.mock.calls[0]![0]).toBe("zone-9");
    expect(outputOf(deps)).toContain("Custom nameservers: disabled");
  });

  it("suggests the set command when none are configured", async () => {
    const deps = makeDeps();
    await runGetVanityNameServers(undefined, { json: false }, deps);
    expect(outputOf(deps)).toContain("zones vanity-ns set ns1.myedgewooddental.com");
  });

  it("emits raw JSON with --json", async () => {
    const deps = makeDeps();
    await runGetVanityNameServers(undefined, { json: true }, deps);
    expect(JSON.parse(outputOf(deps))).toEqual(DISABLED);
  });
});

describe("zones vanity-ns set", () => {
  it("requires at least one nameserver", async () => {
    const deps = makeDeps();
    await runSetVanityNameServers([], { json: false, yes: true }, deps);

    expect(errorsOf(deps)).toContain("At least one nameserver is required");
    expect(
      (deps as unknown as { createClient: { mock: { calls: unknown[][] } } })
        .createClient.mock.calls
    ).toHaveLength(0);
  });

  it("rejects names that are not subdomains of the zone", async () => {
    const deps = makeDeps();
    await runSetVanityNameServers(
      ["ns1.example.com"],
      { json: false, yes: true },
      deps
    );

    expect(errorsOf(deps)).toContain(
      "must be subdomains of myedgewooddental.com"
    );
    expect(errorsOf(deps)).toContain("ns1.example.com");
    expect(clientOf(deps).setZoneVanityNameServers.mock.calls).toHaveLength(0);
  });

  it("sends the names and reports the resulting glue records", async () => {
    const deps = makeDeps();
    await runSetVanityNameServers(
      ["ns1.myedgewooddental.com", "ns2.myedgewooddental.com"],
      { json: false, yes: true, zoneId: "zone-9" },
      deps
    );

    expect(clientOf(deps).setZoneVanityNameServers.mock.calls[0]).toEqual([
      ["ns1.myedgewooddental.com", "ns2.myedgewooddental.com"],
      "zone-9",
    ]);
    expect(outputOf(deps)).toContain("A=198.51.100.1");
    expect(outputOf(deps)).toContain("glue records, at your registrar");
  });

  it("refuses to change nameservers non-interactively without --yes", async () => {
    const deps = makeDeps();
    await runSetVanityNameServers(
      ["ns1.myedgewooddental.com"],
      { json: false, yes: false },
      deps
    );

    expect(errorsOf(deps)).toContain("Pass --yes to proceed non-interactively");
    expect(clientOf(deps).setZoneVanityNameServers.mock.calls).toHaveLength(0);
  });

  it("shows the before and after names in the interactive prompt", async () => {
    const confirm = vi.fn(async (_prompt: string) => true);
    const deps = makeDeps({
      isTTY: vi.fn(() => true),
      confirm,
      createClient: vi.fn(() => ({
        getZoneVanityNameServers: vi.fn(async () => ENABLED),
        setZoneVanityNameServers: vi.fn(async () => ENABLED),
        clearZoneVanityNameServers: vi.fn(async () => DISABLED),
      })),
    });

    await runSetVanityNameServers(
      ["ns3.myedgewooddental.com"],
      { json: false, yes: false },
      deps
    );

    expect(String(confirm.mock.calls[0]![0])).toContain(
      "from [ns1.myedgewooddental.com, ns2.myedgewooddental.com] to [ns3.myedgewooddental.com]"
    );
  });

  it("aborts when the prompt is declined", async () => {
    const deps = makeDeps({
      isTTY: vi.fn(() => true),
      confirm: vi.fn(async () => false),
    });

    await runSetVanityNameServers(
      ["ns1.myedgewooddental.com"],
      { json: false, yes: false },
      deps
    );

    expect(errorsOf(deps)).toContain("Aborted.");
    expect(clientOf(deps).setZoneVanityNameServers.mock.calls).toHaveLength(0);
  });
});

describe("zones vanity-ns clear", () => {
  it("is a no-op when the zone has none configured", async () => {
    const deps = makeDeps();
    await runClearVanityNameServers({ json: false, yes: true }, deps);

    expect(outputOf(deps)).toContain("has no custom nameservers configured");
    expect(clientOf(deps).clearZoneVanityNameServers.mock.calls).toHaveLength(0);
  });

  it("removes configured nameservers and names the fallback", async () => {
    const clearZoneVanityNameServers = vi.fn(async () => DISABLED);
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        getZoneVanityNameServers: vi.fn(async () => ENABLED),
        setZoneVanityNameServers: vi.fn(async () => ENABLED),
        clearZoneVanityNameServers,
      })),
    });

    await runClearVanityNameServers({ json: false, yes: true, zoneId: "zone-9" }, deps);

    expect(clearZoneVanityNameServers.mock.calls[0]).toEqual(["zone-9"]);
    expect(outputOf(deps)).toContain("Custom nameservers: disabled");
    expect(outputOf(deps)).toContain("bob.ns.cloudflare.com, lola.ns.cloudflare.com");
  });

  it("refuses to remove nameservers non-interactively without --yes", async () => {
    const clearZoneVanityNameServers = vi.fn(async () => DISABLED);
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        getZoneVanityNameServers: vi.fn(async () => ENABLED),
        setZoneVanityNameServers: vi.fn(async () => ENABLED),
        clearZoneVanityNameServers,
      })),
    });

    await runClearVanityNameServers({ json: false, yes: false }, deps);

    expect(errorsOf(deps)).toContain("Pass --yes to proceed non-interactively");
    expect(clearZoneVanityNameServers.mock.calls).toHaveLength(0);
  });
});
