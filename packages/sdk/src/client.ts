import type {
  AuditLogListResult,
  CloudflareAuth,
  CloudflareConfig,
  DnsRecord,
  ListAuditLogsParams,
  ListDnsRecordsResult,
  ListDnsRecordsParams,
  Resource,
  ListResourcesParams,
  CreateResourceParams,
  PaginatedResponse,
  UpdateDnsRecordParams,
  TokenVerificationResult,
} from "./types.js";
import {
  AuditLogSchema,
  AuditLogListResultSchema,
  AuditLogPaginationSchema,
  CloudflareResponseSchema,
  CloudflareConfigSchema,
  DnsRecordResultInfoSchema,
  DnsRecordSchema,
  ListAuditLogsParamsSchema,
  ListDnsRecordsParamsSchema,
  ResourceSchema,
  PaginatedResponseSchema,
  ErrorResponseSchema,
  UpdateDnsRecordParamsSchema,
  TokenVerificationResultSchema,
} from "./types.js";
import { CloudflareError, CloudflareAuthError } from "./errors.js";
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
          "actor.id": parsedParams.actorId,
          "actor.email": parsedParams.actorEmail,
          "actor.ip": parsedParams.actorIp,
          "actor.token.id": parsedParams.actorTokenId,
          "actor.token.name": parsedParams.actorTokenName,
          "actor.token.type": parsedParams.actorTokenType,
          "actor.user.email": parsedParams.actorUserEmail,
          "actor.user.id": parsedParams.actorUserId,
          "action.type": parsedParams.actionType,
          "action.result": parsedParams.actionResult,
          "zone.name": parsedParams.zoneName,
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
