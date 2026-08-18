import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = join(PACKAGE_ROOT, "src/bin.ts");
const BUN_BIN = process.env.BUN_BIN ?? "bun";

interface MockRoute {
  readonly method: string;
  readonly pathname: string;
  readonly status: number;
  readonly body: unknown;
  readonly expectedHeaders?: Record<string, string>;
  readonly forbiddenHeaders?: readonly string[];
}

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const PRELOAD_SCRIPT = `
const routes = JSON.parse(process.env.MOCK_ROUTES ?? "[]");

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);

  const route = routes.find((candidate) =>
    candidate.method === request.method && candidate.pathname === url.pathname
  );

  if (!route) {
    return new Response(
      JSON.stringify({
        success: false,
        errors: [{ code: 404, message: "Mock route not found" }],
        messages: [],
        result: null,
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  if (route.expectedHeaders) {
    for (const [key, value] of Object.entries(route.expectedHeaders)) {
      const actual = request.headers.get(key);
      if (actual !== value) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 401, message: \`Header mismatch for \${key}. Expected '\${value}' but got '\${actual ?? ""}'\` }],
            messages: [],
            result: null,
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

  if (Array.isArray(route.forbiddenHeaders)) {
    for (const headerName of route.forbiddenHeaders) {
      if (request.headers.has(headerName)) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 401, message: \`Forbidden header present: \${headerName}\` }],
            messages: [],
            result: null,
          }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        );
      }
    }
  }

  return new Response(JSON.stringify(route.body), {
    status: route.status,
    headers: { "Content-Type": "application/json" },
  });
};
`;

async function runCliWithMockFetch(
  args: readonly string[],
  envOverrides: Record<string, string>,
  routes: readonly MockRoute[]
): Promise<RunResult> {
  const tempDir = mkdtempSync(join(tmpdir(), "cf-cli-e2e-"));
  const preloadPath = join(tempDir, "mock-fetch.mjs");
  writeFileSync(preloadPath, PRELOAD_SCRIPT, "utf8");

  try {
    const result = await new Promise<{
      code: number | null;
      stdout: string;
      stderr: string;
    }>((resolvePromise, rejectPromise) => {
      // Drop any ambient CLOUDFLARE_* vars so a developer's real credentials or
      // zone defaults can't leak into the spawned CLI and change the assertions.
      const inheritedEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_"))
      );

      const child = spawn(BUN_BIN, ["--preload", preloadPath, CLI_ENTRY, ...args], {
        cwd: tempDir,
        env: {
          ...inheritedEnv,
          ...envOverrides,
          MOCK_ROUTES: JSON.stringify(routes),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.on("error", rejectPromise);
      child.on("close", (code) => {
        resolvePromise({
          code,
          stdout,
          stderr,
        });
      });
    });

    return {
      ...result,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("CLI read e2e", () => {
  it("audit logs list supports array-shaped result payloads", async () => {
    const routes: readonly MockRoute[] = [
      {
        method: "GET",
        pathname: "/client/v4/accounts/acc-id/logs/audit",
        status: 200,
        body: {
          success: true,
          errors: [],
          messages: [],
          result: [{ id: "log-1", when: "2026-02-28T01:02:03Z" }],
          result_info: { count: 1, cursor: "next-cursor" },
        },
        expectedHeaders: {
          authorization: "Bearer test-token",
        },
      },
    ];

    const result = await runCliWithMockFetch(
      ["audit", "logs", "list", "--json", "--limit", "1"],
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "acc-id",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      routes
    );

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const output = JSON.parse(result.stdout);
    expect(output.data).toHaveLength(1);
    expect(output.data[0]?.id).toBe("log-1");
    expect(output.pagination?.cursor).toBe("next-cursor");
  });

  it("dns records list works with token auth", async () => {
    const routes: readonly MockRoute[] = [
      {
        method: "GET",
        pathname: "/client/v4/zones/zone-id/dns_records",
        status: 200,
        body: {
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: "rec-1",
              type: "A",
              name: "app.example.com",
              content: "203.0.113.10",
              proxied: true,
              ttl: 60,
            },
          ],
          result_info: { page: 1, total_pages: 1, per_page: 100, count: 1, total_count: 1 },
        },
        expectedHeaders: {
          authorization: "Bearer test-token",
        },
      },
    ];

    const result = await runCliWithMockFetch(
      ["dns", "records", "list", "zone-id", "--json"],
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      routes
    );

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const output = JSON.parse(result.stdout);
    expect(output.records).toHaveLength(1);
    expect(output.records[0]?.id).toBe("rec-1");
  });

  it("zones list resolves a domain name to a zone", async () => {
    const routes: readonly MockRoute[] = [
      {
        method: "GET",
        pathname: "/client/v4/zones",
        status: 200,
        body: {
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: "zone-abc",
              name: "myedgewooddental.com",
              status: "active",
              type: "full",
              account: { id: "acc-1", name: "Example Account" },
              plan: { id: "plan-1", name: "Free Website" },
              name_servers: ["bob.ns.cloudflare.com", "lola.ns.cloudflare.com"],
              original_name_servers: null,
            },
          ],
          result_info: { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 },
        },
        expectedHeaders: {
          authorization: "Bearer test-token",
        },
      },
    ];

    const result = await runCliWithMockFetch(
      ["zones", "list", "myedgewooddental.com"],
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      routes
    );

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).toContain("zone-abc  myedgewooddental.com");
    expect(result.stdout).toContain("status=active");
  });

  it("custom-hostnames get prints certificate and ownership validation state", async () => {
    const routes: readonly MockRoute[] = [
      {
        method: "GET",
        pathname: "/client/v4/zones/zone-id/custom_hostnames/ch-1",
        status: 200,
        body: {
          success: true,
          errors: [],
          messages: [],
          result: {
            id: "ch-1",
            hostname: "app.example.com",
            status: "pending",
            ssl: {
              id: "cert-1",
              status: "pending_validation",
              type: "dv",
              method: "txt",
              validation_records: [
                {
                  txt_name: "_acme-challenge.app.example.com",
                  txt_value: "810b7d5f01154524b961ba0cd578acc2",
                },
              ],
            },
            ownership_verification: {
              type: "txt",
              name: "_cf-custom-hostname.app.example.com",
              value: "0e2d5a7f-1548-4f27-8c05-b577cb14f4ec",
            },
          },
        },
        expectedHeaders: {
          authorization: "Bearer test-token",
        },
      },
    ];

    const result = await runCliWithMockFetch(
      ["custom-hostnames", "get", "ch-1"],
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ZONE_ID: "zone-id",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      routes
    );

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).toContain("TXT _acme-challenge.app.example.com");
    expect(result.stdout).toContain("_cf-custom-hostname.app.example.com");
    expect(result.stdout).toContain("Not ready");
  });

  it("audit logs list falls back to legacy global API key headers when token is absent", async () => {
    const routes: readonly MockRoute[] = [
      {
        method: "GET",
        pathname: "/client/v4/accounts/acc-id/logs/audit",
        status: 200,
        body: {
          success: true,
          errors: [],
          messages: [],
          result: [{ id: "log-legacy-1", when: "2026-02-28T01:02:03Z" }],
          result_info: { count: 1 },
        },
        expectedHeaders: {
          "x-auth-key": "legacy-key",
          "x-auth-email": "dev@example.com",
        },
        forbiddenHeaders: ["authorization"],
      },
    ];

    const result = await runCliWithMockFetch(
      ["audit", "logs", "list", "--json", "--limit", "1"],
      {
        CLOUDFLARE_API_KEY: "legacy-key",
        CLOUDFLARE_EMAIL: "dev@example.com",
        CLOUDFLARE_ACCOUNT_ID: "acc-id",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      routes
    );

    expect(result.code).toBe(0);
    expect(result.stderr.trim()).toBe("");
  });

  it("audit logs list rejects dotted action types with a clear message", async () => {
    const result = await runCliWithMockFetch(
      [
        "audit",
        "logs",
        "list",
        "--actionType",
        "zone.dns_record.delete",
      ],
      {
        CLOUDFLARE_API_TOKEN: "test-token",
        CLOUDFLARE_ACCOUNT_ID: "acc-id",
        CLOUDFLARE_BASE_URL: "https://mock.cloudflare.test",
      },
      []
    );

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("Invalid action type 'zone.dns_record.delete'");
    expect(result.stderr).toContain("Valid values: create, view, update, delete");
  });
});
