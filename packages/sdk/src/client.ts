import type {
  AuditLogListResult,
  AvailableLogExplorerDataset,
  CloudflareAuth,
  CloudflareConfig,
  CreateCustomHostnameParams,
  CreateFirewallRuleParams,
  CreateRedirectRuleParams,
  CustomHostname,
  DeleteLogExplorerDatasetParams,
  DnsRecord,
  EnableLogExplorerDatasetParams,
  FirewallRule,
  GetLogExplorerDatasetParams,
  ListAuditLogsParams,
  ListAvailableLogExplorerDatasetsParams,
  ListCustomHostnamesParams,
  ListCustomHostnamesResult,
  ListDnsRecordsResult,
  ListDnsRecordsParams,
  ListFirewallRulesParams,
  ListFirewallRulesResult,
  ListLogExplorerDatasetsParams,
  ListRedirectRulesResult,
  ListZonesParams,
  ListZonesResult,
  LogExplorerDataset,
  LogExplorerScope,
  PurgeCacheResult,
  QueryLogExplorerParams,
  QueryLogExplorerResult,
  RedirectRule,
  Resource,
  ListResourcesParams,
  CreateResourceParams,
  PaginatedResponse,
  Ruleset,
  UpdateCustomHostnameParams,
  UpdateDnsRecordParams,
  UpdateFirewallRuleParams,
  UpdateLogExplorerDatasetParams,
  UpdateRedirectRuleParams,
  TokenVerificationResult,
  Zone,
  ZoneNameFilterOperator,
  ZoneVanityNameServers,
} from "./types.js";
import {
  AuditLogSchema,
  AuditLogListResultSchema,
  AuditLogPaginationSchema,
  AvailableLogExplorerDatasetSchema,
  CloudflareResponseSchema,
  CloudflareConfigSchema,
  CreateCustomHostnameParamsSchema,
  CreateFirewallRuleParamsSchema,
  CreateRedirectRuleParamsSchema,
  CustomHostnameSchema,
  DnsRecordResultInfoSchema,
  DnsRecordSchema,
  DeleteLogExplorerDatasetParamsSchema,
  EnableLogExplorerDatasetParamsSchema,
  FirewallRuleSchema,
  GetLogExplorerDatasetParamsSchema,
  ListAuditLogsParamsSchema,
  ListAvailableLogExplorerDatasetsParamsSchema,
  ListCustomHostnamesParamsSchema,
  ListDnsRecordsParamsSchema,
  ListFirewallRulesParamsSchema,
  ListLogExplorerDatasetsParamsSchema,
  ListZonesParamsSchema,
  LogExplorerDatasetSchema,
  LogExplorerRowSchema,
  ResultInfoSchema,
  PurgeCacheResultSchema,
  QueryLogExplorerParamsSchema,
  REDIRECT_RULE_PHASE,
  RedirectRuleSchema,
  ResourceSchema,
  PaginatedResponseSchema,
  ErrorResponseSchema,
  RulesetSchema,
  SetZoneVanityNameServersParamsSchema,
  UpdateCustomHostnameParamsSchema,
  UpdateDnsRecordParamsSchema,
  UpdateFirewallRuleParamsSchema,
  UpdateLogExplorerDatasetParamsSchema,
  UpdateRedirectRuleParamsSchema,
  TokenVerificationResultSchema,
  VanityNameServerIpsSchema,
  ZoneSchema,
} from "./types.js";
import {
  CloudflareError,
  CloudflareAuthError,
  CloudflareNotFoundError,
} from "./errors.js";
import { z } from "zod";

type QueryValue = string | number | boolean | undefined;

interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

interface RoutePermissionHint {
  readonly method: string;
  readonly pathPattern: RegExp;
  readonly requiredPermissions: readonly string[];
  readonly docsUrl: string;
}

const ROUTE_PERMISSION_HINTS: readonly RoutePermissionHint[] = [
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/accounts\/[^/]+\/logs\/audit$/u,
    requiredPermissions: ["Account Settings Read", "Account Settings Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones$/u,
    requiredPermissions: ["Zone Read"],
    docsUrl: "https://developers.cloudflare.com/api/resources/zones/methods/list/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+$/u,
    requiredPermissions: ["Zone Read"],
    docsUrl: "https://developers.cloudflare.com/api/resources/zones/methods/get/",
  },
  {
    method: "PATCH",
    pathPattern: /^\/client\/v4\/zones\/[^/]+$/u,
    requiredPermissions: ["Zone Write"],
    docsUrl: "https://developers.cloudflare.com/api/resources/zones/methods/edit/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/dns_records$/u,
    requiredPermissions: ["DNS Read", "DNS Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/",
  },
  {
    method: "PATCH",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/dns_records\/[^/]+$/u,
    requiredPermissions: ["DNS Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/custom_hostnames$/u,
    requiredPermissions: ["SSL and Certificates Read", "SSL and Certificates Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/custom_hostnames/methods/list/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/custom_hostnames\/[^/]+$/u,
    requiredPermissions: ["SSL and Certificates Read", "SSL and Certificates Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/",
  },
  {
    method: "POST",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/purge_cache$/u,
    requiredPermissions: ["Cache Purge"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/cache/methods/purge/",
  },
  {
    method: "POST",
    pathPattern:
      /^\/client\/v4\/(accounts|zones)\/[^/]+\/logs\/explorer\/query\/sql$/u,
    requiredPermissions: ["Logs Read"],
    docsUrl: "https://developers.cloudflare.com/log-explorer/api/",
  },
  {
    method: "POST",
    pathPattern: /^\/client\/v4\/(accounts|zones)\/[^/]+\/logs\/explorer\/datasets$/u,
    requiredPermissions: ["Logs Edit"],
    docsUrl: "https://developers.cloudflare.com/log-explorer/manage-datasets/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/(accounts|zones)\/[^/]+\/logs\/explorer\/datasets(\/[^/]+)?$/u,
    requiredPermissions: ["Logs Read"],
    docsUrl: "https://developers.cloudflare.com/log-explorer/manage-datasets/",
  },
  {
    method: "PUT",
    pathPattern: /^\/client\/v4\/(accounts|zones)\/[^/]+\/logs\/explorer\/datasets\/[^/]+$/u,
    requiredPermissions: ["Logs Edit"],
    docsUrl: "https://developers.cloudflare.com/log-explorer/manage-datasets/",
  },
  {
    method: "DELETE",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/custom_hostnames\/[^/]+$/u,
    requiredPermissions: ["SSL and Certificates Write"],
    docsUrl: "https://developers.cloudflare.com/api/resources/custom_hostnames/methods/delete/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/firewall\/rules$/u,
    requiredPermissions: ["Firewall Services Read", "Firewall Services Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/firewall/subresources/rules/methods/list/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/firewall\/rules\/[^/]+$/u,
    requiredPermissions: ["Firewall Services Read", "Firewall Services Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/firewall/subresources/rules/methods/get/",
  },
  {
    method: "POST",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/firewall\/rules$/u,
    requiredPermissions: ["Firewall Services Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/firewall/subresources/rules/methods/create/",
  },
  {
    method: "PUT",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/firewall\/rules\/[^/]+$/u,
    requiredPermissions: ["Firewall Services Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/firewall/subresources/rules/methods/edit/",
  },
  {
    method: "DELETE",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/firewall\/rules\/[^/]+$/u,
    requiredPermissions: ["Firewall Services Write"],
    docsUrl:
      "https://developers.cloudflare.com/api/resources/firewall/subresources/rules/methods/delete/",
  },
  {
    method: "GET",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/rulesets(\/|\?|$)/u,
    requiredPermissions: ["Rulesets Read", "Rulesets Edit"],
    docsUrl: "https://developers.cloudflare.com/rules/redirect-rules/",
  },
  {
    method: "POST",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/rulesets/u,
    requiredPermissions: ["Rulesets Edit"],
    docsUrl: "https://developers.cloudflare.com/rules/redirect-rules/",
  },
  {
    method: "PUT",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/rulesets/u,
    requiredPermissions: ["Rulesets Edit"],
    docsUrl: "https://developers.cloudflare.com/rules/redirect-rules/",
  },
  {
    method: "PATCH",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/rulesets/u,
    requiredPermissions: ["Rulesets Edit"],
    docsUrl: "https://developers.cloudflare.com/rules/redirect-rules/",
  },
  {
    method: "DELETE",
    pathPattern: /^\/client\/v4\/zones\/[^/]+\/rulesets/u,
    requiredPermissions: ["Rulesets Edit"],
    docsUrl: "https://developers.cloudflare.com/rules/redirect-rules/",
  },
];

export class CloudflareClient {
  private readonly config: CloudflareConfig;

  constructor(config: CloudflareConfig) {
    this.config = CloudflareConfigSchema.parse(config);
  }

  getAuthType(): CloudflareAuth["type"] {
    return this.config.auth.type;
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.config.baseUrl}${path}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private parseCloudflareError(
    body: unknown,
    fallbackMessage: string
  ): { message: string; code: string } {
    const cloudflare = CloudflareResponseSchema(z.unknown()).safeParse(body);
    if (cloudflare.success && cloudflare.data.errors.length > 0) {
      const first = cloudflare.data.errors[0];
      return {
        message: first?.message ?? fallbackMessage,
        code: String(first?.code ?? "UNKNOWN"),
      };
    }

    const legacy = ErrorResponseSchema.safeParse(body);
    if (legacy.success) {
      return {
        message: legacy.data.error.message,
        code: legacy.data.error.code,
      };
    }

    return {
      message: fallbackMessage,
      code: "UNKNOWN",
    };
  }

  private findRoutePermissionHint(
    method: string,
    path: string
  ): RoutePermissionHint | undefined {
    return ROUTE_PERMISSION_HINTS.find(
      (hint) => hint.method === method && hint.pathPattern.test(path)
    );
  }

  private getAuthHeaders(): Record<string, string> {
    if (this.config.auth.type === "apiToken") {
      return {
        Authorization: `Bearer ${this.config.auth.token}`,
      };
    }

    return {
      "X-Auth-Key": this.config.auth.apiKey,
      "X-Auth-Email": this.config.auth.email,
    };
  }

  private async requestRaw<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);

    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeaders(),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (res.status === 204) {
      return undefined as T;
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const parsedError = this.parseCloudflareError(body, `HTTP ${res.status}`);
      const permissionHint = this.findRoutePermissionHint(method, path);
      const errorOptions = {
        requiredPermissions: permissionHint?.requiredPermissions,
        docsUrl: permissionHint?.docsUrl,
        requestMethod: method,
        requestPath: path,
      };

      if (res.status === 401) {
        throw new CloudflareAuthError(parsedError.message, errorOptions);
      }

      throw new CloudflareError(
        parsedError.message,
        parsedError.code,
        res.status,
        errorOptions
      );
    }

    return body as T;
  }

  private async requestResult<T>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const body = await this.requestRaw<unknown>(method, path, options);
    const parsed = CloudflareResponseSchema(z.unknown()).safeParse(body);

    if (!parsed.success) {
      return body as T;
    }

    if (!parsed.data.success) {
      const first = parsed.data.errors[0];
      throw new CloudflareError(
        first?.message ?? "Cloudflare API request failed",
        String(first?.code ?? "API_ERROR")
      );
    }

    return parsed.data.result as T;
  }

  private resolveAccountId(accountId?: string): string {
    const resolved = accountId ?? this.config.accountId;
    if (resolved) return resolved;

    throw new CloudflareError(
      "Account ID is required. Provide accountId or set CLOUDFLARE_ACCOUNT_ID.",
      "CONFIG_ERROR"
    );
  }

  private resolveZoneId(zoneId?: string): string {
    const resolved = zoneId ?? this.config.zoneId;
    if (resolved) return resolved;

    throw new CloudflareError(
      "Zone ID is required. Provide zoneId or set CLOUDFLARE_ZONE_ID.",
      "CONFIG_ERROR"
    );
  }

  // -------------------------------------------------------------------------
  // Audit logs
  // -------------------------------------------------------------------------

  async listAuditLogs(
    params: ListAuditLogsParams = {},
    accountId?: string
  ): Promise<AuditLogListResult> {
    const parsedParams = ListAuditLogsParamsSchema.parse(params);
    const resolvedAccountId = this.resolveAccountId(accountId);

    const responseBody = await this.requestRaw<unknown>(
      "GET",
      `/client/v4/accounts/${resolvedAccountId}/logs/audit`,
      {
        query: {
          since: parsedParams.since,
          before: parsedParams.before,
          cursor: parsedParams.cursor,
          direction: parsedParams.direction,
          limit: parsedParams.limit,
          id: parsedParams.id,
          interface: parsedParams.interface,
          actor_id: parsedParams.actorId,
          actor_email: parsedParams.actorEmail,
          actor_ip: parsedParams.actorIp,
          actor_token_id: parsedParams.actorTokenId,
          actor_token_name: parsedParams.actorTokenName,
          actor_token_type: parsedParams.actorTokenType,
          actor_user_email: parsedParams.actorUserEmail,
          actor_user_id: parsedParams.actorUserId,
          action_type: parsedParams.actionType,
          action_result: parsedParams.actionResult,
          "resource.type": parsedParams.resourceType,
          zone_name: parsedParams.zoneName,
        },
      }
    );

    const wrapped = CloudflareResponseSchema(z.unknown()).safeParse(responseBody);
    if (wrapped.success) {
      if (!wrapped.data.success) {
        const first = wrapped.data.errors[0];
        throw new CloudflareError(
          first?.message ?? "Audit logs request failed",
          String(first?.code ?? "API_ERROR")
        );
      }

      const resultPayload = wrapped.data.result;
      if (resultPayload === null) {
        const parsedPagination = AuditLogPaginationSchema.safeParse(
          wrapped.data.result_info
        );
        return {
          data: [],
          pagination: parsedPagination.success ? parsedPagination.data : undefined,
        };
      }
      if (Array.isArray(resultPayload)) {
        const parsedData = z.array(AuditLogSchema).parse(resultPayload);
        const parsedPagination = AuditLogPaginationSchema.safeParse(
          wrapped.data.result_info
        );
        return {
          data: parsedData,
          pagination: parsedPagination.success ? parsedPagination.data : undefined,
        };
      }

      return AuditLogListResultSchema.parse(resultPayload);
    }

    if (Array.isArray(responseBody)) {
      const parsedData = z.array(AuditLogSchema).parse(responseBody);
      return {
        data: parsedData,
      };
    }

    return AuditLogListResultSchema.parse(responseBody);
  }

  async verifyToken(): Promise<TokenVerificationResult> {
    if (this.config.auth.type !== "apiToken") {
      throw new CloudflareError(
        "Token verification is only available when using CLOUDFLARE_API_TOKEN auth.",
        "UNSUPPORTED_AUTH"
      );
    }

    const result = await this.requestResult<TokenVerificationResult>(
      "GET",
      "/client/v4/user/tokens/verify"
    );
    return TokenVerificationResultSchema.parse(result);
  }

  // -------------------------------------------------------------------------
  // Zones
  // -------------------------------------------------------------------------

  private buildZoneNameFilter(
    value: string | undefined,
    operator: ZoneNameFilterOperator | undefined
  ): string | undefined {
    if (value === undefined) return undefined;
    if (operator === undefined || operator === "equal") return value;
    return `${operator}:${value}`;
  }

  async listZones(params: ListZonesParams = {}): Promise<ListZonesResult> {
    const parsedParams = ListZonesParamsSchema.parse(params);

    const body = await this.requestRaw<unknown>("GET", "/client/v4/zones", {
      query: {
        name: this.buildZoneNameFilter(parsedParams.name, parsedParams.nameOperator),
        "account.id": parsedParams.accountId,
        "account.name": this.buildZoneNameFilter(
          parsedParams.accountName,
          parsedParams.accountNameOperator
        ),
        status: parsedParams.status,
        type: parsedParams.type?.join(","),
        match: parsedParams.match,
        order: parsedParams.order,
        direction: parsedParams.direction,
        page: parsedParams.page,
        per_page: parsedParams.perPage,
      },
    });

    const parsedResponse = CloudflareResponseSchema(z.array(ZoneSchema)).safeParse(body);
    if (!parsedResponse.success) {
      throw new CloudflareError("Unexpected zones response shape", "INVALID_RESPONSE");
    }

    if (!parsedResponse.data.success) {
      const first = parsedResponse.data.errors[0];
      throw new CloudflareError(
        first?.message ?? "Zones request failed",
        String(first?.code ?? "API_ERROR")
      );
    }

    const info = ResultInfoSchema.safeParse(parsedResponse.data.result_info);

    return {
      zones: parsedResponse.data.result,
      resultInfo: info.success ? info.data : undefined,
    };
  }

  async getZone(zoneId?: string): Promise<Zone> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const result = await this.requestResult<unknown>(
      "GET",
      `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}`
    );

    return ZoneSchema.parse(result);
  }

  // -------------------------------------------------------------------------
  // Zone custom (vanity) nameservers
  // -------------------------------------------------------------------------

  private toZoneVanityNameServers(zone: Zone): ZoneVanityNameServers {
    const nameServers = zone.vanity_name_servers ?? [];
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      enabled: nameServers.length > 0,
      nameServers,
      ips: VanityNameServerIpsSchema.parse(zone["vanity_name_servers_ips"]) ?? [],
      assignedNameServers: zone.name_servers ?? [],
    };
  }

  /**
   * Read a zone's custom (vanity) nameservers plus the glue-record addresses
   * Cloudflare assigned to them.
   */
  async getZoneVanityNameServers(zoneId?: string): Promise<ZoneVanityNameServers> {
    return this.toZoneVanityNameServers(await this.getZone(zoneId));
  }

  /**
   * Replace a zone's custom (vanity) nameservers. Every name must be a
   * subdomain of the zone, and the zone must be on a Business or Enterprise
   * plan. Passing an empty array removes them — prefer
   * {@link clearZoneVanityNameServers} for that.
   *
   * @see https://developers.cloudflare.com/dns/nameservers/custom-nameservers/zone-custom-nameservers/
   */
  async setZoneVanityNameServers(
    nameServers: string[],
    zoneId?: string
  ): Promise<ZoneVanityNameServers> {
    const parsed = SetZoneVanityNameServersParamsSchema.parse({ nameServers });
    const resolvedZoneId = this.resolveZoneId(zoneId);

    // The Edit Zone endpoint only accepts one zone property per request.
    const result = await this.requestResult<unknown>(
      "PATCH",
      `/client/v4/zones/${encodeURIComponent(resolvedZoneId)}`,
      { body: { vanity_name_servers: parsed.nameServers } }
    );

    return this.toZoneVanityNameServers(ZoneSchema.parse(result));
  }

  /**
   * Remove a zone's custom nameservers and the read-only A/AAAA records
   * Cloudflare created for them.
   */
  async clearZoneVanityNameServers(zoneId?: string): Promise<ZoneVanityNameServers> {
    return this.setZoneVanityNameServers([], zoneId);
  }

  // -------------------------------------------------------------------------
  // DNS records
  // -------------------------------------------------------------------------

  async listDnsRecords(
    zoneId: string,
    params: ListDnsRecordsParams = {}
  ): Promise<ListDnsRecordsResult> {
    const parsedParams = ListDnsRecordsParamsSchema.parse(params);
    const body = await this.requestRaw<unknown>(
      "GET",
      `/client/v4/zones/${zoneId}/dns_records`,
      {
        query: {
          type: parsedParams.type,
          name: parsedParams.name,
          content: parsedParams.content,
          proxied: parsedParams.proxied,
          search: parsedParams.search,
          order: parsedParams.order,
          direction: parsedParams.direction,
          match: parsedParams.match,
          page: parsedParams.page,
          per_page: parsedParams.perPage,
        },
      }
    );

    const parsedResponse = CloudflareResponseSchema(z.array(DnsRecordSchema)).safeParse(body);
    if (!parsedResponse.success) {
      throw new CloudflareError("Unexpected DNS records response shape", "INVALID_RESPONSE");
    }

    if (!parsedResponse.data.success) {
      const first = parsedResponse.data.errors[0];
      throw new CloudflareError(
        first?.message ?? "DNS records request failed",
        String(first?.code ?? "API_ERROR")
      );
    }

    const info = DnsRecordResultInfoSchema.safeParse(parsedResponse.data.result_info);

    return {
      records: parsedResponse.data.result,
      resultInfo: info.success ? info.data : undefined,
    };
  }

  async updateDnsRecord(
    zoneId: string,
    recordId: string,
    params: UpdateDnsRecordParams
  ): Promise<DnsRecord> {
    const parsedParams = UpdateDnsRecordParamsSchema.parse(params);
    const updated = await this.requestResult<DnsRecord>(
      "PATCH",
      `/client/v4/zones/${zoneId}/dns_records/${recordId}`,
      {
        body: parsedParams,
      }
    );

    return DnsRecordSchema.parse(updated);
  }

  // -------------------------------------------------------------------------
  // Custom hostnames (SSL for SaaS)
  // -------------------------------------------------------------------------

  async listCustomHostnames(
    params: ListCustomHostnamesParams = {},
    zoneId?: string
  ): Promise<ListCustomHostnamesResult> {
    const parsedParams = ListCustomHostnamesParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const body = await this.requestRaw<unknown>(
      "GET",
      `/client/v4/zones/${resolvedZoneId}/custom_hostnames`,
      {
        query: {
          hostname: parsedParams.hostname,
          id: parsedParams.id,
          ssl:
            parsedParams.ssl === undefined ? undefined : parsedParams.ssl ? 1 : 0,
          order: parsedParams.order,
          direction: parsedParams.direction,
          page: parsedParams.page,
          per_page: parsedParams.perPage,
        },
      }
    );

    const parsedResponse = CloudflareResponseSchema(
      z.array(CustomHostnameSchema)
    ).safeParse(body);
    if (!parsedResponse.success) {
      throw new CloudflareError(
        "Unexpected custom hostnames response shape",
        "INVALID_RESPONSE"
      );
    }

    if (!parsedResponse.data.success) {
      const first = parsedResponse.data.errors[0];
      throw new CloudflareError(
        first?.message ?? "Custom hostnames request failed",
        String(first?.code ?? "API_ERROR")
      );
    }

    const info = ResultInfoSchema.safeParse(parsedResponse.data.result_info);

    return {
      hostnames: parsedResponse.data.result,
      resultInfo: info.success ? info.data : undefined,
    };
  }

  async getCustomHostname(
    customHostnameId: string,
    zoneId?: string
  ): Promise<CustomHostname> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const result = await this.requestResult<unknown>(
      "GET",
      `/client/v4/zones/${resolvedZoneId}/custom_hostnames/${encodeURIComponent(customHostnameId)}`
    );

    return CustomHostnameSchema.parse(result);
  }

  async createCustomHostname(
    params: CreateCustomHostnameParams,
    zoneId?: string
  ): Promise<CustomHostname> {
    const parsed = CreateCustomHostnameParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const result = await this.requestResult<unknown>(
      "POST",
      `/client/v4/zones/${resolvedZoneId}/custom_hostnames`,
      { body: parsed }
    );

    return CustomHostnameSchema.parse(result);
  }

  async updateCustomHostname(
    customHostnameId: string,
    params: UpdateCustomHostnameParams,
    zoneId?: string
  ): Promise<CustomHostname> {
    const parsed = UpdateCustomHostnameParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const result = await this.requestResult<unknown>(
      "PATCH",
      `/client/v4/zones/${resolvedZoneId}/custom_hostnames/${encodeURIComponent(customHostnameId)}`,
      { body: parsed }
    );

    return CustomHostnameSchema.parse(result);
  }

  async deleteCustomHostname(
    customHostnameId: string,
    zoneId?: string
  ): Promise<void> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    await this.requestResult<unknown>(
      "DELETE",
      `/client/v4/zones/${resolvedZoneId}/custom_hostnames/${encodeURIComponent(customHostnameId)}`
    );
  }

  // -------------------------------------------------------------------------
  // Firewall (WAF) rules
  // -------------------------------------------------------------------------

  async listFirewallRules(
    params: ListFirewallRulesParams = {},
    zoneId?: string
  ): Promise<ListFirewallRulesResult> {
    const parsedParams = ListFirewallRulesParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const body = await this.requestRaw<unknown>(
      "GET",
      `/client/v4/zones/${resolvedZoneId}/firewall/rules`,
      {
        query: {
          id: parsedParams.id,
          action: parsedParams.action,
          description: parsedParams.description,
          paused: parsedParams.paused,
          page: parsedParams.page,
          per_page: parsedParams.perPage,
        },
      }
    );

    const parsedResponse = CloudflareResponseSchema(
      z.array(FirewallRuleSchema)
    ).safeParse(body);
    if (!parsedResponse.success) {
      throw new CloudflareError(
        "Unexpected firewall rules response shape",
        "INVALID_RESPONSE"
      );
    }

    if (!parsedResponse.data.success) {
      const first = parsedResponse.data.errors[0];
      throw new CloudflareError(
        first?.message ?? "Firewall rules request failed",
        String(first?.code ?? "API_ERROR")
      );
    }

    const info = ResultInfoSchema.safeParse(parsedResponse.data.result_info);

    return {
      rules: parsedResponse.data.result,
      resultInfo: info.success ? info.data : undefined,
    };
  }

  async getFirewallRule(ruleId: string, zoneId?: string): Promise<FirewallRule> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const result = await this.requestResult<unknown>(
      "GET",
      `/client/v4/zones/${resolvedZoneId}/firewall/rules/${encodeURIComponent(ruleId)}`
    );

    return FirewallRuleSchema.parse(result);
  }

  async createFirewallRule(
    params: CreateFirewallRuleParams,
    zoneId?: string
  ): Promise<FirewallRule> {
    const parsed = CreateFirewallRuleParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const { expression, ...rule } = parsed;
    const result = await this.requestResult<unknown>(
      "POST",
      `/client/v4/zones/${resolvedZoneId}/firewall/rules`,
      { body: { ...rule, filter: { expression } } }
    );

    return FirewallRuleSchema.parse(result);
  }

  async updateFirewallRule(
    ruleId: string,
    params: UpdateFirewallRuleParams,
    zoneId?: string
  ): Promise<FirewallRule> {
    const parsed = UpdateFirewallRuleParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const { expression, ...rule } = parsed;
    const result = await this.requestResult<unknown>(
      "PUT",
      `/client/v4/zones/${resolvedZoneId}/firewall/rules/${encodeURIComponent(ruleId)}`,
      {
        body: {
          id: ruleId,
          ...rule,
          filter: { expression },
        },
      }
    );

    return FirewallRuleSchema.parse(result);
  }

  async deleteFirewallRule(ruleId: string, zoneId?: string): Promise<void> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    await this.requestResult<unknown>(
      "DELETE",
      `/client/v4/zones/${resolvedZoneId}/firewall/rules/${encodeURIComponent(ruleId)}`
    );
  }

  // -------------------------------------------------------------------------
  // Redirect rules (Rulesets Engine, http_request_dynamic_redirect phase)
  // -------------------------------------------------------------------------

  private async getRedirectEntrypoint(zoneId: string): Promise<Ruleset | undefined> {
    let result: unknown;
    try {
      result = await this.requestResult<unknown>(
        "GET",
        `/client/v4/zones/${zoneId}/rulesets/phases/${REDIRECT_RULE_PHASE}/entrypoint`
      );
    } catch (err) {
      if (err instanceof CloudflareError && err.statusCode === 404) return undefined;
      throw err;
    }

    if (result === null || result === undefined) return undefined;
    return RulesetSchema.parse(result);
  }

  private buildRedirectFromValue(
    params: {
      targetUrl?: string;
      targetExpression?: string;
      statusCode?: number;
      preserveQueryString?: boolean;
    },
    current?: RedirectRule
  ): { from_value: Record<string, unknown> } {
    const existing = current?.action_parameters?.from_value ?? {};
    const targetUrl =
      params.targetUrl !== undefined
        ? { value: params.targetUrl }
        : params.targetExpression !== undefined
          ? { expression: params.targetExpression }
          : existing.target_url;
    return {
      from_value: {
        ...existing,
        target_url: targetUrl,
        status_code: params.statusCode ?? existing.status_code,
        preserve_query_string:
          params.preserveQueryString ?? existing.preserve_query_string,
      },
    };
  }

  /** Accepts a rule or a full ruleset response and extracts the rule. */
  private extractRedirectRule(
    result: unknown,
    fallback: Record<string, unknown>,
    ruleId?: string
  ): RedirectRule {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const candidate = result as { rules?: unknown; id?: unknown };
      if (Array.isArray(candidate.rules)) {
        const rules = z.array(RedirectRuleSchema).parse(candidate.rules);
        const match =
          (ruleId !== undefined ? rules.find((rule) => rule.id === ruleId) : undefined) ??
          rules[rules.length - 1];
        if (match) return match;
      } else {
        return RedirectRuleSchema.parse(result);
      }
    }
    return RedirectRuleSchema.parse(fallback);
  }

  async listRedirectRules(zoneId?: string): Promise<ListRedirectRulesResult> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const ruleset = await this.getRedirectEntrypoint(resolvedZoneId);
    if (!ruleset) return { rules: [] };
    return { rulesetId: ruleset.id, rules: ruleset.rules ?? [] };
  }

  async getRedirectRule(ruleId: string, zoneId?: string): Promise<RedirectRule> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const { rules } = await this.listRedirectRules(resolvedZoneId);
    const match = rules.find((rule) => rule.id === ruleId);
    if (!match) {
      throw new CloudflareNotFoundError("Redirect rule", ruleId);
    }
    return match;
  }

  async createRedirectRule(
    params: CreateRedirectRuleParams,
    zoneId?: string
  ): Promise<RedirectRule> {
    const parsed = CreateRedirectRuleParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const rule: Record<string, unknown> = {
      action: "redirect",
      expression: parsed.expression,
      description: parsed.description,
      enabled: parsed.enabled ?? true,
      action_parameters: this.buildRedirectFromValue(parsed),
    };

    // If the phase has no entrypoint ruleset yet, create it with this rule.
    const entrypoint = await this.getRedirectEntrypoint(resolvedZoneId);
    if (!entrypoint) {
      const result = await this.requestResult<unknown>(
        "PUT",
        `/client/v4/zones/${resolvedZoneId}/rulesets/phases/${REDIRECT_RULE_PHASE}/entrypoint`,
        { body: { rules: [rule] } }
      );
      return this.extractRedirectRule(result, rule);
    }

    // dry_run validates without persisting; the API returns a null result.
    const result = await this.requestResult<unknown>(
      "POST",
      `/client/v4/zones/${resolvedZoneId}/rulesets/${entrypoint.id}/rules`,
      {
        query: { dry_run: parsed.dryRun },
        body: rule,
      }
    );
    return this.extractRedirectRule(result, rule);
  }

  async updateRedirectRule(
    ruleId: string,
    params: UpdateRedirectRuleParams,
    zoneId?: string
  ): Promise<RedirectRule> {
    const parsed = UpdateRedirectRuleParamsSchema.parse(params);
    const resolvedZoneId = this.resolveZoneId(zoneId);

    const { rulesetId, rules } = await this.listRedirectRules(resolvedZoneId);
    if (!rulesetId) {
      throw new CloudflareError(
        "No redirect rules exist yet. Create one with createRedirectRule first.",
        "NOT_FOUND"
      );
    }
    const current = rules.find((rule) => rule.id === ruleId);
    if (!current) {
      throw new CloudflareNotFoundError("Redirect rule", ruleId);
    }

    const body: Record<string, unknown> = {};
    if (parsed.expression !== undefined) body.expression = parsed.expression;
    if (parsed.description !== undefined) body.description = parsed.description;
    if (parsed.enabled !== undefined) body.enabled = parsed.enabled;

    const wantsActionChange =
      parsed.targetUrl !== undefined ||
      parsed.targetExpression !== undefined ||
      parsed.statusCode !== undefined ||
      parsed.preserveQueryString !== undefined;
    if (wantsActionChange) {
      body.action_parameters = this.buildRedirectFromValue(parsed, current);
    }

    const result = await this.requestResult<unknown>(
      "PATCH",
      `/client/v4/zones/${resolvedZoneId}/rulesets/${rulesetId}/rules/${encodeURIComponent(ruleId)}`,
      { body }
    );
    return this.extractRedirectRule(result, body, ruleId);
  }

  async deleteRedirectRule(ruleId: string, zoneId?: string): Promise<void> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const { rulesetId } = await this.listRedirectRules(resolvedZoneId);
    if (!rulesetId) {
      throw new CloudflareNotFoundError("Redirect rule", ruleId);
    }

    await this.requestResult<unknown>(
      "DELETE",
      `/client/v4/zones/${resolvedZoneId}/rulesets/${rulesetId}/rules/${encodeURIComponent(ruleId)}`
    );
  }

  // -------------------------------------------------------------------------
  // Cache purge
  // -------------------------------------------------------------------------

  private async purgeCache(
    body: Record<string, unknown>,
    zoneId?: string
  ): Promise<PurgeCacheResult> {
    const resolvedZoneId = this.resolveZoneId(zoneId);
    const result = await this.requestResult<PurgeCacheResult>(
      "POST",
      `/client/v4/zones/${resolvedZoneId}/purge_cache`,
      { body }
    );
    return PurgeCacheResultSchema.parse(result);
  }

  async purgeCacheEverything(zoneId?: string): Promise<PurgeCacheResult> {
    return this.purgeCache({ purge_everything: true }, zoneId);
  }

  async purgeCacheByUrls(
    files: string[],
    zoneId?: string
  ): Promise<PurgeCacheResult> {
    return this.purgeCache({ files }, zoneId);
  }

  async purgeCacheByTags(
    tags: string[],
    zoneId?: string
  ): Promise<PurgeCacheResult> {
    return this.purgeCache({ tags }, zoneId);
  }

  async purgeCacheByPrefixes(
    prefixes: string[],
    zoneId?: string
  ): Promise<PurgeCacheResult> {
    return this.purgeCache({ prefixes }, zoneId);
  }

  async purgeCacheByHosts(
    hosts: string[],
    zoneId?: string
  ): Promise<PurgeCacheResult> {
    return this.purgeCache({ hosts }, zoneId);
  }

  // -------------------------------------------------------------------------
  // Log Explorer
  // -------------------------------------------------------------------------

  private resolveLogExplorerBase(
    scope: LogExplorerScope | undefined,
    overrides: { accountId?: string; zoneId?: string }
  ): { base: string; scope: LogExplorerScope } {
    const accountId = overrides.accountId ?? this.config.accountId;
    const zoneId = overrides.zoneId ?? this.config.zoneId;

    if (scope === "account") {
      if (!accountId) {
        throw new CloudflareError(
          "Account scope requires accountId. Provide --account-id or set CLOUDFLARE_ACCOUNT_ID.",
          "CONFIG_ERROR"
        );
      }
      return { base: `/client/v4/accounts/${accountId}`, scope: "account" };
    }

    if (scope === "zone") {
      if (!zoneId) {
        throw new CloudflareError(
          "Zone scope requires zoneId. Provide --zone-id or set CLOUDFLARE_ZONE_ID.",
          "CONFIG_ERROR"
        );
      }
      return { base: `/client/v4/zones/${zoneId}`, scope: "zone" };
    }

    if (zoneId) {
      return { base: `/client/v4/zones/${zoneId}`, scope: "zone" };
    }
    if (accountId) {
      return { base: `/client/v4/accounts/${accountId}`, scope: "account" };
    }

    throw new CloudflareError(
      "Log Explorer requires either a zone or account ID. Set CLOUDFLARE_ZONE_ID or CLOUDFLARE_ACCOUNT_ID, or pass --zone-id / --account-id.",
      "CONFIG_ERROR"
    );
  }

  async queryLogExplorer(
    params: QueryLogExplorerParams,
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<QueryLogExplorerResult> {
    const parsed = QueryLogExplorerParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const rows = await this.requestResult<unknown>(
      "POST",
      `${base}/logs/explorer/query/sql`,
      { query: { query: parsed.sql } }
    );

    return {
      rows: z.array(LogExplorerRowSchema).parse(rows),
    };
  }

  async enableLogExplorerDataset(
    params: EnableLogExplorerDatasetParams,
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<LogExplorerDataset> {
    const parsed = EnableLogExplorerDatasetParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const result = await this.requestResult<unknown>(
      "POST",
      `${base}/logs/explorer/datasets`,
      { body: { dataset: parsed.dataset } }
    );

    return LogExplorerDatasetSchema.parse(result);
  }

  async listLogExplorerDatasets(
    params: ListLogExplorerDatasetsParams = {},
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<LogExplorerDataset[]> {
    const parsed = ListLogExplorerDatasetsParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const result = await this.requestResult<unknown>(
      "GET",
      `${base}/logs/explorer/datasets`,
      { query: { include_zones: parsed.includeZones } }
    );

    if (result === null || result === undefined) return [];
    return z.array(LogExplorerDatasetSchema).parse(result);
  }

  async getLogExplorerDataset(
    params: GetLogExplorerDatasetParams,
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<LogExplorerDataset> {
    const parsed = GetLogExplorerDatasetParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const result = await this.requestResult<unknown>(
      "GET",
      `${base}/logs/explorer/datasets/${encodeURIComponent(parsed.datasetId)}`
    );

    return LogExplorerDatasetSchema.parse(result);
  }

  async updateLogExplorerDataset(
    params: UpdateLogExplorerDatasetParams,
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<LogExplorerDataset> {
    const parsed = UpdateLogExplorerDatasetParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const result = await this.requestResult<unknown>(
      "PUT",
      `${base}/logs/explorer/datasets/${encodeURIComponent(parsed.datasetId)}`,
      {
        body: {
          enabled: parsed.enabled,
          deletion_protection: parsed.deletionProtection,
          fields: parsed.fields,
          filter: parsed.filter,
        },
      }
    );

    return LogExplorerDatasetSchema.parse(result);
  }

  async deleteLogExplorerDataset(
    params: DeleteLogExplorerDatasetParams,
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<void> {
    const parsed = DeleteLogExplorerDatasetParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    await this.requestResult<unknown>(
      "DELETE",
      `${base}/logs/explorer/datasets/${encodeURIComponent(parsed.datasetId)}`
    );
  }

  async listAvailableLogExplorerDatasets(
    params: ListAvailableLogExplorerDatasetsParams = {},
    overrides: { accountId?: string; zoneId?: string } = {}
  ): Promise<AvailableLogExplorerDataset[]> {
    const parsed = ListAvailableLogExplorerDatasetsParamsSchema.parse(params);
    const { base } = this.resolveLogExplorerBase(parsed.scope, overrides);

    const result = await this.requestResult<unknown>(
      "GET",
      `${base}/logs/explorer/datasets/available`
    );

    if (result === null || result === undefined) return [];
    return z.array(AvailableLogExplorerDatasetSchema).parse(result);
  }

  // -------------------------------------------------------------------------
  // Legacy scaffold resources
  // -------------------------------------------------------------------------

  async listResources(
    params: ListResourcesParams = { page: 1, limit: 20 }
  ): Promise<PaginatedResponse<Resource>> {
    const query = new URLSearchParams({
      page: String(params.page),
      limit: String(params.limit),
    });
    const result = await this.requestRaw<unknown>("GET", `/resources?${query}`);
    return PaginatedResponseSchema(ResourceSchema).parse(result);
  }

  async getResource(id: string): Promise<Resource> {
    const result = await this.requestRaw<unknown>("GET", `/resources/${id}`);
    return ResourceSchema.parse(result);
  }

  async createResource(params: CreateResourceParams): Promise<Resource> {
    const result = await this.requestRaw<unknown>("POST", "/resources", { body: params });
    return ResourceSchema.parse(result);
  }

  async deleteResource(id: string): Promise<void> {
    await this.requestRaw<void>("DELETE", `/resources/${id}`);
  }
}
