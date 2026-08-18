import { describe, it, expect, vi } from "vitest";
import {
  formatCustomHostnameDetails,
  runCreateCustomHostname,
  runDeleteCustomHostname,
  runGetCustomHostname,
  runListCustomHostnames,
  runUpdateCustomHostname,
} from "./custom-hostnames.js";

const PENDING_HOSTNAME = {
  id: "ch-1",
  hostname: "app.example.com",
  status: "pending",
  ssl: {
    id: "cert-1",
    status: "pending_validation",
    type: "dv",
    method: "txt",
    certificate_authority: "google",
    hosts: ["app.example.com"],
    validation_records: [
      {
        txt_name: "_acme-challenge.app.example.com",
        txt_value: "810b7d5f01154524b961ba0cd578acc2",
      },
    ],
    validation_errors: [{ message: "SERVFAIL looking up CAA for app.example.com" }],
  },
  verification_errors: ["custom hostname does not CNAME to this zone."],
  ownership_verification: {
    type: "txt",
    name: "_cf-custom-hostname.app.example.com",
    value: "0e2d5a7f-1548-4f27-8c05-b577cb14f4ec",
  },
  created_at: "2026-08-01T12:00:00Z",
};

const ACTIVE_HOSTNAME = {
  id: "ch-2",
  hostname: "shop.example.com",
  status: "active",
  ssl: {
    id: "cert-2",
    status: "active",
    type: "dv",
    method: "http",
    certificate_authority: "google",
    hosts: ["shop.example.com"],
    issuer: "GoogleTrustServices",
    expires_on: "2026-11-01T00:00:00Z",
    wildcard: false,
  },
  created_at: "2026-05-01T12:00:00Z",
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const listCustomHostnames = vi.fn(async () => ({
    hostnames: [PENDING_HOSTNAME, ACTIVE_HOSTNAME],
    resultInfo: { page: 1, per_page: 20, count: 2, total_count: 2, total_pages: 1 },
  }));
  const getCustomHostname = vi.fn(async () => PENDING_HOSTNAME);

  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "test-token" },
      baseUrl: "https://api.cloudflare.com",
      zoneId: "zone-from-env",
    })),
    createClient: vi.fn(() => ({ listCustomHostnames, getCustomHostname })),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    ...overrides,
  } as never;
}

function outputOf(deps: { log: { mock: { calls: unknown[][] } } }): string {
  return deps.log.mock.calls.map((call) => String(call[0])).join("\n");
}

function makeTypedDeps(
  methods: Record<string, unknown>,
  overrides: { isTTY?: () => boolean } = {}
) {
  const log = vi.fn();
  const error = vi.fn();
  const exit = vi.fn(() => undefined as never);
  return {
    log,
    error,
    exit,
    deps: {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "test-token" },
        baseUrl: "https://api.cloudflare.com",
        zoneId: "zone-from-env",
      })),
      createClient: vi.fn(() => methods),
      log,
      error,
      exit,
      isTTY: vi.fn(() => overrides.isTTY?.() ?? true),
      confirm: vi.fn(async () => true),
    } as never,
  };
}

interface SpyFn {
  readonly mock: { readonly calls: unknown[][] };
}

function clientOf(deps: unknown): {
  listCustomHostnames: SpyFn;
  getCustomHostname: SpyFn;
} {
  return (
    deps as {
      createClient: {
        mock: {
          results: {
            value: { listCustomHostnames: SpyFn; getCustomHostname: SpyFn };
          }[];
        };
      };
    }
  ).createClient.mock.results[0]!.value;
}

describe("custom-hostnames list", () => {
  it("forwards filters and the zone override to the SDK", async () => {
    const deps = makeDeps();
    await runListCustomHostnames(
      {
        hostname: "app.example.com",
        ssl: true,
        order: "ssl_status",
        direction: "desc",
        page: 2,
        perPage: 50,
        zoneId: "zone-override",
        json: false,
      },
      deps
    );

    const call = clientOf(deps).listCustomHostnames.mock.calls[0]!;
    expect(call[0]).toMatchObject({
      hostname: "app.example.com",
      ssl: true,
      order: "ssl_status",
      direction: "desc",
      page: 2,
      perPage: 50,
    });
    expect(call[1]).toBe("zone-override");
  });

  it("prints hostname status alongside certificate status", async () => {
    const deps = makeDeps();
    await runListCustomHostnames({ json: false }, deps);

    const output = outputOf(deps as never);
    expect(output).toContain("app.example.com  status=pending ssl=pending_validation");
    expect(output).toContain("shop.example.com  status=active ssl=active");
    expect(output).toContain("expires=2026-11-01T00:00:00Z");
  });

  it("says so when nothing matched", async () => {
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listCustomHostnames: vi.fn(async () => ({ hostnames: [], resultInfo: undefined })),
        getCustomHostname: vi.fn(),
      })),
    });

    await runListCustomHostnames({ json: false }, deps);
    expect(outputOf(deps as never)).toContain("No custom hostnames matched.");
  });

  it("emits JSON when --json is passed", async () => {
    const deps = makeDeps();
    await runListCustomHostnames({ json: true }, deps);

    const parsed = JSON.parse(outputOf(deps as never));
    expect(parsed.hostnames).toHaveLength(2);
  });

  it("exits non-zero with the permission hint on failure", async () => {
    const failure = Object.assign(new Error("Unauthorized"), {
      requiredPermissions: ["SSL and Certificates Read"],
      docsUrl: "https://developers.cloudflare.com/api/resources/custom_hostnames/methods/list/",
    });
    const deps = makeDeps({
      createClient: vi.fn(() => ({
        listCustomHostnames: vi.fn(async () => {
          throw failure;
        }),
        getCustomHostname: vi.fn(),
      })),
    });

    await runListCustomHostnames({ json: false }, deps);
    const errors = (deps as never as { error: { mock: { calls: unknown[][] } } }).error.mock.calls;
    expect(String(errors[0]![0])).toContain("Unauthorized");
    expect((deps as never as { exit: { mock: { calls: unknown[][] } } }).exit).toHaveBeenCalledWith(1);
  });
});

describe("custom-hostnames get", () => {
  it("passes the ID and zone override to the SDK", async () => {
    const deps = makeDeps();
    await runGetCustomHostname("ch-1", { zoneId: "zone-override", json: false }, deps);

    const call = clientOf(deps).getCustomHostname.mock.calls[0]!;
    expect(call[0]).toBe("ch-1");
    expect(call[1]).toBe("zone-override");
  });
});

describe("formatCustomHostnameDetails", () => {
  it("surfaces the validation records, ownership challenge, and readiness", () => {
    const output = formatCustomHostnameDetails(PENDING_HOSTNAME);

    expect(output).toContain("Status:     pending");
    expect(output).toContain("Status:    pending_validation");
    expect(output).toContain("- TXT _acme-challenge.app.example.com = 810b7d5f01154524b961ba0cd578acc2");
    expect(output).toContain("- SERVFAIL looking up CAA for app.example.com");
    expect(output).toContain("- custom hostname does not CNAME to this zone.");
    expect(output).toContain("TXT _cf-custom-hostname.app.example.com = 0e2d5a7f-1548-4f27-8c05-b577cb14f4ec");
    expect(output).toContain("Not ready");
  });

  it("reports a fully provisioned hostname as ready", () => {
    const output = formatCustomHostnameDetails(ACTIVE_HOSTNAME);

    expect(output).toContain("Ready for production traffic");
    expect(output).toContain("Verified (no outstanding ownership challenges).");
    expect(output).toContain("Expires:   2026-11-01T00:00:00Z");
  });
});

describe("custom-hostnames create", () => {
  it("creates a hostname and forwards ssl settings", async () => {
    const createCustomHostname = vi.fn(async () => PENDING_HOSTNAME);
    const { deps } = makeTypedDeps({ createCustomHostname });

    await runCreateCustomHostname(
      "app.example.com",
      {
        sslMethod: "http",
        sslWildcard: false,
        certificateAuthority: "google",
        json: true,
      },
      deps
    );

    expect(createCustomHostname).toHaveBeenCalledWith(
      {
        hostname: "app.example.com",
        custom_origin_server: undefined,
        custom_origin_sni: undefined,
        custom_metadata: undefined,
        ssl: {
          method: "http",
          wildcard: false,
          certificate_authority: "google",
          type: "dv",
        },
      },
      undefined
    );
  });

  it("omits ssl entirely when no ssl flags are passed", async () => {
    const createCustomHostname = vi.fn(async () => ACTIVE_HOSTNAME);
    const { deps } = makeTypedDeps({ createCustomHostname });

    await runCreateCustomHostname("app.example.com", { sslWildcard: false, json: true }, deps);

    expect(createCustomHostname).toHaveBeenCalledWith(
      {
        hostname: "app.example.com",
        custom_origin_server: undefined,
        custom_origin_sni: undefined,
        custom_metadata: undefined,
        ssl: undefined,
      },
      undefined
    );
  });
});

describe("custom-hostnames update", () => {
  it("errors when nothing to update is provided", async () => {
    const updateCustomHostname = vi.fn(async () => PENDING_HOSTNAME);
    const { deps, error } = makeTypedDeps({ updateCustomHostname });

    await runUpdateCustomHostname("ch-1", { sslWildcard: false, json: false }, deps);

    expect(updateCustomHostname).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to update")
    );
  });

  it("forwards origin and metadata", async () => {
    const updateCustomHostname = vi.fn(async () => PENDING_HOSTNAME);
    const { deps } = makeTypedDeps({ updateCustomHostname });

    await runUpdateCustomHostname(
      "ch-1",
      {
        sslWildcard: false,
        customOriginServer: "origin2.example.com",
        // stricli's parsed flag hands runUpdateCustomHostname the parsed object
        metadata: { customer_id: "42" },
        json: true,
      },
      deps
    );

    expect(updateCustomHostname).toHaveBeenCalledWith(
      "ch-1",
      {
        custom_origin_server: "origin2.example.com",
        custom_origin_sni: undefined,
        custom_metadata: { customer_id: "42" },
        ssl: undefined,
      },
      undefined
    );
  });
});

describe("custom-hostnames delete", () => {
  it("refuses without --yes in non-interactive mode", async () => {
    const deleteCustomHostname = vi.fn(async () => undefined);
    const { deps, error } = makeTypedDeps({ deleteCustomHostname }, { isTTY: () => false });

    await runDeleteCustomHostname("ch-1", { json: false, yes: false }, deps);

    expect(deleteCustomHostname).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Pass --yes to proceed non-interactively")
    );
  });

  it("deletes with --yes", async () => {
    const deleteCustomHostname = vi.fn(async () => undefined);
    const { deps } = makeTypedDeps({ deleteCustomHostname });

    await runDeleteCustomHostname("ch-1", { json: false, yes: true }, deps);

    expect(deleteCustomHostname).toHaveBeenCalledWith("ch-1", undefined);
    expect(outputOf(deps)).toContain("Deleted custom hostname ch-1.");
  });
});
