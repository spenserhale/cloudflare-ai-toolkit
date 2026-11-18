import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectWorkerContent, inspectWorkerModules, type WorkerSourceOptions } from "../src/worker-source.js";

const OPTIONS: WorkerSourceOptions = {
  identity: { scope: "account", accountId: "synthetic-account", script: "fixture-worker" },
  sanitize: (value) => value.replaceAll("synthetic-sensitive", "[REDACTED]"),
};
const CODE = 'export default { fetch() { return new Response("synthetic-sensitive"); } };\n';
const HASH = createHash("sha256").update(CODE).digest("hex");

function raw(content: string | Uint8Array = CODE, contentType = "application/javascript") {
  return new Response(content, { headers: { "content-type": contentType } });
}

function modules() {
  return [
    { name: "src/main.js", content_type: "application/javascript+module", content_base64: Buffer.from(CODE).toString("base64") },
    { name: "data.bin", content_type: "application/octet-stream", content_base64: Buffer.from([0, 255, 13, 10, 45, 45, 0]).toString("base64") },
    { name: "greeting.txt", content_type: "text/plain", content_base64: Buffer.from("hello\n").toString("base64") },
  ];
}

function multipart(parts: Array<{ name: string; type?: string; bytes: string | Uint8Array }>, boundary = "fixture-boundary") {
  const pieces: Buffer[] = [];
  for (const part of parts) {
    pieces.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n${part.type ? `Content-Type: ${part.type}\r\n` : ""}\r\n`));
    pieces.push(Buffer.from(part.bytes));
    pieces.push(Buffer.from("\r\n"));
  }
  pieces.push(Buffer.from(`--${boundary}--\r\n`));
  return raw(Buffer.concat(pieces), `multipart/form-data; boundary="${boundary}"`);
}

async function inTemp(work: (directory: string) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "worker-source-test-")));
  try { await work(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe("private Worker source inspection", () => {
  it.each(["application/javascript", "text/javascript; charset=utf-8"])("returns only bounded metadata for %s", async (type) => {
    const result = await inspectWorkerContent(raw(CODE, type), OPTIONS);
    expect(result).toMatchObject({ format: "service-worker", sensitive: true, truncated: false, totalBytes: Buffer.byteLength(CODE) });
    expect(result.modules).toMatchObject([{ name: "worker.js", bytes: Buffer.byteLength(CODE), sha256: HASH }]);
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
    expect(JSON.stringify(result)).not.toContain("export default");
    expect(result.artifactDirectory).toBeUndefined();
    expect(result.entrypoint).toBeUndefined();
  });

  it("preserves multipart module identities, media types and binary bytes in private artifacts", async () => {
    await inTemp(async (directory) => {
      const outDir = join(directory, "export");
      const result = await inspectWorkerContent(multipart([
        { name: "metadata", type: "application/json", bytes: JSON.stringify({ main_module: "src/main.js", bindings: [{ type: "plain_text", name: "CONFIG", text: "synthetic-sensitive" }] }) },
        ...modules().map((module) => ({ name: module.name, type: module.content_type, bytes: Buffer.from(module.content_base64, "base64") })),
      ]), { ...OPTIONS, outDir });
      expect(result.format).toBe("modules");
      expect(result.entrypoint).toBe("src/main.js");
      expect(result.modules.map((module) => [module.name, module.contentType])).toEqual(modules().map((module) => [module.name, module.content_type]));
      expect((await lstat(outDir)).mode & 0o777).toBe(0o700);
      for (const [index, module] of result.modules.entries()) {
        expect(module.file).toMatch(/^module-\d+\.bin$/u);
        const file = join(outDir, module.file!);
        expect((await lstat(file)).mode & 0o777).toBe(0o600);
        expect(await readFile(file)).toEqual(Buffer.from(modules()[index]!.content_base64, "base64"));
      }
      const manifest = await readFile(join(outDir, "manifest.json"), "utf8");
      expect(JSON.parse(manifest)).toMatchObject({ identity: OPTIONS.identity, source: { entrypoint: "src/main.js" } });
      expect(manifest).not.toContain("synthetic-sensitive");
      expect(manifest).not.toContain("bindings");
      expect((await lstat(join(outDir, "manifest.json"))).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(result)).not.toContain("export default");
    });
  });

  it("inspects pinned Beta modules without exposing base64 or code", async () => {
    const result = await inspectWorkerModules(modules(), "src/main.js", OPTIONS);
    expect(result).toMatchObject({ format: "modules", entrypoint: "src/main.js", sensitive: true, truncated: false });
    expect(result.modules[0]).toMatchObject({ sha256: HASH, name: "src/main.js" });
    expect(result.totalBytes).toBe(modules().reduce((total, module) => total + Buffer.from(module.content_base64, "base64").length, 0));
    expect(JSON.stringify(result)).not.toContain("content_base64");
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
  });

  it("recognizes a single raw JavaScript module without inventing its original entrypoint", async () => {
    const result = await inspectWorkerContent(raw(CODE, "application/javascript+module"), OPTIONS);
    expect(result.format).toBe("modules");
    expect(result.modules[0]).toMatchObject({ name: "worker.js", contentType: "application/javascript+module", sha256: HASH });
    expect(result.entrypoint).toBeUndefined();
  });

  it("omits arbitrary MIME parameters from source metadata", async () => {
    const result = await inspectWorkerContent(raw(CODE, "application/javascript; token=synthetic-inline-credential"), OPTIONS);
    expect(result.modules[0]?.contentType).toBe("application/javascript");
    expect(JSON.stringify(result)).not.toContain("synthetic-inline-credential");
  });

  it.each([
    "https://user:synthetic-inline-credential@example.test/module.js",
    "https://example.test/module.js?password=synthetic-inline-credential",
    "https://example.test/module.js#synthetic-inline-credential",
    "postgres://user:synthetic-inline-credential@example.test/module.js",
    "//user:synthetic-inline-credential@example.test/module.js",
    "//example.test/module.js?session=synthetic-inline-credential",
  ])("redacts URL credentials, queries and fragments in module names independently of the callback", async (name) => {
    const result = await inspectWorkerModules([{ ...modules()[0]!, name }], name, OPTIONS);
    expect(result.entrypoint).toBe("[REDACTED]");
    expect(result.modules[0]?.name).toBe("[REDACTED]");
    expect(JSON.stringify(result)).not.toContain("synthetic-inline-credential");
  });

  it("uses generated local filenames even for traversal-like module names", async () => {
    await inTemp(async (directory) => {
      const result = await inspectWorkerModules([{ ...modules()[0]!, name: "../../outside.js" }], "../../outside.js", { ...OPTIONS, outDir: join(directory, "export") });
      expect(result.modules[0]?.name).toBe("../../outside.js");
      expect(result.modules[0]?.file).toBe("module-0001.bin");
      expect(await readdir(directory)).toEqual(["export"]);
    });
  });

  it("sanitizes module identity, content types and manifest metadata without rewriting bytes", async () => {
    await inTemp(async (directory) => {
      const result = await inspectWorkerModules([{ ...modules()[0]!, name: "synthetic-sensitive.js" }], "synthetic-sensitive.js", { ...OPTIONS, outDir: join(directory, "export") });
      expect(result.entrypoint).toBe("[REDACTED].js");
      expect(result.modules[0]?.name).toBe("[REDACTED].js");
      expect(await readFile(join(result.artifactDirectory!, result.modules[0]!.file!), "utf8")).toBe(CODE);
    });
  });

  it.each(["text/html", "application/json", "application/octet-stream", ""])("rejects unsupported original-source format %s without echoing response", async (type) => {
    const response = raw("synthetic-sensitive", type);
    await expect(inspectWorkerContent(response, OPTIONS)).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_FORMAT" });
  });

  it.each([
    () => raw("synthetic-sensitive", "multipart/form-data"),
    () => raw("synthetic-sensitive", "multipart/form-data; boundary=bad"),
    () => multipart([{ name: "metadata", bytes: "synthetic-sensitive" }]),
    () => multipart([{ name: "metadata", bytes: JSON.stringify({ main_module: "missing.js" }) }, { name: "main.js", bytes: CODE }]),
    () => multipart([{ name: "main.js", bytes: CODE }, { name: "main.js", bytes: CODE }]),
    () => multipart([{ name: "metadata", bytes: "{}" }]),
  ])("rejects malformed multipart source without source in diagnostics", async (makeResponse) => {
    try { await inspectWorkerContent(makeResponse(), OPTIONS); throw new Error("Expected source failure"); }
    catch (error) {
      expect(error).toMatchObject({ code: "MALFORMED_RESPONSE" });
      expect(String(error)).not.toContain("synthetic-sensitive");
    }
  });

  it.each(["*not-base64*", "YQ", "YQ===", "YR==", "Y Q=="])("rejects noncanonical Beta module base64 %s", async (value) => {
    await expect(inspectWorkerModules([{ ...modules()[0]!, content_base64: value }], undefined, OPTIONS)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("rejects duplicate Beta module names and missing main module", async () => {
    await expect(inspectWorkerModules([modules()[0]!, modules()[0]!], undefined, OPTIONS)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    await expect(inspectWorkerModules(modules(), "missing.js", OPTIONS)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    await expect(inspectWorkerModules([], undefined, OPTIONS)).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("bounds streamed source and cancels oversized bodies", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); },
      cancel() { canceled = true; },
    });
    await expect(inspectWorkerContent(new Response(stream, { headers: { "content-type": "application/javascript" } }), OPTIONS)).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
    expect(canceled).toBe(true);
  });

  it("bounds module counts, names, bytes and metadata", async () => {
    await expect(inspectWorkerModules(Array.from({ length: 501 }, (_, index) => ({ ...modules()[0]!, name: `module-${index}` })), undefined, OPTIONS)).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
    await expect(inspectWorkerModules([{ ...modules()[0]!, name: "x".repeat(4097) }], undefined, OPTIONS)).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
    await expect(inspectWorkerModules([{ ...modules()[0]!, content_base64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64") }], undefined, OPTIONS)).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
    await expect(inspectWorkerContent(multipart([{ name: "metadata", bytes: "x".repeat(1024 * 1024 + 1) }, { name: "main.js", bytes: CODE }]), OPTIONS)).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
  });

  it("never overwrites an existing artifact directory or follows a destination symlink", async () => {
    await inTemp(async (directory) => {
      await expect(inspectWorkerContent(raw(), { ...OPTIONS, outDir: directory })).rejects.toMatchObject({ code: "ARTIFACT_ERROR" });
      const link = join(directory, "link");
      await symlink(directory, link);
      await expect(inspectWorkerContent(raw(), { ...OPTIONS, outDir: link })).rejects.toMatchObject({ code: "ARTIFACT_ERROR" });
      expect(await readdir(directory)).toEqual(["link"]);
    });
  });

  it("validates everything before creating private files", async () => {
    await inTemp(async (directory) => {
      const outDir = join(directory, "export");
      await expect(inspectWorkerModules([{ ...modules()[0]!, content_base64: "synthetic-sensitive" }], undefined, { ...OPTIONS, outDir })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("rejects unsupported MIME transfer encodings rather than exporting encoded text as module bytes", async () => {
    const body = '--boundary\r\nContent-Disposition: form-data; name="main.js"\r\nContent-Type: application/javascript+module\r\nContent-Transfer-Encoding: base64\r\n\r\nZXhwb3J0IGRlZmF1bHQge307\r\n--boundary--\r\n';
    await expect(inspectWorkerContent(raw(body, "multipart/form-data; boundary=boundary"), OPTIONS)).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_FORMAT" });
  });

  it("bounds the complete artifact manifest including identity before writing source files", async () => {
    await inTemp(async (directory) => {
      await expect(inspectWorkerContent(raw(), { ...OPTIONS, identity: { script: "x".repeat(1024 * 1024) }, outDir: join(directory, "export") })).rejects.toMatchObject({ code: "INVENTORY_LIMIT" });
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it("cleans up a newly created directory when artifact creation fails without echoing error details", async () => {
    await inTemp(async (directory) => {
      const outDir = join(directory, "export");
      await expect(inspectWorkerContent(raw(), {
        ...OPTIONS, outDir,
        sanitize(value) { if (value === outDir) throw new Error("synthetic-sensitive"); return OPTIONS.sanitize(value); },
      })).rejects.toMatchObject({ code: "ARTIFACT_ERROR" });
      expect(await readdir(directory)).toEqual([]);
    });
  });
});
