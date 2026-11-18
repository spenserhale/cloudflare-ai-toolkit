import { z } from "zod";
import { CloudflareAuthError, CloudflareError } from "./errors.js";
import {
  InventoryBotManagementSchema,
  InventoryCursorResultInfoSchema,
  InventoryManagedTransformsSchema,
  InventoryPageRuleSchema,
  InventoryRulesetMetadataSchema,
  InventoryRulesetSchema,
  InventoryTargetSchema,
  InventoryUrlNormalizationSchema,
  InventoryWorkerDomainSchema,
  InventoryWorkerRouteSchema,
  InventoryZoneSettingSchema,
  InventoryListSchema,
  InventoryListKindSchema,
  InventoryListIPItemSchema,
  InventoryListRedirectItemSchema,
  InventoryListHostnameItemSchema,
  InventoryListASNItemSchema,
  type GetInventoryListResult,
  type InventoryListItem,
  type ListInventoryListsOptions,
  type ListInventoryListsResult,
  type ListInventoryListItemsOptions,
  type ListInventoryListItemsResult,
  type GetInventoryBotManagementResult,
  type GetInventoryManagedTransformsResult,
  type GetInventoryPhaseEntrypointResult,
  type GetInventoryRulesetResult,
  type GetInventoryUrlNormalizationResult,
  type GetInventoryZoneSettingResult,
  type InventoryCursorResultInfo,
  type InventoryRuleset,
  type InventoryRulesetMetadata,
  type InventoryScope,
  type InventoryTarget,
  type ListInventoryPageRulesResult,
  type ListInventoryRulesetsOptions,
  type ListInventoryRulesetsResult,
  type ListInventoryWorkerDomainsOptions,
  type ListInventoryWorkerDomainsResult,
  type ListInventoryWorkerRoutesResult,
} from "./types.js";

/** A GET-only transport: inventory cannot issue writes. */
export type InventoryGet = (path: string, query?: Record<string, string | number | boolean | undefined>) => Promise<unknown>;

const EnvelopeSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.union([z.string(), z.number()]).optional(), message: z.string() }).passthrough()).default([]),
  messages: z.array(z.unknown()).default([]),
  result: z.unknown(),
  result_info: z.unknown().optional(),
}).passthrough();

const PaginationSchema = InventoryCursorResultInfoSchema.extend({
  page: z.number().int().positive().optional(),
  per_page: z.number().int().nonnegative().optional(),
  count: z.number().int().nonnegative().optional(),
  total_count: z.number().int().nonnegative().optional(),
  total_pages: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  has_more: z.boolean().optional(),
});
type Pagination = z.infer<typeof PaginationSchema>;

const REDACTED = "[REDACTED]";

function secretField(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return /(?:password|passwd|secret|credential|authorization|cookie|apikey|privatekey|accesskey|apitoken|authtoken|accesstoken|refreshtoken|bearertoken)/u.test(normalized) ||
    /^(?:auth|token|key|signature|sig|jwt|session|sessionid|sessiontoken|xauth|xauthkey|xauthemail|cfclearance)$/u.test(normalized);
}

/** Rules language can contain shared credentials outside header-mutation objects. */
function credentialBearingExpression(value: string): boolean {
  const lookups = /\bhttp\.request\.(headers|cookies|uri\.args(?:\.values)?)\s*\[\s*(?:r#*)?["']([^"']+)["']#*\s*\]/giu;
  for (const match of value.matchAll(lookups)) {
    const field = match[1]?.toLowerCase();
    const name = match[2];
    if (field === "cookies" || (name && (secretField(name) || /^x[-_]?auth/iu.test(name)))) return true;
  }
  if (/\bhttp\.cookie\b/iu.test(value)) return true;
  if (/\b(?:raw\.)?http\.request\.(?:uri|full_uri)\b/iu.test(value)) {
    for (const match of value.matchAll(/(?:^|[?&\s"'(])([a-z_][-a-z0-9_.]*)=/giu)) {
      if (match[1] && secretField(match[1])) return true;
    }
  }
  return false;
}

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    let changed = false;
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      changed = true;
    }
    for (const key of [...url.searchParams.keys()]) {
      if (secretField(key)) { url.searchParams.set(key, REDACTED); changed = true; }
    }
    return changed ? url.toString() : candidate;
  } catch { return candidate; }
}

function redactUrls(value: string): string {
  // Apostrophes are legal URL path/query characters, including before secrets.
  return value.replace(/https?:\/\/[^\s"<>\\]+/giu, redactUrl);
}

/** Bulk Redirect source URLs may omit the scheme, unlike ordinary URL fields. */
function redactListUrl(value: string): string {
  const explicit = /^https?:\/\//iu.test(value);
  const relative = value.startsWith("//");
  const prefix = explicit ? "" : relative ? "https:" : "https://";
  const redacted = redactUrl(`${prefix}${value}`);
  return redacted.startsWith(prefix) ? redacted.slice(prefix.length) : redacted;
}

/** API errors may reflect Bulk Redirect sources without their optional scheme. */
function redactOmittedSchemeUrls(value: string): string {
  return value.replace(
    /(^|[\s"'(<=>])((?:\/\/)?(?:[^\s"<>\\/?#@]+@)?(?:(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?|\[[a-f\d:.]+\])(?::\d+)?(?:[/?#][^\s"<>\\]*)?)/giu,
    (_match, boundary: string, candidate: string) => {
      // Bare email addresses are ordinary inventory text, not URL userinfo.
      if (/^[^:@/?#]+@[^:/?#]+$/u.test(candidate)) return boundary + candidate;
      return boundary + redactListUrl(candidate);
    },
  );
}

/** Reads native migration configuration while preserving fields added by Cloudflare. */
export class InventoryReader {
  constructor(
    private readonly get: InventoryGet,
    private readonly defaults: { zoneId?: string; accountId?: string } = {},
    private readonly credentialValues: readonly string[] = []
  ) {}

  private text(value: string): string {
    // Conservatively hide the whole expression; rewriting a rules-language
    // literal without a parser could leave another copy of the credential.
    if (credentialBearingExpression(value)) return REDACTED;
    let result = redactOmittedSchemeUrls(redactUrls(value));
    for (const secret of this.credentialValues) {
      if (secret) result = result.split(secret).join(REDACTED);
    }
    return result;
  }

  private headers(value: unknown, headerName?: string): unknown {
    if (Array.isArray(value)) return value.map((item) => this.headers(item, headerName));
    if (!value || typeof value !== "object") return headerName && secretField(headerName) ? REDACTED : this.redact(value);
    const object = value as Record<string, unknown>;
    const name = typeof object.name === "string" ? object.name : typeof object.header_name === "string" ? object.header_name : headerName;
    const sensitive = name !== undefined && (secretField(name) || /^x[-_]?auth/iu.test(name));
    return Object.fromEntries(Object.entries(object).map(([key, item]) => {
      if (["name", "id", "operation", "op"].includes(key.toLowerCase())) return [key, this.redact(item)];
      if (["value", "expression"].includes(key.toLowerCase())) return [key, sensitive ? REDACTED : this.redact(item)];
      return [key, this.headers(item, name ?? key)];
    }));
  }

  private redact<T>(value: T, path: readonly string[] = []): T {
    if (typeof value === "string") return this.text(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.redact(item, path)) as T;
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(object).map(([key, item]) => {
      // Cache-key cookies list names/presence checks, never cookie contents.
      const cookieConfiguration = key === "cookie" && path.slice(-2).join(".") === "cache_key.custom_key";
      if (secretField(key) && !cookieConfiguration) return [key, REDACTED];
      if ((key === "source_url" || key === "target_url") && typeof item === "string") return [key, this.text(redactListUrl(item))];
      if (/^(?:request_|response_)?headers$/iu.test(key)) return [key, this.headers(item)];
      // Page Rules and other APIs encode header mutations as an action ID/value pair.
      if (key === "value" && typeof object.id === "string" && /headers?/iu.test(object.id)) return [key, this.headers(item)];
      return [key, this.redact(item, [...path, key])];
    })) as T;
  }

  private sanitizedError(error: unknown): unknown {
    if (!(error instanceof CloudflareError)) {
      return error instanceof Error ? new Error(this.text(error.message)) : new Error(this.text(String(error)));
    }
    const options = {
      requiredPermissions: error.requiredPermissions,
      docsUrl: error.docsUrl,
      requestMethod: error.requestMethod,
      requestPath: error.requestPath,
      apiResponse: error.apiResponse,
    };
    return error instanceof CloudflareAuthError
      ? new CloudflareAuthError(this.text(error.message), options)
      : new CloudflareError(this.text(error.message), error.code, error.statusCode, options);
  }

  private malformed(path: string, detail = "invalid envelope or result"): CloudflareError {
    return new CloudflareError(`Malformed Cloudflare response for GET ${path}: ${detail}`, "MALFORMED_RESPONSE", undefined, { requestMethod: "GET", requestPath: path });
  }

  private segment(value: string | undefined, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new CloudflareError(`${label} is required and must not be empty.`, "CONFIG_ERROR");
    }
    return value;
  }

  private zone(zoneId?: string): string { return this.segment(zoneId ?? this.defaults.zoneId, "Zone ID"); }
  private account(accountId?: string): string { return this.segment(accountId ?? this.defaults.accountId, "Account ID"); }

  private target(target: InventoryTarget): { metadata: InventoryScope; path: string } {
    const parsed = InventoryTargetSchema.safeParse(target);
    if (!parsed.success) throw new CloudflareError("Explicit scope ('zone' or 'account') and only its matching target ID are required.", "CONFIG_ERROR");
    if (parsed.data.scope === "zone") {
      const zoneId = this.zone(parsed.data.zoneId);
      return { metadata: { scope: "zone", zoneId }, path: `/client/v4/zones/${encodeURIComponent(zoneId)}` };
    }
    const accountId = this.account(parsed.data.accountId);
    return { metadata: { scope: "account", accountId }, path: `/client/v4/accounts/${encodeURIComponent(accountId)}` };
  }

  private async read<T extends z.ZodTypeAny>(path: string, schema: T, query?: Record<string, string | number | boolean | undefined>): Promise<{ result: z.infer<T>; info: Pagination }> {
    let body: unknown;
    try { body = await this.get(path, query); } catch (error) { throw this.sanitizedError(error); }
    const envelope = EnvelopeSchema.safeParse(body);
    if (!envelope.success) throw this.malformed(path);
    if (!envelope.data.success) {
      const first = envelope.data.errors[0];
      throw new CloudflareError(this.text(first?.message ?? "Cloudflare API request failed"), String(first?.code ?? "API_ERROR"), undefined, { requestMethod: "GET", requestPath: path });
    }
    const result = schema.safeParse(envelope.data.result);
    const info = PaginationSchema.safeParse(envelope.data.result_info === undefined ? {} : envelope.data.result_info);
    if (!result.success || !info.success) throw this.malformed(path);
    return { result: result.data, info: info.data };
  }

  private complete(path: string, info: Pagination, count: number): void {
    if (info.cursors?.after || info.cursors?.before || info.truncated || info.has_more ||
      (info.page !== undefined && info.page > 1) || (info.total_pages !== undefined && info.total_pages > 1) ||
      (info.total_count !== undefined && info.total_count > count) || (info.count !== undefined && info.count > count)) {
      throw this.malformed(path, "response reports incomplete inventory; this endpoint has no supported pagination contract");
    }
  }

  private ruleset(result: z.infer<typeof InventoryRulesetSchema>): InventoryRuleset {
    return { ...result, rules: result.rules.map((rule, index) => ({ ...rule, order: index + 1 })) };
  }

  private listTarget(target: InventoryTarget): { metadata: { scope: "account"; accountId: string }; path: string } {
    const resolved = this.target(target);
    if (resolved.metadata.scope !== "account") throw new CloudflareError("Lists require explicit account scope; zone scope is not supported.", "CONFIG_ERROR");
    return { metadata: resolved.metadata, path: `${resolved.path}/rules/lists` };
  }

  async listLists(target: InventoryTarget, options: ListInventoryListsOptions = {}): Promise<ListInventoryListsResult> {
    const resolved = this.listTarget(target);
    const parsed = z.object({
      name: z.string().trim().min(1).optional(), kind: InventoryListKindSchema.optional(),
      page: z.number().int().positive().safe().default(1), perPage: z.number().int().min(1).max(500).default(100), all: z.boolean().default(false),
    }).safeParse(options);
    if (!parsed.success || (parsed.data.all && parsed.data.page > 1)) throw new CloudflareError("List filters require a nonempty name and kind ip|redirect|hostname|asn; page must be a positive integer, perPage 1-500, and all cannot start after page 1.", "CONFIG_ERROR");
    const result = await this.read(resolved.path, z.array(InventoryListSchema));
    this.complete(resolved.path, result.info, result.result.length);
    const matches = result.result.filter((list) => (parsed.data.kind === undefined || list.kind === parsed.data.kind) && (parsed.data.name === undefined || list.name === parsed.data.name));
    const page = parsed.data.page;
    const perPage = parsed.data.all ? Math.max(1, matches.length) : parsed.data.perPage;
    const offset = (page - 1) * perPage;
    const lists = matches.slice(offset, offset + perPage);
    return this.redact({ ...resolved.metadata, lists, resultInfo: { page, per_page: perPage, count: lists.length, total_count: matches.length, total_pages: Math.max(1, Math.ceil(matches.length / perPage)) }, truncated: offset + lists.length < matches.length });
  }

  private async listDetail(id: string, target: InventoryTarget): Promise<GetInventoryListResult> {
    const resolved = this.listTarget(target);
    this.segment(id, "List ID");
    const path = `${resolved.path}/${encodeURIComponent(id)}`;
    const result = await this.read(path, InventoryListSchema);
    this.complete(path, result.info, 1);
    if (result.result.id !== id) throw this.malformed(path, "response list ID does not match the requested list");
    return { ...resolved.metadata, list: result.result };
  }

  async getList(id: string, target: InventoryTarget): Promise<GetInventoryListResult> {
    return this.redact(await this.listDetail(id, target));
  }

  async listListItems(id: string, target: InventoryTarget, options: ListInventoryListItemsOptions = {}): Promise<ListInventoryListItemsResult> {
    // Validate before metadata HTTP, so an invalid option never performs a read.
    const parsed = z.object({
      cursor: z.string().min(1).optional(), search: z.string().min(1).optional(),
      perPage: z.number().int().min(1).max(500).default(100), all: z.boolean().default(false),
    }).safeParse(options);
    if (!parsed.success) throw new CloudflareError("List item cursor/search must not be empty and perPage must be an integer from 1 to 500.", "CONFIG_ERROR");
    const detail = await this.listDetail(id, target);
    const path = `/client/v4/accounts/${encodeURIComponent(detail.accountId)}/rules/lists/${encodeURIComponent(id)}/items`;
    const schemas = { ip: InventoryListIPItemSchema, redirect: InventoryListRedirectItemSchema, hostname: InventoryListHostnameItemSchema, asn: InventoryListASNItemSchema };
    const items: InventoryListItem[] = [];
    const seen = new Set<string>();
    let cursor = parsed.data.cursor;
    if (cursor) seen.add(cursor);
    for (;;) {
      const page = await this.read(path, z.array(schemas[detail.list.kind]), { cursor, per_page: parsed.data.perPage, search: parsed.data.search });
      items.push(...page.result);
      const after = page.info.cursors?.after;
      if (after && seen.has(after)) throw this.malformed(path, "API repeated a pagination cursor");
      const incomplete = Boolean(after || page.info.truncated || page.info.has_more ||
        (parsed.data.cursor === undefined && page.info.total_count !== undefined && page.info.total_count > items.length) ||
        ((parsed.data.cursor === undefined || page.info.page !== undefined) && page.info.total_pages !== undefined && page.info.total_pages > (page.info.page ?? 1)) ||
        (page.info.count !== undefined && page.info.count > page.result.length));
      if (incomplete && !after) throw this.malformed(path, "API reports more list items without a continuation cursor");
      if (!parsed.data.all && after && (!after.trim() || this.text(after) !== after)) {
        throw this.malformed(path, "continuation cursor cannot be safely reused; retry without --cursor and use --all to collect items internally");
      }
      if (!parsed.data.all || !after) {
        if (!incomplete && parsed.data.cursor === undefined && parsed.data.search === undefined && items.length !== detail.list.num_items) {
          throw this.malformed(path, "item count differs from list metadata; inventory is incomplete or the list changed during collection");
        }
        return this.redact({ ...detail, items, resultInfo: page.info, truncated: incomplete });
      }
      seen.add(after!);
      cursor = after;
    }
  }

  async listRulesets(target: InventoryTarget, options: ListInventoryRulesetsOptions = {}): Promise<ListInventoryRulesetsResult> {
    const resolved = this.target(target);
    const parsedOptions = z.object({ cursor: z.string().trim().min(1).optional(), perPage: z.number().int().min(1).max(50).default(50), all: z.boolean().default(false) }).safeParse(options);
    if (!parsedOptions.success) throw new CloudflareError("Ruleset cursor must not be empty and perPage must be an integer from 1 to 50.", "CONFIG_ERROR");
    const path = `${resolved.path}/rulesets`;
    const rulesets: InventoryRulesetMetadata[] = [];
    const seen = new Set<string>();
    let cursor = parsedOptions.data.cursor;
    if (cursor) seen.add(cursor);
    for (;;) {
      const page = await this.read(path, z.array(InventoryRulesetMetadataSchema), { cursor, per_page: parsedOptions.data.perPage });
      rulesets.push(...page.result);
      const after = page.info.cursors?.after;
      if (after && seen.has(after)) throw this.malformed(path, "API repeated a pagination cursor");
      if (!parsedOptions.data.all || !after) {
        const incomplete = Boolean(after || page.info.truncated || page.info.has_more ||
          (page.info.total_count !== undefined && page.info.total_count > rulesets.length) ||
          (page.info.total_pages !== undefined && page.info.total_pages > (page.info.page ?? 1)) ||
          (page.info.count !== undefined && page.info.count > page.result.length));
        if (parsedOptions.data.all && incomplete) throw this.malformed(path, "API reports more rulesets without a continuation cursor");
        return this.redact({ ...resolved.metadata, rulesets, resultInfo: page.info as InventoryCursorResultInfo, truncated: incomplete });
      }
      seen.add(after);
      cursor = after;
    }
  }

  async getRuleset(id: string, target: InventoryTarget, version?: string): Promise<GetInventoryRulesetResult> {
    const resolved = this.target(target);
    const rulesetId = encodeURIComponent(this.segment(id, "Ruleset ID"));
    const suffix = version === undefined ? "" : `/versions/${encodeURIComponent(this.segment(version, "Ruleset version"))}`;
    const path = `${resolved.path}/rulesets/${rulesetId}${suffix}`;
    const result = await this.read(path, InventoryRulesetSchema);
    this.complete(path, result.info, result.result.rules.length);
    return this.redact({ ...resolved.metadata, ruleset: this.ruleset(result.result) });
  }

  async getPhaseEntrypoint(phase: string, target: InventoryTarget): Promise<GetInventoryPhaseEntrypointResult> {
    const resolved = this.target(target);
    this.segment(phase, "Ruleset phase");
    const path = `${resolved.path}/rulesets/phases/${encodeURIComponent(phase)}/entrypoint`;
    try {
      const result = await this.read(path, InventoryRulesetSchema);
      this.complete(path, result.info, result.result.rules.length);
      return this.redact({ ...resolved.metadata, phase, status: "present" as const, ruleset: this.ruleset(result.result) });
    } catch (error) {
      // Only the phase-entrypoint endpoint documents 404 as an absent entrypoint.
      if (!(error instanceof CloudflareError) || error.statusCode !== 404 || !error.apiResponse ||
        /entitl|permission|forbid|unauthor|access deni|not allow|plan restrict/iu.test(error.message) ||
        !/entry[ _-]?point|\bphase\b/iu.test(error.message) ||
        /\b(?:zone|account)\b[^.:\n]*(?:not[ _-]*found|does not exist)/iu.test(error.message) ||
        !/not[ _-]*found|does not exist|could not (?:be )?find|could not be found|no (?:phase )?entrypoint|entrypoint (?:missing|absent)/iu.test(error.message)) throw error;
      return this.redact({ ...resolved.metadata, phase, status: "absent" as const, diagnostic: { statusCode: 404 as const, code: error.code, message: error.message } });
    }
  }

  async getZoneSetting(id: string, zoneId?: string): Promise<GetInventoryZoneSettingResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/settings/${encodeURIComponent(this.segment(id, "Setting ID"))}`;
    const result = await this.read(path, InventoryZoneSettingSchema);
    this.complete(path, result.info, 1);
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, setting: result.result });
  }

  async getBotManagement(zoneId?: string): Promise<GetInventoryBotManagementResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/bot_management`;
    const result = await this.read(path, InventoryBotManagementSchema);
    this.complete(path, result.info, 1);
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, settings: result.result });
  }

  async listWorkerRoutes(zoneId?: string): Promise<ListInventoryWorkerRoutesResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/workers/routes`;
    const result = await this.read(path, z.array(InventoryWorkerRouteSchema));
    this.complete(path, result.info, result.result.length);
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, routes: result.result });
  }

  async listWorkerDomains(options: ListInventoryWorkerDomainsOptions = {}): Promise<ListInventoryWorkerDomainsResult> {
    const accountId = this.account(options.accountId);
    const zoneId = options.zoneId === undefined ? undefined : this.segment(options.zoneId, "Zone filter ID");
    const path = `/client/v4/accounts/${encodeURIComponent(accountId)}/workers/domains`;
    const result = await this.read(path, z.array(InventoryWorkerDomainSchema), zoneId === undefined ? undefined : { zone_id: zoneId });
    this.complete(path, result.info, result.result.length);
    return this.redact({ scope: "account", accountId, ...(zoneId === undefined ? {} : { zoneId }), domains: result.result });
  }

  async listPageRules(zoneId?: string): Promise<ListInventoryPageRulesResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/pagerules`;
    const result = await this.read(path, z.array(InventoryPageRuleSchema), { order: "priority", direction: "desc" });
    this.complete(path, result.info, result.result.length);
    const rules = [...result.result].sort((left, right) => right.priority - left.priority).map((rule, index) => ({ ...rule, order: index + 1 }));
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, rules });
  }

  async getManagedTransforms(zoneId?: string): Promise<GetInventoryManagedTransformsResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/managed_headers`;
    const result = await this.read(path, InventoryManagedTransformsSchema);
    this.complete(path, result.info, 1);
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, settings: result.result });
  }

  async getUrlNormalization(zoneId?: string): Promise<GetInventoryUrlNormalizationResult> {
    const resolvedZoneId = this.zone(zoneId);
    const path = `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}/url_normalization`;
    const result = await this.read(path, InventoryUrlNormalizationSchema);
    this.complete(path, result.info, 1);
    return this.redact({ scope: "zone", zoneId: resolvedZoneId, settings: result.result });
  }
}
