import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "../bin.ts");
const ACCOUNT = "worker-inventory-account";
const WORKER = "fixture-worker";
const PATH = `/client/v4/accounts/${ACCOUNT}/workers/scripts/${WORKER}`;
const VERSION = "11111111-1111-4111-8111-111111111111";
const DEPLOYMENT = "22222222-2222-4222-8222-222222222222";
const CREATED = "2026-11-18T12:00:00Z";
const SOURCE = 'export default { fetch() { return new Response("synthetic-inline-credential"); } };\n';

interface Route {
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly status?: number;
  readonly body?: unknown;
  readonly raw?: string;
  readonly contentType?: string;
}
interface Result { code: number | null; stdout: string; stderr: string }

const PRELOAD = `
import { writeFileSync } from "node:fs";
const routes = JSON.parse(process.env.WORKER_MOCK_ROUTES);
const report = { consumed: 0, violations: [] };
const save = () => writeFileSync(process.env.WORKER_MOCK_REPORT, JSON.stringify(report));
const query = (entries) => JSON.stringify([...entries].sort(([a], [b]) => a.localeCompare(b)));
save();
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const route = routes[report.consumed];
  let violation;
  if (request.method !== "GET") violation = "Non-GET request";
  else if (url.origin !== "https://worker.mock.test") violation = "Unexpected origin";
  else if (request.headers.get("authorization") !== "Bearer synthetic-worker-token") violation = "Wrong test credential";
  else if (!route) violation = "Unexpected request " + url.pathname;
  else if (url.pathname !== route.path) violation = "Wrong path " + url.pathname;
  else if (query(url.searchParams.entries()) !== query(Object.entries(route.query ?? {}))) violation = "Wrong query " + url.search;
  if (violation) {
    report.violations.push(violation); save();
    return new Response(JSON.stringify({success:false,errors:[{code:599,message:violation}],result:null}),{status:599});
  }
  report.consumed++; save();
  return new Response(route.raw ?? JSON.stringify(route.body), {
    status: route.status ?? 200,
    headers: {"Content-Type": route.contentType ?? "application/json"},
  });
};
`;

async function runCli(args: string[], routes: Route[] = [], configuredAccount = false): Promise<Result> {
  const directory = mkdtempSync(join(tmpdir(), "cf-worker-cli-"));
  const preload = join(directory, "fetch.mjs");
  const reportPath = join(directory, "requests.json");
  writeFileSync(preload, PRELOAD);
  try {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_")));
    const result = await new Promise<Result>((resolveResult, reject) => {
      const child = spawn(process.env.BUN_BIN ?? "bun", ["--preload", preload, CLI_ENTRY, ...args], {
        cwd: directory,
        env: {
          ...inherited,
          CLOUDFLARE_API_TOKEN: "synthetic-worker-token",
          CLOUDFLARE_BASE_URL: "https://worker.mock.test",
          CLOUDFLARE_KEYCHAIN: "0",
          ...(configuredAccount ? { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_ZONE_ID: "unrelated-zone" } : {}),
          WORKER_MOCK_ROUTES: JSON.stringify(routes), WORKER_MOCK_REPORT: reportPath,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "", stderr = "";
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Worker CLI timeout")); }, 10_000);
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", (error) => { clearTimeout(timeout); reject(error); });
      child.on("close", (code) => { clearTimeout(timeout); resolveResult({ code, stdout, stderr }); });
    });
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report.violations, result.stderr).toEqual([]);
    expect(report.consumed, result.stderr).toBe(routes.length);
    return result;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const envelope = (result: unknown, result_info?: unknown) => ({ success: true, errors: [], messages: [], result, ...(result_info === undefined ? {} : { result_info }) });
const command = (...args: string[]) => ["workers", ...args, "--account-id", ACCOUNT, "--json"];
const deployment = { id: DEPLOYMENT, created_on: CREATED, source: "api", strategy: "percentage", versions: [{ version_id: VERSION, percentage: 100 }] };
const version = () => ({
  id: VERSION, created_on: CREATED, number: 2, urls: ["https://synthetic-user:synthetic-password@preview.example.test/?token=synthetic-url-secret"],
  main_module: "main.js", bindings: [],
  modules: [{ name: "main.js", content_type: "application/javascript+module", content_base64: Buffer.from(SOURCE).toString("base64") }],
});

function success(result: Result, diagnostics = false) {
  expect(result.code, result.stderr).toBe(0);
  if (!diagnostics) expect(result.stderr).toBe("");
  return JSON.parse(result.stdout);
}
function failure(result: Result, pattern?: RegExp) {
  expect(result.code).not.toBe(0);
  expect(result.stdout).toBe("");
  if (pattern) expect(result.stderr).toMatch(pattern);
}

describe("Worker implementation inventory CLI", () => {
  it("reads account settings and resource references without binding values", async () => {
    const result = await runCli(command("settings", "get", WORKER), [{ path: `${PATH}/settings`, body: envelope({ compatibility_date: "2026-01-01", bindings: [
      { name: "DATA", type: "kv_namespace", namespace_id: "namespace-1" },
      { name: "BUCKET", type: "r2_bucket", bucket_name: "fixture-bucket" },
      { name: "DATABASE", type: "d1", id: "database-1" },
      { name: "DOWNSTREAM", type: "service", service: "downstream-worker", environment: "production", entrypoint: "Api" },
      { name: "MESSAGE", type: "plain_text", text: "synthetic-plaintext-credential" },
      { name: "OPTIONS", type: "json", json: { nested: "synthetic-json-credential" } },
      { name: "KEY", type: "secret_text", text: "synthetic-secret-binding" },
    ] }) }]);
    const output = success(result);
    expect(output).toMatchObject({ scope: "account", accountId: ACCOUNT, script: WORKER, bindingsStatus: "present", truncated: false });
    expect(output.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "DATA", type: "kv_namespace", namespace_id: "namespace-1" }),
      expect.objectContaining({ name: "BUCKET", type: "r2_bucket", bucket_name: "fixture-bucket" }),
      expect.objectContaining({ name: "DATABASE", type: "d1", id: "database-1" }),
      expect.objectContaining({ name: "DOWNSTREAM", type: "service", service: "downstream-worker", environment: "production", entrypoint: "Api" }),
    ]));
    for (const secret of ["synthetic-plaintext-credential", "synthetic-json-credential", "synthetic-secret-binding"]) expect(result.stdout + result.stderr).not.toContain(secret);
  });

  it("distinguishes omitted bindings from an explicitly empty list", async () => {
    const unavailable = success(await runCli(command("settings", "get", WORKER), [{ path: `${PATH}/settings`, body: envelope({ compatibility_date: "2026-01-01" }) }]));
    expect(unavailable).toMatchObject({ bindings: null, bindingsStatus: "unavailable" });
    const empty = success(await runCli(command("settings", "get", WORKER), [{ path: `${PATH}/settings`, body: envelope({ bindings: [] }) }]));
    expect(empty).toMatchObject({ bindings: [], bindingsStatus: "present" });
  });

  it("uses configured account without applying configured zone to source inspection", async () => {
    const output = success(await runCli(["workers", "settings", "get", WORKER, "--json"], [{ path: `${PATH}/settings`, body: envelope({ bindings: [] }) }], true));
    expect(output).toMatchObject({ accountId: ACCOUNT, script: WORKER });
    expect(output.zoneId).toBeUndefined();
  });

  it("preserves explicit production-domain service identity and uses literal Worker name", async () => {
    const output = success(await runCli(command("settings", "get", WORKER, "--environment", "production"), [{ path: `${PATH}/settings`, body: envelope({ bindings: [] }) }]));
    expect(output).toMatchObject({ script: WORKER, service: WORKER, environment: "production" });
  });

  it("rejects legacy environments before HTTP instead of inventing script suffixes", async () => {
    failure(await runCli(command("source", "get", WORKER, "--environment", "staging")), /environment|unsupported/iu);
  });

  it("rejects missing account scope and zone flags before HTTP", async () => {
    failure(await runCli(["workers", "settings", "get", WORKER, "--json"]), /account/iu);
    const result = await runCli(command("settings", "get", WORKER, "--zone-id", "wrong-zone"));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/zone-id|unknown|unrecognized/iu);
  });

  it("inspects original JavaScript as unpinned metadata without printing source", async () => {
    const result = await runCli(command("source", "get", WORKER), [{ path: PATH, raw: SOURCE, contentType: "application/javascript" }]);
    const output = success(result);
    expect(output).toMatchObject({ scope: "account", script: WORKER, source: { format: "service-worker", sensitive: true, truncated: false, totalBytes: Buffer.byteLength(SOURCE) } });
    expect(output.source.modules).toHaveLength(1);
    expect(output.source.modules[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.stdout + result.stderr).not.toContain("synthetic-inline-credential");
    expect(result.stdout).not.toContain("export default");
    expect(output.version).toBeUndefined();
  });

  it("exports original source only into new private local artifacts", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cf-worker-artifact-"));
    const outDir = join(temp, "private-source");
    try {
      const result = await runCli(command("source", "get", WORKER, "--out-dir", outDir), [{ path: PATH, raw: SOURCE, contentType: "text/javascript" }]);
      const output = success(result);
      expect(statSync(outDir).mode & 0o777).toBe(0o700);
      const module = output.source.modules[0];
      expect(readFileSync(join(outDir, module.file), "utf8")).toBe(SOURCE);
      for (const file of readdirSync(outDir)) expect(statSync(join(outDir, file)).mode & 0o777).toBe(0o600);
      expect(result.stdout).not.toContain("synthetic-inline-credential");
      failure(await runCli(command("source", "get", WORKER, "--out-dir", outDir), [{ path: PATH, raw: SOURCE, contentType: "text/javascript" }]), /directory|artifact|exist/iu);
      expect(readFileSync(join(outDir, module.file), "utf8")).toBe(SOURCE);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("preserves multipart modules and binary part bytes in private artifacts", async () => {
    const boundary = "worker-fixture-boundary";
    const raw = [
      `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ main_module: "main.js" })}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="main.js"; filename="main.js"\r\nContent-Type: application/javascript+module\r\n\r\n${SOURCE}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="data.bin"; filename="data.bin"\r\nContent-Type: application/octet-stream\r\n\r\n\u0000\u0001\u0002\r\n`,
      `--${boundary}--\r\n`,
    ].join("");
    const temp = mkdtempSync(join(tmpdir(), "cf-worker-multipart-"));
    const outDir = join(temp, "source");
    try {
      const result = await runCli(command("source", "get", WORKER, "--out-dir", outDir), [{ path: PATH, raw, contentType: `multipart/form-data; boundary=${boundary}` }]);
      const output = success(result);
      expect(output.source).toMatchObject({ format: "modules", entrypoint: "main.js" });
      expect(output.source.modules.map((module: { name: string }) => module.name)).toEqual(["main.js", "data.bin"]);
      expect(readFileSync(join(outDir, output.source.modules[0].file), "utf8")).toBe(SOURCE);
      expect(readFileSync(join(outDir, output.source.modules[1].file))).toEqual(Buffer.from([0, 1, 2]));
      expect(result.stdout).not.toContain("synthetic-inline-credential");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("reads split deployments and exposes numeric continuation", async () => {
    const second = "33333333-3333-4333-8333-333333333333";
    const split = { ...deployment, versions: [{ version_id: VERSION, percentage: 25 }, { version_id: second, percentage: 75 }] };
    const result = await runCli(command("deployments", "list", WORKER, "--page", "1", "--per-page", "1"), [{ path: `${PATH}/deployments`, query: { page: "1", per_page: "1" }, body: envelope({ deployments: [split] }, { page: 1, per_page: 1, count: 1, total_count: 2, total_pages: 2 }) }]);
    const output = success(result, true);
    expect(output).toMatchObject({ deployments: [{ id: DEPLOYMENT, versions: split.versions }], nextPage: 2, truncated: true });
    expect(result.stderr).toMatch(/--page 2/u);
  });

  it("reads later version pages as uploaded history without claiming deployment", async () => {
    const output = success(await runCli(command("versions", "list", WORKER, "--page", "2", "--per-page", "1"), [{ path: `${PATH}/versions`, query: { page: "2", per_page: "1" }, body: envelope([{ id: VERSION, number: 2, metadata: { created_on: CREATED, source: "api" } }], { page: 2, per_page: 1, count: 1, total_count: 2, total_pages: 2 }) }]));
    expect(output).toMatchObject({ versions: [{ id: VERSION, number: 2 }], nextPage: null, truncated: false });
    expect(output.deployments).toBeUndefined();
  });

  it("returns successful empty histories with bounded default page size", async () => {
    for (const kind of ["deployments", "versions"] as const) {
      const output = success(await runCli(command(kind, "list", WORKER), [{
        path: `${PATH}/${kind}`, query: { page: "1", per_page: "20" },
        body: envelope(kind === "deployments" ? { deployments: [] } : []),
      }]));
      expect(output).toMatchObject({ [kind]: [], nextPage: null, truncated: false });
    }
  });

  it("inspects pinned version modules through documented Beta include=modules", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cf-worker-version-"));
    const outDir = join(temp, "source");
    try {
      const result = await runCli(command("versions", "get", WORKER, VERSION, "--out-dir", outDir), [{ path: `/client/v4/accounts/${ACCOUNT}/workers/workers/${WORKER}/versions/${VERSION}`, query: { include: "modules" }, body: envelope(version()) }]);
      const output = success(result);
      expect(output).toMatchObject({ version: { id: VERSION, number: 2 }, bindings: [], bindingsStatus: "present", sourceStatus: "present", source: { entrypoint: "main.js", format: "modules" } });
      expect(readFileSync(join(outDir, output.source.modules[0].file), "utf8")).toBe(SOURCE);
      for (const secret of ["synthetic-inline-credential", "synthetic-password", "synthetic-url-secret"]) expect(result.stdout + result.stderr).not.toContain(secret);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it("reports missing pinned modules and bindings as unavailable", async () => {
    const incomplete = { id: VERSION, created_on: CREATED, number: 2, urls: [] };
    const output = success(await runCli(command("versions", "get", WORKER, VERSION), [{ path: `/client/v4/accounts/${ACCOUNT}/workers/workers/${WORKER}/versions/${VERSION}`, query: { include: "modules" }, body: envelope(incomplete) }]));
    expect(output).toMatchObject({ source: null, sourceStatus: "unavailable", bindings: null, bindingsStatus: "unavailable" });
  });

  it.each([403, 404, 410, 500, 524])("fails HTTP %s without treating it as empty or echoing upstream secrets", async (status) => {
    const result = await runCli(command("settings", "get", WORKER), [{ path: `${PATH}/settings`, status, body: { success: false, errors: [{ code: 10000, message: "synthetic-upstream-password https://user:synthetic-url-secret@example.test/" }], result: null } }]);
    failure(result, new RegExp(String(status), "u"));
    expect(result.stderr).not.toContain("synthetic-upstream-password");
    expect(result.stderr).not.toContain("synthetic-url-secret");
  });

  it("fails an inaccessible source read without writing artifacts or printing the response", async () => {
    const temp = mkdtempSync(join(tmpdir(), "cf-worker-denied-"));
    try {
      const result = await runCli(command("source", "get", WORKER, "--out-dir", join(temp, "source")), [{ path: PATH, status: 403, raw: "synthetic-source-error-secret", contentType: "text/html" }]);
      failure(result, /403/u);
      expect(readdirSync(temp)).toEqual([]);
      expect(result.stdout + result.stderr).not.toContain("synthetic-source-error-secret");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });

  it.each([
    { body: envelope(null) },
    { body: { success: false, errors: [{ code: 10000, message: "synthetic-error-secret" }], result: {} } },
    { body: { success: true, result: { bindings: "not-an-array" } } },
    { raw: "<html>upstream failure</html>", contentType: "text/html" },
  ])("fails malformed or unsuccessful settings response without JSON success", async (fixture) => {
    const result = await runCli(command("settings", "get", WORKER), [{ path: `${PATH}/settings`, ...fixture }]);
    failure(result);
    expect(result.stderr).not.toContain("synthetic-error-secret");
  });

  it.each([
    { contentType: "text/html", raw: "<html>synthetic-private-source</html>" },
    { contentType: "application/json", raw: '{"private":"synthetic-private-source"}' },
    { contentType: "multipart/form-data; boundary=missing", raw: "synthetic-private-source" },
  ])("fails unsupported or malformed original source without printing content", async (fixture) => {
    const result = await runCli(command("source", "get", WORKER), [{ path: PATH, ...fixture }]);
    failure(result, /format|content|malformed|multipart/iu);
    expect(result.stdout + result.stderr).not.toContain("synthetic-private-source");
  });

  it.each(["0", "101", "2.5", "nope"])("rejects per-page %s before HTTP", async (perPage) => {
    const result = await runCli(command("versions", "list", WORKER, "--per-page", perPage));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/per-page|1-100/iu);
  });

  it.each(["0", "-1", "2.5", "nope"])("rejects page %s before HTTP", async (page) => {
    const result = await runCli(command("deployments", "list", WORKER, "--page", page));
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/page|integer/iu);
  });

  it("help exposes source safety, environment limits and Beta version inspection", async () => {
    const source = await runCli(["workers", "source", "get", "--help"]);
    expect(source.code).toBe(0);
    expect(source.stdout).toMatch(/private|source|metadata/iu);
    expect(source.stdout).toMatch(/--out-dir/u);
    expect(source.stdout).toMatch(/--environment/u);
    const pinned = await runCli(["workers", "versions", "get", "--help"]);
    expect(pinned.code).toBe(0);
    expect(pinned.stdout).toMatch(/Beta/iu);
  });
});
