import { z } from "zod";
import { CloudflareAuthError, CloudflareError } from "./errors.js";
import { inspectWorkerContent, inspectWorkerModules, type WorkerSourceInspection } from "./worker-source.js";

export type InventoryResponseGet = (path: string, query?: Record<string, string | number | boolean | undefined>) => Promise<Response>;
type JsonGet = (path: string, query?: Record<string, string | number | boolean | undefined>) => Promise<unknown>;
export type InventoryWorkerTarget = { accountId?: string; script: string; service?: never; environment?: never }
  | { accountId?: string; service: string; environment: string; script?: never };
export type InventoryWorkerScope = { scope: "account"; accountId: string; script: string; service?: string; environment?: string };
export type WorkerPageOptions = { page?: number; perPage?: number };
export type WorkerExportOptions = { outDir?: string };
export type InventoryWorkerBinding = { name: string; type: string; [key: string]: unknown };
type BindingResult = { bindings: InventoryWorkerBinding[] | null; bindingsStatus: "present" | "unavailable" };
export type GetInventoryWorkerSettingsResult = InventoryWorkerScope & BindingResult & { settings: Record<string, unknown>; truncated: false };
export type GetInventoryWorkerSourceResult = InventoryWorkerScope & { source: WorkerSourceInspection };
export type InventoryWorkerDeployment = z.infer<typeof DeploymentSchema>;
export type InventoryWorkerVersionSummary = z.infer<typeof SummarySchema>;
type PageResult = { resultInfo: z.infer<typeof PageInfoSchema>; nextPage: number | null; truncated: boolean };
export type ListInventoryWorkerDeploymentsResult = InventoryWorkerScope & PageResult & { deployments: InventoryWorkerDeployment[] };
export type ListInventoryWorkerVersionsResult = InventoryWorkerScope & PageResult & { versions: InventoryWorkerVersionSummary[] };
export type GetInventoryWorkerVersionResult = InventoryWorkerScope & BindingResult & {
  version: Record<string, unknown>; source: WorkerSourceInspection | null; sourceStatus: "present" | "unavailable";
};

const METADATA_LIMIT = 1024 * 1024;
const VERSION_BODY_LIMIT = 30 * 1024 * 1024;
const Identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u);
const Text = z.string().min(1).max(2048);
const Strings = z.array(Text).max(1000);
const DateText = z.string().datetime({ offset: true });
const TargetSchema = z.union([
  z.object({ accountId: Identifier.optional(), script: Identifier }).strict(),
  z.object({ accountId: Identifier.optional(), service: Identifier, environment: Text }).strict(),
]);
const PageOptionsSchema = z.object({ page: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1).default(1), perPage: z.number().int().min(1).max(100).default(20) }).strict();
const ExportOptionsSchema = z.object({ outDir: z.string().min(1).max(4096).optional() }).strict();
const EnvelopeSchema = z.object({
  success: z.boolean(), errors: z.array(z.object({ code: z.union([z.number(), z.string()]).optional(), message: z.string() })).default([]),
  result: z.unknown(), result_info: z.unknown().optional(),
});
const PageInfoSchema = z.object({
  page: z.number().int().positive().optional(), per_page: z.number().int().positive().optional(), count: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional(), total_pages: z.number().int().nonnegative().optional(),
  has_more: z.boolean().optional(), truncated: z.boolean().optional(),
}).strict();
const ConsumerSchema = z.object({ service: Text, environment: Text.optional(), namespace: Text.optional() });
const LimitsSchema = z.object({ cpu_ms: z.number().nonnegative().optional(), subrequests: z.number().nonnegative().optional() });
const PlacementTargetSchema = z.union([
  z.object({ region: Text }), z.object({ hostname: Text }), z.object({ host: Text }),
]);
const PlacementSchema = z.object({
  mode: z.enum(["smart", "targeted"]).optional(),
  region: Text.optional(), hostname: Text.optional(), host: Text.optional(),
  target: z.array(PlacementTargetSchema).min(1).max(1).optional(),
}).refine((placement) => placement.mode === "smart" || placement.region !== undefined || placement.hostname !== undefined || placement.host !== undefined || (placement.mode === "targeted" && placement.target !== undefined));
const SettingsSchema = z.object({
  bindings: z.array(z.object({ name: Text, type: Text }).passthrough()).max(1000).optional(),
  compatibility_date: z.string().max(2048).optional(), compatibility_flags: Strings.optional(), usage_model: z.enum(["standard", "bundled", "unbound"]).optional(),
  logpush: z.boolean().optional(), limits: LimitsSchema.optional(),
  tail_consumers: z.array(ConsumerSchema).max(1000).nullable().optional(),
  placement: PlacementSchema.optional(),
  cache_options: z.object({ enabled: z.boolean(), cross_version_cache: z.boolean().optional() }).optional(),
});
const SummarySchema = z.object({
  id: Text, number: z.number().int().nonnegative().optional(),
  metadata: z.object({ created_on: DateText.optional(), modified_on: DateText.optional(), source: Text.optional() }).optional(),
});
const DeploymentSchema = z.object({
  id: z.string().uuid(), created_on: DateText, source: Text, strategy: z.literal("percentage"),
  versions: z.array(z.object({ version_id: z.string().uuid(), percentage: z.number().min(0.01).max(100) })).min(1).max(100),
}).refine((deployment) => Math.abs(deployment.versions.reduce((sum, item) => sum + item.percentage, 0) - 100) < 0.000001);
const VersionSchema = SettingsSchema.extend({
  id: z.string().uuid(), created_on: DateText, number: z.number().int().nonnegative(), urls: z.array(z.string()).max(1000),
  main_module: Text.optional(),
  modules: z.array(z.object({ name: Text, content_type: Text, content_base64: z.string() })).min(1).max(500).optional(),
});

// Only documented resource reference fields are copied. A binding's arbitrary
// text/json/key fields never enter an inventory result, regardless of its name.
const ResourceFields: Record<string, { required?: string[]; optional?: string[] }> = {
  kv_namespace: { required: ["namespace_id"] }, r2_bucket: { required: ["bucket_name"], optional: ["jurisdiction"] },
  d1: { optional: ["database_id", "id"] }, service: { required: ["service"], optional: ["environment", "entrypoint"] },
  durable_object_namespace: { optional: ["class_name", "script_name", "environment", "namespace_id", "dispatch_namespace"] },
  queue: { required: ["queue_name"] }, hyperdrive: { required: ["id"] }, vectorize: { required: ["index_name"] },
  dispatch_namespace: { required: ["namespace"] }, workflow: { required: ["workflow_name"], optional: ["class_name", "script_name"] },
  secrets_store_secret: { required: ["store_id", "secret_name"] }, mtls_certificate: { required: ["certificate_id"] },
  analytics_engine: { required: ["dataset"] }, pipelines: { required: ["pipeline"] }, k2: { required: ["stream"] },
  ai_search: { required: ["instance_name"], optional: ["namespace"] }, ai_search_namespace: { required: ["namespace"] },
  artifacts: { required: ["namespace"] }, messaging: { required: ["namespace"] }, flagship: { required: ["app_id"] },
  vpc_service: { required: ["service_id"] }, vpc_network: { optional: ["network_id", "tunnel_id", "identity"] },
  text_blob: { required: ["part"] }, data_blob: { required: ["part"] }, wasm_module: { required: ["part"] },
  inherit: { optional: ["old_name", "version_id"] }, ratelimit: { required: ["namespace_id"] },
  ai: {}, assets: {}, browser: {}, images: {}, media: {}, version_metadata: {}, worker_loader: {},
};

/** Account-scoped implementation reads. Public results deliberately contain no source bytes. */
export class WorkerInventoryReader {
  constructor(
    private readonly workerGet: JsonGet,
    private readonly workerDefaults: { accountId?: string } = {},
    private readonly workerCredentials: readonly string[] = [],
    private readonly workerResponseGet?: InventoryResponseGet,
  ) {}

  private sanitize(value: string): string {
    let result = value.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>]+/giu, "[REDACTED_URL]");
    if (/\b(?:bearer\s+|(?:password|secret|token|api[_-]?key|credential)\s*[:=])/iu.test(result)) result = "[REDACTED]";
    for (const credential of this.workerCredentials) if (credential) result = result.split(credential).join("[REDACTED]");
    return result.replace(/[\u0000-\u001f\u007f]/gu, " ");
  }

  private safe<T>(value: T): T {
    if (typeof value === "string") return this.sanitize(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.safe(item)) as T;
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.safe(item)])) as T;
  }

  private error(path: string, code = "MALFORMED_RESPONSE", status?: number): CloudflareError {
    return new CloudflareError(code === "MALFORMED_RESPONSE" ? "Malformed Cloudflare Worker inventory response." : "Cloudflare Worker inventory request failed; upstream text omitted because it may contain credentials.", code, status,
      { requestMethod: "GET", requestPath: this.sanitize(path), apiResponse: status !== undefined });
  }

  private workerTarget(target: InventoryWorkerTarget): { metadata: InventoryWorkerScope; path: string; versionPath: string } {
    const parsed = TargetSchema.safeParse(target);
    if (!parsed.success) throw new CloudflareError("Supply a Worker script name, or a service name with its explicit production environment, and only an account ID.", "CONFIG_ERROR");
    const account = Identifier.safeParse(parsed.data.accountId ?? this.workerDefaults.accountId);
    if (!account.success) throw new CloudflareError("Account ID is required for Worker inspection; set --account-id or CLOUDFLARE_ACCOUNT_ID.", "CONFIG_ERROR");
    const service = "service" in parsed.data ? parsed.data.service : undefined;
    const environment = "environment" in parsed.data ? parsed.data.environment : undefined;
    if (environment !== undefined && environment !== "production") throw new CloudflareError("Legacy nonproduction Worker service environments have no supported public inventory API. Use the actual assigned modern Worker name; no environment suffix is inferred.", "UNSUPPORTED_WORKER_ENVIRONMENT");
    const script = "script" in parsed.data ? parsed.data.script : parsed.data.service;
    const metadata: InventoryWorkerScope = { scope: "account", accountId: account.data, script, ...(service === undefined ? {} : { service, environment }) };
    const prefix = `/client/v4/accounts/${encodeURIComponent(account.data)}/workers`;
    return { metadata: this.safe(metadata), path: `${prefix}/scripts/${encodeURIComponent(script)}`, versionPath: `${prefix}/workers/${encodeURIComponent(script)}/versions` };
  }

  private parse<T extends z.ZodTypeAny>(schema: T, value: unknown, path: string): z.infer<T> {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw this.error(path);
    return parsed.data;
  }

  private bounded<T>(value: T, reserve = 0): T {
    if (Buffer.byteLength(JSON.stringify(value)) > METADATA_LIMIT - reserve) throw new CloudflareError("Worker inventory metadata exceeds the 1 MiB inspection limit.", "INVENTORY_LIMIT_EXCEEDED");
    return value;
  }

  private async body(response: Response, path: string, limit: number): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader) throw this.error(path);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) { await reader.cancel(); throw new CloudflareError("Worker response exceeds the bounded inspection limit.", "INVENTORY_LIMIT_EXCEEDED"); }
        chunks.push(next.value);
      }
      try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw this.error(path); }
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      throw this.error(path, "UPSTREAM_READ_FAILED", response.status);
    } finally { reader.releaseLock(); }
  }

  private failureCode(value: unknown): string {
    const parsed = EnvelopeSchema.safeParse(value);
    const code = parsed.success ? String(parsed.data.errors[0]?.code ?? "API_ERROR") : "API_ERROR";
    return /^\d{1,10}$/u.test(code) ? code : "API_ERROR";
  }

  private async response(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<Response> {
    if (!this.workerResponseGet) throw new CloudflareError("Worker source requires an authenticated GET response transport.", "UNSUPPORTED_TRANSPORT");
    let response: Response;
    try { response = await this.workerResponseGet(path, query); } catch { throw this.error(path, "UPSTREAM_READ_FAILED"); }
    if (!response.ok) {
      let body: unknown;
      try { body = await this.body(response, path, METADATA_LIMIT); } catch { body = undefined; }
      const options = { requestMethod: "GET", requestPath: this.sanitize(path), apiResponse: EnvelopeSchema.safeParse(body).success };
      if (response.status === 401) throw new CloudflareAuthError("Worker inventory authentication failed; upstream text omitted.", options);
      throw new CloudflareError("Cloudflare Worker inventory request failed; upstream text omitted because it may contain credentials.", this.failureCode(body), response.status, options);
    }
    return response;
  }

  private async workerRead<T extends z.ZodTypeAny>(path: string, schema: T, query?: Record<string, string | number | boolean | undefined>, source = false): Promise<{ result: z.infer<T>; info: unknown }> {
    let value: unknown;
    if (this.workerResponseGet) value = await this.body(await this.response(path, query), path, source ? VERSION_BODY_LIMIT : METADATA_LIMIT);
    else {
      try { value = await this.workerGet(path, query); } catch (error) {
        throw this.error(path, error instanceof CloudflareError ? this.failureCode({ success: false, result: null, errors: [{ code: error.code, message: "" }] }) : "UPSTREAM_READ_FAILED", error instanceof CloudflareError ? error.statusCode : undefined);
      }
    }
    const envelope = this.parse(EnvelopeSchema, value, path);
    if (!envelope.success) {
      if (!envelope.errors.length) throw this.error(path);
      throw this.error(path, this.failureCode(value));
    }
    if (envelope.errors.length) throw this.error(path);
    return { result: this.parse(schema, envelope.result, path), info: envelope.result_info };
  }

  private bindings(value: z.infer<typeof SettingsSchema>["bindings"], path: string): BindingResult {
    if (value === undefined) return { bindings: null, bindingsStatus: "unavailable" };
    const names = new Set<string>();
    const bindings = value.map((binding): InventoryWorkerBinding => {
      if (names.has(binding.name)) throw this.error(path);
      names.add(binding.name);
      const output: InventoryWorkerBinding = { name: binding.name, type: binding.type };
      if (["plain_text", "json", "secret_text", "secret_key"].includes(binding.type)) return { ...output, value: "[REDACTED]" };
      const fields = ResourceFields[binding.type];
      if (!fields) return { ...output, detailsStatus: "unavailable" };
      for (const key of fields.required ?? []) output[key] = this.parse(Text, binding[key], path);
      for (const key of fields.optional ?? []) if (binding[key] !== undefined) output[key] = this.parse(Text, binding[key], path);
      if (binding.type === "d1" && output.database_id === undefined && output.id === undefined) throw this.error(path);
      if (binding.type === "dispatch_namespace" && binding.outbound !== undefined) {
        output.outbound = this.parse(z.object({ worker: z.object({ service: Text.optional(), environment: Text.optional(), entrypoint: Text.optional() }).optional(), params: z.array(z.object({ name: Text })).max(100).optional() }), binding.outbound, path);
      }
      if (binding.type === "ratelimit" && binding.simple !== undefined) output.simple = this.parse(z.object({ limit: z.number(), period: z.number(), mitigation_timeout: z.number().optional() }), binding.simple, path);
      return output;
    });
    return this.safe({ bindings, bindingsStatus: "present" as const });
  }

  private workerComplete(info: unknown, path: string): void {
    if (info === undefined) return;
    const parsed = this.parse(PageInfoSchema, info, path);
    if (parsed.has_more || parsed.truncated || (parsed.page ?? 1) > 1 || (parsed.total_pages ?? 1) > 1 || (parsed.count ?? 1) > 1 || (parsed.total_count ?? 1) > 1) throw this.error(path);
  }

  private pagination(info: unknown, options: z.infer<typeof PageOptionsSchema>, count: number, path: string): PageResult {
    const parsed = this.parse(PageInfoSchema, info ?? {}, path);
    if ((parsed.page !== undefined && parsed.page !== options.page) || (parsed.per_page !== undefined && parsed.per_page !== options.perPage) || (parsed.count !== undefined && parsed.count !== count) || count > options.perPage) throw this.error(path);
    const observed = (options.page - 1) * options.perPage + count;
    if (!Number.isSafeInteger(observed) ||
      (count > 0 && parsed.total_count !== undefined && parsed.total_count < observed) ||
      (count > 0 && parsed.total_pages !== undefined && parsed.total_pages < options.page) ||
      (parsed.total_count !== undefined && parsed.total_pages !== undefined &&
        (parsed.total_count === 0 ? parsed.total_pages > 1 : parsed.total_pages !== Math.ceil(parsed.total_count / options.perPage)))) throw this.error(path);
    const hasTotals = parsed.total_pages !== undefined || parsed.total_count !== undefined;
    const more = Boolean(parsed.has_more || parsed.truncated ||
      (parsed.total_pages !== undefined && parsed.total_pages > options.page) ||
      (parsed.total_count !== undefined && parsed.total_count > (options.page - 1) * options.perPage + count) ||
      (!hasTotals && parsed.has_more !== false && parsed.truncated !== false && count === options.perPage));
    if (more && count === 0) throw this.error(path);
    return { resultInfo: { ...parsed, page: options.page, per_page: options.perPage, count }, nextPage: more ? options.page + 1 : null, truncated: more };
  }

  async getWorkerSettings(target: InventoryWorkerTarget): Promise<GetInventoryWorkerSettingsResult> {
    const resolved = this.workerTarget(target);
    const path = `${resolved.path}/settings`;
    const read = await this.workerRead(path, SettingsSchema);
    this.workerComplete(read.info, path);
    const { bindings, ...settings } = read.result;
    return this.bounded(this.safe({ ...resolved.metadata, settings, ...this.bindings(bindings, path), truncated: false as const }));
  }

  async getWorkerSource(target: InventoryWorkerTarget, options: WorkerExportOptions = {}): Promise<GetInventoryWorkerSourceResult> {
    const resolved = this.workerTarget(target);
    const parsed = ExportOptionsSchema.safeParse(options);
    if (!parsed.success) throw new CloudflareError("Worker source output directory must be a nonempty local path.", "CONFIG_ERROR");
    // Consume the body once. Cloning tees the stream, which can prevent bounded
    // cancellation from settling while an unread export branch remains open.
    const source = await inspectWorkerContent(await this.response(resolved.path), {
      ...parsed.data,
      identity: { ...resolved.metadata },
      sanitize: (value) => this.sanitize(value),
      validateMetadata: (metadata) => { this.bounded({ ...resolved.metadata, source: metadata }, parsed.data.outDir ? 64 * 1024 : 0); },
    });
    return { ...resolved.metadata, source };
  }

  async listWorkerDeployments(target: InventoryWorkerTarget, options: WorkerPageOptions = {}): Promise<ListInventoryWorkerDeploymentsResult> {
    const resolved = this.workerTarget(target);
    const page = PageOptionsSchema.safeParse(options);
    if (!page.success) throw new CloudflareError("Worker page must be a positive integer; perPage must be an integer from 1 to 100.", "CONFIG_ERROR");
    const path = `${resolved.path}/deployments`;
    const read = await this.workerRead(path, z.object({ deployments: z.array(DeploymentSchema).max(100) }), { page: page.data.page, per_page: page.data.perPage });
    return this.bounded(this.safe({ ...resolved.metadata, deployments: read.result.deployments, ...this.pagination(read.info, page.data, read.result.deployments.length, path) }));
  }

  async listWorkerVersions(target: InventoryWorkerTarget, options: WorkerPageOptions = {}): Promise<ListInventoryWorkerVersionsResult> {
    const resolved = this.workerTarget(target);
    const page = PageOptionsSchema.safeParse(options);
    if (!page.success) throw new CloudflareError("Worker page must be a positive integer; perPage must be an integer from 1 to 100.", "CONFIG_ERROR");
    const path = `${resolved.path}/versions`;
    const read = await this.workerRead(path, z.object({ items: z.array(SummarySchema).max(100) }), { page: page.data.page, per_page: page.data.perPage });
    return this.bounded(this.safe({ ...resolved.metadata, versions: read.result.items, ...this.pagination(read.info, page.data, read.result.items.length, path) }));
  }

  async getWorkerVersion(target: InventoryWorkerTarget, version: string, options: WorkerExportOptions = {}): Promise<GetInventoryWorkerVersionResult> {
    const resolved = this.workerTarget(target);
    const uuidTemplate = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
    const prefix = typeof version === "string" && version.length >= 8 && version.length <= 36 && [...version].every((character, index) => uuidTemplate[index] === "-" ? character === "-" : /[a-f0-9]/iu.test(character));
    if (version !== "latest" && !prefix) throw new CloudflareError("Worker version must be a UUID, a UUID prefix of at least 8 characters, or latest.", "CONFIG_ERROR");
    const parsed = ExportOptionsSchema.safeParse(options);
    if (!parsed.success) throw new CloudflareError("Worker source output directory must be a nonempty local path.", "CONFIG_ERROR");
    const path = `${resolved.versionPath}/${encodeURIComponent(version)}`;
    const read = await this.workerRead(path, VersionSchema, { include: "modules" }, true);
    this.workerComplete(read.info, path);
    if (version !== "latest" && !read.result.id.toLowerCase().startsWith(version.toLowerCase())) throw this.error(path);
    const { modules, bindings, urls: _urls, ...metadata } = read.result;
    if (modules === undefined && parsed.data.outDir !== undefined) throw new CloudflareError("Cloudflare did not return the requested Worker version modules; source export is unavailable.", "SOURCE_UNAVAILABLE");
    const bindingResult = this.bindings(bindings, path);
    const base = this.safe({ ...resolved.metadata, version: metadata, ...bindingResult });
    if (modules === undefined) return this.bounded({ ...base, source: null, sourceStatus: "unavailable" as const });
    const source = await inspectWorkerModules(modules, read.result.main_module, {
      ...parsed.data,
      identity: { ...resolved.metadata, versionId: read.result.id },
      sanitize: (value) => this.sanitize(value),
      validateMetadata: (metadata) => { this.bounded({ ...base, source: metadata, sourceStatus: "present" }, parsed.data.outDir ? 64 * 1024 : 0); },
    });
    return { ...base, source, sourceStatus: "present" };
  }
}
