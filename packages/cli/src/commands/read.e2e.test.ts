import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = join(PACKAGE_ROOT, "src/bin.ts");

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
      const child = spawn("bun", ["--preload", preloadPath, CLI_ENTRY, ...args], {
        cwd: tempDir,
        env: {
          ...process.env,
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
});
