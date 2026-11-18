import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareClient, describeError } from "../src/index.js";

const TARGET = { script: "assigned-worker" };
const BASE = "/client/v4/accounts/account-1/workers/scripts/assigned-worker";
const ID = "18f97339-c287-4872-9bdd-e2135c07ec12";
const ID2 = "28f97339-c287-4872-9bdd-e2135c07ec12";
const DATE = "2026-11-18T12:00:00Z";
const CODE = "export default { fetch() { return new Response('synthetic-inline-credential'); } };";

function client(accountId: string | undefined = "account-1") {
  return new CloudflareClient({ auth: { type: "apiToken", token: "synthetic-test-token" }, baseUrl: "https://mock.cloudflare.test", accountId, zoneId: "must-not-be-account" });
}
function envelope(result: unknown, resultInfo?: unknown) {
  return { success: true, errors: [], messages: [], result, ...(resultInfo === undefined ? {} : { result_info: resultInfo }) };
}
function json(result: unknown, info?: unknown) { return new Response(JSON.stringify(envelope(result, info)), { headers: { "content-type": "application/json" } }); }
async function mock<T>(handler: (url: URL, init: RequestInit | undefined) => Response, work: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-test-token");
    return handler(new URL(String(url)), init);
  }) as typeof fetch;
  try { return await work(); } finally { globalThis.fetch = original; }
}
function version(modules: unknown = [{ name: "index.js", content_type: "application/javascript+module", content_base64: Buffer.from(CODE).toString("base64") }]) {
  return { id: ID, created_on: DATE, number: 7, urls: ["https://preview.example/?token=synthetic-url-credential"], main_module: "index.js", modules,
    bindings: [{ name: "MESSAGE", type: "plain_text", text: "synthetic-binding-credential" }] };
}
function deployment() { return { id: ID, created_on: DATE, source: "api", strategy: "percentage", versions: [{ version_id: ID, percentage: 25 }, { version_id: ID2, percentage: 75 }] }; }

describe("account Worker inventory", () => {
  it.each([
    { page: 1, per_page: 20, count: 2, total_count: 1, total_pages: 1 },
    { page: 1, per_page: 2, count: 2, total_pages: 0 },
    { page: 1, per_page: 2, count: 2, total_count: 2, total_pages: 2 },
  ])("rejects contradictory pagination totals: %j", async (info) => {
    await mock(() => json([{ id: ID }, { id: ID2 }], info), async () => {
      await expect(client().inventory.listWorkerVersions(TARGET, { perPage: info.per_page })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    });
  });
  it("reads settings GET with explicit account scope and preserves binding references while hiding all values", async () => {
    await mock((url) => {
      expect(url.pathname).toBe(`${BASE}/settings`);
      expect(url.search).toBe("");
      return json({ compatibility_date: "2026-10-01", compatibility_flags: ["nodejs_compat"], usage_model: "standard", logpush: false,
        annotations: { message: "synthetic-inline-credential" }, unknown: "synthetic-inline-credential", bindings: [
          { name: "DATA", type: "kv_namespace", namespace_id: "kv-1" },
          { name: "FILES", type: "r2_bucket", bucket_name: "bucket-1", jurisdiction: "eu" },
          { name: "DB", type: "d1", database_id: "database-1", id: "deprecated-database-1" },
          { name: "BACKEND", type: "service", service: "backend", environment: "production", entrypoint: "Admin" },
          { name: "STATE", type: "durable_object_namespace", class_name: "Counter", script_name: "counter", namespace_id: "do-1", environment: "production" },
          { name: "JOBS", type: "queue", queue_name: "jobs" },
          { name: "POOL", type: "hyperdrive", id: "hyper-1", connection_string: "postgres://user:synthetic-db-credential@db" },
          { name: "VECTOR", type: "vectorize", index_name: "search" },
          { name: "DISPATCH", type: "dispatch_namespace", namespace: "apps", outbound: { worker: { service: "egress", environment: "production", entrypoint: "Outbound" }, params: [{ name: "route" }] } },
          { name: "FLOW", type: "workflow", workflow_name: "flow", class_name: "Flow", script_name: "flow-worker" },
          { name: "STORE", type: "secrets_store_secret", store_id: "store-1", secret_name: "backend-token", value: "synthetic-binding-credential" },
          { name: "MESSAGE", type: "plain_text", text: "synthetic-binding-credential" },
          { name: "PUBLIC", type: "json", json: { innocent: "synthetic-binding-credential" } },
          { name: "PASSWORD", type: "secret_text", text: "synthetic-binding-credential" },
          { name: "KEY", type: "secret_key", key_jwk: { d: "synthetic-binding-credential" }, key_base64: "synthetic-binding-credential" },
          { name: "FUTURE", type: "future_binding", resource_id: "unverified-ref", text: "synthetic-binding-credential" },
        ] });
    }, async () => {
      const result = await client().inventory.getWorkerSettings(TARGET);
      expect(result).toMatchObject({ scope: "account", accountId: "account-1", script: "assigned-worker", bindingsStatus: "present", truncated: false });
      expect(result.bindings).toContainEqual({ name: "DATA", type: "kv_namespace", namespace_id: "kv-1" });
      expect(result.bindings).toContainEqual({ name: "STORE", type: "secrets_store_secret", store_id: "store-1", secret_name: "backend-token" });
      expect(result.bindings).toContainEqual({ name: "BACKEND", type: "service", service: "backend", environment: "production", entrypoint: "Admin" });
      expect(result.bindings).toContainEqual({ name: "POOL", type: "hyperdrive", id: "hyper-1" });
      expect(result.bindings).toContainEqual({ name: "DB", type: "d1", database_id: "database-1", id: "deprecated-database-1" });
      expect(result.bindings).toContainEqual({ name: "PUBLIC", type: "json", value: "[REDACTED]" });
      expect(result.bindings).toContainEqual({ name: "FUTURE", type: "future_binding", detailsStatus: "unavailable" });
      const serialized = JSON.stringify(result);
      for (const marker of ["synthetic-binding-credential", "synthetic-db-credential", "synthetic-inline-credential"]) expect(serialized).not.toContain(marker);
    });
  });

  it.each([{ bindings: undefined }, { bindings: [] }])("distinguishes unavailable bindings from explicitly empty: %j", async ({ bindings }) => {
    await mock(() => json({ compatibility_date: "2026-10-01", ...(bindings === undefined ? {} : { bindings }) }), async () => {
      const result = await client().inventory.getWorkerSettings(TARGET);
      expect(result.bindings).toEqual(bindings === undefined ? null : []);
      expect(result.bindingsStatus).toBe(bindings === undefined ? "unavailable" : "present");
    });
  });

  it("uses a production custom-domain service literally and preserves assignment identity", async () => {
    await mock((url) => { expect(url.pathname).toBe(`${BASE}/settings`); return json({ bindings: [] }); }, async () => {
      expect(await client().inventory.getWorkerSettings({ accountId: "account-1", service: "assigned-worker", environment: "production" })).toMatchObject({ script: "assigned-worker", service: "assigned-worker", environment: "production" });
    });
  });

  it.each([
    {}, { script: "" }, { script: "worker", zoneId: "zone-1" }, { script: "worker", service: "service", environment: "production" }, { service: "worker" },
    { script: "https://user:synthetic-credential@example.com" },
  ])("rejects malformed scope/identity without HTTP: %j", async (target) => {
    await mock(() => { throw new Error("unexpected HTTP"); }, async () => {
      await expect(client().inventory.getWorkerSettings(target as never)).rejects.toMatchObject({ code: "CONFIG_ERROR" });
    });
  });

  it("does not use a zone ID as an account default", async () => {
    const noAccount = new CloudflareClient({ auth: { type: "apiToken", token: "synthetic-test-token" }, zoneId: "must-not-be-account" });
    await mock(() => { throw new Error("unexpected HTTP"); }, async () => { await expect(noAccount.inventory.getWorkerSettings(TARGET)).rejects.toMatchObject({ code: "CONFIG_ERROR" }); });
  });

  it("rejects unsupported legacy environment before HTTP instead of inferring a suffix", async () => {
    await mock(() => { throw new Error("unexpected HTTP"); }, async () => {
      await expect(client().inventory.getWorkerSettings({ service: "worker", environment: "staging" })).rejects.toMatchObject({ code: "UNSUPPORTED_WORKER_ENVIRONMENT" });
    });
  });

  it("downloads unpinned original source through GET without exposing code", async () => {
    await mock((url, init) => { expect(url.pathname).toBe(BASE); expect(init?.redirect).toBe("error"); return new Response(CODE, { headers: { "content-type": "application/javascript" } }); }, async () => {
      const result = await client().inventory.getWorkerSource(TARGET);
      expect(result.source).toMatchObject({ sensitive: true, format: "service-worker", totalBytes: Buffer.byteLength(CODE), truncated: false });
      expect(JSON.stringify(result)).not.toContain("synthetic-inline-credential");
      expect(result).not.toHaveProperty("version");
    });
  });

  it("reads pinned Beta modules and bindings, never source, preview URLs or arbitrary annotations", async () => {
    await mock((url) => {
      expect(url.pathname).toBe(`/client/v4/accounts/account-1/workers/workers/assigned-worker/versions/${ID}`);
      expect(url.searchParams.get("include")).toBe("modules");
      return json(version());
    }, async () => {
      const result = await client().inventory.getWorkerVersion(TARGET, ID);
      expect(result.version).toMatchObject({ id: ID, number: 7, created_on: DATE, main_module: "index.js" });
      expect(result.sourceStatus).toBe("present");
      expect(result.source?.modules[0]).toMatchObject({ name: "index.js", bytes: Buffer.byteLength(CODE) });
      for (const marker of ["synthetic-inline-credential", "synthetic-url-credential", "synthetic-binding-credential", Buffer.from(CODE).toString("base64")]) expect(JSON.stringify(result)).not.toContain(marker);
    });
  });

  it("missing requested modules or bindings remain unavailable", async () => {
    await mock(() => json({ id: ID, created_on: DATE, number: 7, urls: [] }), async () => {
      expect(await client().inventory.getWorkerVersion(TARGET, ID)).toMatchObject({ source: null, sourceStatus: "unavailable", bindings: null, bindingsStatus: "unavailable" });
    });
  });

  it("preserves active deployment splits rather than equating latest upload with deployed", async () => {
    await mock((url) => { expect(url.pathname).toBe(`${BASE}/deployments`); expect(Object.fromEntries(url.searchParams)).toEqual({ page: "1", per_page: "20" }); return json({ deployments: [deployment()] }, { page: 1, per_page: 20, count: 1, total_count: 1, total_pages: 1 }); }, async () => {
      const result = await client().inventory.listWorkerDeployments(TARGET);
      expect(result.deployments[0]).toMatchObject({ id: ID, strategy: "percentage", versions: [{ version_id: ID, percentage: 25 }, { version_id: ID2, percentage: 75 }] });
      expect(result).toMatchObject({ truncated: false, nextPage: null });
    });
  });

  it("numeric version continuation is explicit and never uses deployable", async () => {
    let calls = 0;
    await mock((url) => {
      calls++;
      expect(url.pathname).toBe(`${BASE}/versions`);
      expect(url.searchParams.get("deployable")).toBeNull();
      expect(url.searchParams.get("page")).toBe(String(calls));
      return json([{ id: calls === 1 ? ID : ID2, number: calls, metadata: { created_on: DATE, source: "api", author_email: "private@example.com" } }], { page: calls, per_page: 1, total_count: 2, total_pages: 2, count: 1 });
    }, async () => {
      const first = await client().inventory.listWorkerVersions(TARGET, { page: 1, perPage: 1 });
      expect(first).toMatchObject({ nextPage: 2, truncated: true });
      expect(first.versions[0]).toMatchObject({ id: ID, number: 1 });
      expect(JSON.stringify(first)).not.toContain("private@example.com");
      expect(await client().inventory.listWorkerVersions(TARGET, { page: first.nextPage!, perPage: 1 })).toMatchObject({ nextPage: null, truncated: false });
    });
  });

  it("full pages without totals conservatively expose continuation", async () => {
    await mock(() => json([{ id: ID }]), async () => {
      expect(await client().inventory.listWorkerVersions(TARGET, { perPage: 1 })).toMatchObject({ nextPage: 2, truncated: true });
    });
  });

  it.each([403, 404, 410, 500, 524])("keeps HTTP %d as a safe failure for settings and raw source", async (status) => {
    await mock(() => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "synthetic-binding-credential https://user:synthetic-url-credential@example.com" }], result: null }), { status }), async () => {
      for (const read of [() => client().inventory.getWorkerSettings(TARGET), () => client().inventory.getWorkerSource(TARGET), () => client().inventory.listWorkerVersions(TARGET), () => client().inventory.listWorkerDeployments(TARGET), () => client().inventory.getWorkerVersion(TARGET, ID)]) {
        try { await read(); throw new Error("expected failure"); } catch (error) {
          expect(error).toMatchObject({ statusCode: status, code: "10000", requestMethod: "GET" });
          expect(describeError(error)).not.toContain("synthetic-binding-credential");
          expect(describeError(error)).not.toContain("synthetic-url-credential");
        }
      }
    });
  });

  it.each([
    { success: true, errors: [], result: null },
    { success: "true", errors: [], result: { bindings: [] } },
    { success: true, errors: [{ code: 1, message: "contradiction" }], result: { bindings: [] } },
    { success: true, errors: [], result: { bindings: {} } },
    { success: true, errors: [], result: { bindings: [{ name: "VALUE" }] } },
    { success: true, errors: [], result: { compatibility_flags: "nodejs_compat" } },
  ])("rejects malformed settings envelope/result %j", async (body) => {
    await mock(() => new Response(JSON.stringify(body)), async () => { await expect(client().inventory.getWorkerSettings(TARGET)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("strict failure envelopes remain errors even at HTTP 200 without leaking body", async () => {
    await mock(() => new Response(JSON.stringify({ success: false, errors: [{ code: 1234, message: "synthetic-inline-credential" }], result: null })), async () => {
      try { await client().inventory.getWorkerSettings(TARGET); throw new Error("expected failure"); } catch (error) { expect(error).toMatchObject({ code: "1234" }); expect(describeError(error)).not.toContain("synthetic-inline-credential"); }
    });
  });

  it.each([
    { deployments: [ { ...deployment(), versions: [{ version_id: ID, percentage: 5 }] } ] },
    { deployments: null }, [],
  ])("rejects malformed deployments %j", async (result) => {
    await mock(() => json(result), async () => { await expect(client().inventory.listWorkerDeployments(TARGET)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("rejects unsupported pagination metadata instead of inventing completeness", async () => {
    await mock(() => json([{ id: ID }], { cursors: { after: "not-supported" } }), async () => { await expect(client().inventory.listWorkerVersions(TARGET)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it.each([{ page: 0 }, { perPage: 101 }, { page: 1.5 }, { perPage: 0 }])("rejects invalid page options %j before HTTP", async (options) => {
    await mock(() => { throw new Error("unexpected HTTP"); }, async () => { await expect(client().inventory.listWorkerVersions(TARGET, options)).rejects.toMatchObject({ code: "CONFIG_ERROR" }); });
  });

  it("never exposes an uppercase credential disguised as an API code", async () => {
    await mock(() => new Response(JSON.stringify({ success: false, errors: [{ code: "SYNTHETIC_CREDENTIAL", message: "private" }], result: null }), { status: 403 }), async () => {
      try { await client().inventory.getWorkerSettings(TARGET); throw new Error("expected failure"); } catch (error) {
        expect(error).toMatchObject({ code: "API_ERROR", statusCode: 403 });
        expect(describeError(error)).not.toContain("SYNTHETIC_CREDENTIAL");
      }
    });
  });

  it.each([{ count: 2 }, { total_count: 2 }])("rejects incomplete nonpaged responses %j", async (info) => {
    await mock(() => json({ bindings: [] }, info), async () => { await expect(client().inventory.getWorkerSettings(TARGET)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("rejects a different returned version ID for a pinned request", async () => {
    await mock(() => json({ ...version(), id: ID2 }), async () => { await expect(client().inventory.getWorkerVersion(TARGET, ID)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("accepts a documented hyphenated UUID prefix and checks its returned identity", async () => {
    const prefix = ID.slice(0, 13);
    await mock((url) => { expect(url.pathname.endsWith(`/${prefix}`)).toBe(true); return json(version()); }, async () => {
      expect((await client().inventory.getWorkerVersion(TARGET, prefix)).version.id).toBe(ID);
    });
  });

  it.each([{ errors: [] }, { errors: undefined }])("rejects a false success flag without API errors %j", async ({ errors }) => {
    await mock(() => new Response(JSON.stringify({ success: false, ...(errors === undefined ? {} : { errors }), result: null })), async () => { await expect(client().inventory.getWorkerSettings(TARGET)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" }); });
  });

  it("validates binding references before exporting any source artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "worker-reader-test-"));
    const destination = join(root, "private");
    try {
      await mock(() => json({ ...version(), bindings: [{ name: "DATA", type: "kv_namespace" }] }), async () => {
        await expect(client().inventory.getWorkerVersion(TARGET, ID, { outDir: destination })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
        expect(existsSync(destination)).toBe(false);
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("validates combined metadata limits before exporting source artifacts", async () => {
    const root = mkdtempSync(join(tmpdir(), "worker-reader-test-"));
    const destination = join(root, "private");
    try {
      await mock(() => json({ ...version(), compatibility_flags: Array.from({ length: 1000 }, () => "x".repeat(1100)) }), async () => {
        await expect(client().inventory.getWorkerVersion(TARGET, ID, { outDir: destination })).rejects.toMatchObject({ code: "INVENTORY_LIMIT_EXCEEDED" });
        expect(existsSync(destination)).toBe(false);
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("an explicit export fails when requested version modules are unavailable", async () => {
    await mock(() => json({ id: ID, created_on: DATE, number: 7, urls: [] }), async () => {
      await expect(client().inventory.getWorkerVersion(TARGET, ID, { outDir: "unused-export" })).rejects.toMatchObject({ code: "SOURCE_UNAVAILABLE" });
    });
  });

  it("redacts credential-bearing protocol-relative URLs in projected resource fields", async () => {
    await mock(() => json({ bindings: [{ name: "BACKEND", type: "service", service: "//user:synthetic-url-credential@backend.example" }] }), async () => {
      const result = await client().inventory.getWorkerSettings(TARGET);
      expect(JSON.stringify(result)).not.toContain("synthetic-url-credential");
      expect(result.bindings?.[0]).toMatchObject({ service: "[REDACTED_URL]" });
    });
  });
});
