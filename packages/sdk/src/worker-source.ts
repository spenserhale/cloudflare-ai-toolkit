import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { CloudflareError } from "./errors.js";

export interface WorkerSourceOptions {
  readonly outDir?: string;
  readonly identity: Record<string, string>;
  readonly sanitize: (value: string) => string;
  /** Validate the containing inventory metadata before creating any artifacts. */
  readonly validateMetadata?: (source: WorkerSourceInspection) => void;
}

export interface WorkerSourceModule {
  readonly name: string;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly file?: string;
}

export interface WorkerSourceInspection {
  readonly format: "service-worker" | "modules";
  readonly entrypoint?: string;
  readonly modules: WorkerSourceModule[];
  readonly totalBytes: number;
  readonly artifactDirectory?: string;
  readonly sensitive: true;
  readonly truncated: false;
}

export interface WorkerEncodedModule {
  readonly name: string;
  readonly content_type: string;
  readonly content_base64: string;
}

interface SourceModule {
  name: string;
  contentType: string;
  bytes: Buffer;
}

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_MODULES = 500;
const MAX_NAME = 4096;
const MAX_METADATA = 1024 * 1024;
const MAX_HEADERS = 16 * 1024;

function fail(code: string, message: string): never {
  throw new CloudflareError(message, code);
}

function malformed(): never {
  return fail("MALFORMED_RESPONSE", "Malformed Worker source response; no source was exported.");
}

function limit(): never {
  return fail("INVENTORY_LIMIT", "Worker inspection exceeds limits (20 MiB source, 500 modules, 4096-byte names, 1 MiB metadata); no source was exported.");
}

function validateName(name: unknown): asserts name is string {
  if (typeof name !== "string" || name.length === 0 || /[\u0000-\u001f\u007f]/u.test(name)) malformed();
  if (Buffer.byteLength(name) > MAX_NAME) limit();
}

function validateMediaType(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:\s*;[^\r\n]*)?$/iu.test(value)) malformed();
  if (Buffer.byteLength(value) > MAX_NAME) limit();
}

function safeLabel(value: string, options: WorkerSourceOptions): string {
  // Module identities can themselves be URLs. Hide the whole identity if it
  // contains userinfo, a query, or a fragment, including non-HTTP schemes.
  for (const match of value.matchAll(/(?:\b[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>]+/giu)) {
    try {
      const url = new URL(match[0], "https://module.invalid");
      if (url.username || url.password || url.search || url.hash) return "[REDACTED]";
    } catch { return "[REDACTED]"; }
  }
  return options.sanitize(value);
}

async function readBounded(response: Response): Promise<Buffer> {
  const advertised = response.headers.get("content-length");
  if (advertised && /^\d+$/u.test(advertised) && Number(advertised) > MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    limit();
  }
  if (!response.body) malformed();
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        limit();
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } catch (error) {
    if (error instanceof CloudflareError) throw error;
    malformed();
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function quotedParameter(header: string, parameter: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${parameter}=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]+))`, "iu").exec(header);
  return match?.[1]?.replace(/\\(.)/gu, "$1") ?? match?.[2];
}

/** Parse only MIME framing; module bytes are never converted to text. */
function parseMultipart(body: Buffer, contentType: string): { modules: SourceModule[]; mainModule?: string } {
  const boundary = quotedParameter(contentType, "boundary");
  if (!boundary || boundary.length > 70 || /[\r\n\u0000]/u.test(boundary)) malformed();
  const opening = Buffer.from(`--${boundary}\r\n`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  if (!body.subarray(0, opening.length).equals(opening)) malformed();
  let position = opening.length;
  let metadataSeen = false;
  let mainModule: string | undefined;
  const modules: SourceModule[] = [];
  for (;;) {
    const headerEnd = body.indexOf("\r\n\r\n", position);
    if (headerEnd < 0 || headerEnd - position > MAX_HEADERS) malformed();
    const headers = new Map<string, string>();
    for (const line of body.subarray(position, headerEnd).toString("utf8").split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) malformed();
      const key = line.slice(0, colon).trim().toLowerCase();
      if (headers.has(key)) malformed();
      headers.set(key, line.slice(colon + 1).trim());
    }
    const disposition = headers.get("content-disposition");
    if (!disposition || !/^form-data\s*;/iu.test(disposition)) malformed();
    const encoding = headers.get("content-transfer-encoding")?.toLowerCase();
    if (encoding !== undefined && encoding !== "binary" && encoding !== "8bit") {
      fail("UNSUPPORTED_CONTENT_FORMAT", "Unsupported Worker multipart transfer encoding; no source was exported.");
    }
    const name = quotedParameter(disposition, "name");
    validateName(name);
    let end = body.indexOf(delimiter, headerEnd + 4);
    while (end >= 0) {
      const suffix = body.subarray(end + delimiter.length, end + delimiter.length + 2).toString("ascii");
      if (suffix === "--" || suffix === "\r\n") break;
      end = body.indexOf(delimiter, end + delimiter.length);
    }
    if (end < 0) malformed();
    const bytes = body.subarray(headerEnd + 4, end);
    if (name === "metadata") {
      if (metadataSeen) malformed();
      metadataSeen = true;
      if (bytes.length > MAX_METADATA) limit();
      let metadata: unknown;
      try { metadata = JSON.parse(bytes.toString("utf8")); } catch { malformed(); }
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) malformed();
      const value = (metadata as Record<string, unknown>).main_module;
      if (value !== undefined) { validateName(value); mainModule = value; }
    } else {
      const mediaType = headers.get("content-type") ?? "text/plain";
      validateMediaType(mediaType);
      modules.push({ name, contentType: mediaType, bytes });
      if (modules.length > MAX_MODULES) limit();
    }
    position = end + delimiter.length;
    if (body.subarray(position, position + 2).toString("ascii") === "--") {
      position += 2;
      if (body.subarray(position).toString("ascii") !== "\r\n" && position !== body.length) malformed();
      return { modules, ...(mainModule === undefined ? {} : { mainModule }) };
    }
    position += 2;
  }
}

async function exportPrivate(source: WorkerSourceInspection, modules: SourceModule[], options: WorkerSourceOptions): Promise<WorkerSourceInspection> {
  if (options.outDir === undefined) return source;
  if (typeof options.outDir !== "string" || options.outDir.trim().length === 0) {
    fail("ARTIFACT_ERROR", "A new local output directory is required; no source was exported.");
  }
  const requested = resolve(options.outDir);
  let directory: string | undefined;
  let created = false;
  try {
    // Resolve existing ancestors once. The destination itself must be absent;
    // mkdir is exclusive and generated child names never use API filenames.
    const parent = await realpath(dirname(requested));
    directory = join(parent, basename(requested));
    try { await lstat(directory); fail("ARTIFACT_ERROR", "Output directory already exists; choose a new private directory."); }
    catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    }
    await mkdir(directory, { mode: 0o700 });
    created = true;
    await chmod(directory, 0o700);
    const inspected: WorkerSourceInspection = {
      ...source,
      artifactDirectory: safeLabel(directory, options),
      modules: source.modules.map((module, index) => ({ ...module, file: `module-${String(index + 1).padStart(4, "0")}.bin` })),
    };
    const identity = Object.fromEntries(Object.entries(options.identity).map(([key, value]) => [key, safeLabel(value, options)]));
    const manifest = JSON.stringify({ identity, source: inspected }, null, 2) + "\n";
    if (Buffer.byteLength(manifest) > MAX_METADATA) limit();
    for (const [index, module] of modules.entries()) {
      await writeFile(join(directory, inspected.modules[index]!.file!), module.bytes, { mode: 0o600, flag: "wx" });
    }
    await writeFile(join(directory, "manifest.json"), manifest, { mode: 0o600, flag: "wx" });
    return inspected;
  } catch (error) {
    if (created && directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof CloudflareError) throw error;
    fail("ARTIFACT_ERROR", "Cannot create private Worker source artifacts; choose a new directory with an existing writable parent. No source was exported.");
  }
}

async function inspect(modules: SourceModule[], format: WorkerSourceInspection["format"], mainModule: string | undefined, options: WorkerSourceOptions): Promise<WorkerSourceInspection> {
  if (!modules.length) malformed();
  if (modules.length > MAX_MODULES) limit();
  const names = new Set<string>();
  let totalBytes = 0;
  for (const module of modules) {
    validateName(module.name);
    validateMediaType(module.contentType);
    if (names.has(module.name)) malformed();
    names.add(module.name);
    totalBytes += module.bytes.length;
    if (totalBytes > MAX_BYTES) limit();
  }
  if (mainModule !== undefined) {
    validateName(mainModule);
    if (!names.has(mainModule)) malformed();
  }
  const source: WorkerSourceInspection = {
    format,
    ...(mainModule === undefined ? {} : { entrypoint: safeLabel(mainModule, options) }),
    modules: modules.map((module) => ({
      name: safeLabel(module.name, options),
      contentType: safeLabel(module.contentType.split(";", 1)[0]!.trim().toLowerCase(), options),
      bytes: module.bytes.length,
      sha256: createHash("sha256").update(module.bytes).digest("hex"),
    })),
    totalBytes,
    sensitive: true,
    truncated: false,
  };
  if (Buffer.byteLength(JSON.stringify(source)) > MAX_METADATA) limit();
  options.validateMetadata?.(source);
  return exportPrivate(source, modules, options);
}

/** Inspect an unpinned original script download, never returning its source. */
export async function inspectWorkerContent(response: Response, options: WorkerSourceOptions): Promise<WorkerSourceInspection> {
  const contentType = response.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/javascript" && mediaType !== "text/javascript" && mediaType !== "application/javascript+module" && mediaType !== "multipart/form-data") {
    await response.body?.cancel().catch(() => undefined);
    fail("UNSUPPORTED_CONTENT_FORMAT", "Unsupported Worker source content format; expected JavaScript or multipart/form-data. No source was exported.");
  }
  const body = await readBounded(response);
  if (mediaType === "multipart/form-data") {
    const result = parseMultipart(body, contentType);
    return inspect(result.modules, "modules", result.mainModule, options);
  }
  if (body.length === 0) malformed();
  return inspect([{ name: "worker.js", contentType, bytes: body }], mediaType === "application/javascript+module" ? "modules" : "service-worker", undefined, options);
}

/** Decode documented Beta version modules directly into private source files. */
export async function inspectWorkerModules(modules: WorkerEncodedModule[], mainModule: string | undefined, options: WorkerSourceOptions): Promise<WorkerSourceInspection> {
  if (!Array.isArray(modules)) malformed();
  if (modules.length > MAX_MODULES) limit();
  let size = 0;
  const decoded = modules.map((module) => {
    if (!module || typeof module !== "object" || typeof module.content_base64 !== "string") malformed();
    validateName(module.name);
    validateMediaType(module.content_type);
    const padding = module.content_base64.endsWith("==") ? 2 : module.content_base64.endsWith("=") ? 1 : 0;
    if ((module.content_base64.length / 4) * 3 - padding > MAX_BYTES) limit();
    if (module.content_base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/u.test(module.content_base64)) malformed();
    const bytes = Buffer.from(module.content_base64, "base64");
    if (bytes.toString("base64") !== module.content_base64) malformed();
    size += bytes.length;
    if (size > MAX_BYTES) limit();
    return { name: module.name, contentType: module.content_type, bytes };
  });
  return inspect(decoded, "modules", mainModule, options);
}
