import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const CloudflareConfigSchema = z.object({
  auth: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("apiToken"),
      token: z.string().min(1, "API token is required"),
    }),
    z.object({
      type: z.literal("globalApiKey"),
      apiKey: z.string().min(1, "Global API key is required"),
      email: z.string().email("Global API key auth requires a valid email"),
    }),
  ]),
  baseUrl: z.string().url().default("https://api.cloudflare.com"),
  accountId: z.string().min(1).optional(),
  zoneId: z.string().min(1).optional(),
});

export type CloudflareConfig = z.infer<typeof CloudflareConfigSchema>;
export type CloudflareAuth = CloudflareConfig["auth"];

// ---------------------------------------------------------------------------
// Generic Cloudflare API response schemas
// ---------------------------------------------------------------------------

export const CloudflareApiMessageSchema = z
  .object({
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type CloudflareApiMessage = z.infer<typeof CloudflareApiMessageSchema>;

export const CloudflareApiErrorSchema = z.object({
  code: z.union([z.string(), z.number()]),
  message: z.string(),
});

export type CloudflareApiError = z.infer<typeof CloudflareApiErrorSchema>;

export const CloudflareResponseSchema = <T extends z.ZodTypeAny>(resultSchema: T) =>
  z
    .object({
      success: z.boolean(),
      errors: z.array(CloudflareApiErrorSchema).default([]),
      messages: z.array(CloudflareApiMessageSchema).default([]),
      result: resultSchema,
      result_info: z.unknown().optional(),
    })
    .passthrough();

export type CloudflareResponse<T> = {
  success: boolean;
  errors: CloudflareApiError[];
  messages: CloudflareApiMessage[];
  result: T;
  result_info?: unknown;
};

// ---------------------------------------------------------------------------
// Shared pagination metadata (Cloudflare `result_info`)
// ---------------------------------------------------------------------------

export const ResultInfoSchema = z
  .object({
    page: z.number().optional(),
    per_page: z.number().optional(),
    count: z.number().optional(),
    total_count: z.number().optional(),
    total_pages: z.number().optional(),
  })
  .passthrough();

export type ResultInfo = z.infer<typeof ResultInfoSchema>;

// ---------------------------------------------------------------------------
// Legacy scaffold resource schemas
// ---------------------------------------------------------------------------

export const ResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Resource = z.infer<typeof ResourceSchema>;

export const ListResourcesParamsSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
});

export type ListResourcesParams = z.infer<typeof ListResourcesParamsSchema>;

export const CreateResourceParamsSchema = z.object({
  name: z.string().min(1),
});

export type CreateResourceParams = z.infer<typeof CreateResourceParamsSchema>;

// ---------------------------------------------------------------------------
// Audit log schemas
// ---------------------------------------------------------------------------

export const AuditLogSchema = z
  .object({
    id: z.string(),
    when: z.string().optional(),
    action: z
      .object({
        type: z.string().optional(),
        result: z.string().optional(),
      })
      .passthrough()
      .optional(),
    actor: z
      .object({
        id: z.string().optional(),
        email: z.string().optional(),
      })
      .passthrough()
      .optional(),
    resource: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    zone: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AuditLog = z.infer<typeof AuditLogSchema>;

export const ListAuditLogsParamsSchema = z.object({
  since: z.string().optional(),
  before: z.string().optional(),
  cursor: z.string().optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(1000).optional(),
  id: z.string().optional(),
  interface: z.string().optional(),
  actorId: z.string().optional(),
  actorEmail: z.string().optional(),
  actorIp: z.string().optional(),
  actorTokenId: z.string().optional(),
  actorTokenName: z.string().optional(),
  actorTokenType: z.string().optional(),
  actorUserEmail: z.string().optional(),
  actorUserId: z.string().optional(),
  actionType: z.enum(["create", "view", "update", "delete"]).optional(),
  actionResult: z.string().optional(),
  resourceType: z.string().optional(),
  zoneName: z.string().optional(),
});

export type ListAuditLogsParams = z.infer<typeof ListAuditLogsParamsSchema>;

export const AuditLogPaginationSchema = z
  .object({
    count: z.number().optional(),
    per_page: z.number().optional(),
    cursor: z.string().optional(),
  })
  .passthrough();

export type AuditLogPagination = z.infer<typeof AuditLogPaginationSchema>;

export const AuditLogListResultSchema = z
  .object({
    data: z.array(AuditLogSchema),
    pagination: AuditLogPaginationSchema.optional(),
  })
  .passthrough();

export type AuditLogListResult = z.infer<typeof AuditLogListResultSchema>;

export const TokenVerificationResultSchema = z
  .object({
    id: z.string().optional(),
    status: z.string(),
    not_before: z.string().optional(),
    expires_on: z.string().optional(),
  })
  .passthrough();

export type TokenVerificationResult = z.infer<typeof TokenVerificationResultSchema>;

// ---------------------------------------------------------------------------
// DNS record schemas
// ---------------------------------------------------------------------------

export const DnsRecordSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    content: z.string(),
    ttl: z.number().optional(),
    proxied: z.boolean().optional(),
    comment: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    created_on: z.string().optional(),
    modified_on: z.string().optional(),
  })
  .passthrough();

export type DnsRecord = z.infer<typeof DnsRecordSchema>;

export const ListDnsRecordsParamsSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  proxied: z.boolean().optional(),
  search: z.string().optional(),
  order: z.enum(["type", "name", "content", "ttl", "proxied"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  match: z.enum(["all", "any"]).optional(),
  page: z.number().int().positive().optional(),
  perPage: z.number().int().positive().max(5000000).optional(),
});

export type ListDnsRecordsParams = z.infer<typeof ListDnsRecordsParamsSchema>;

export const DnsRecordResultInfoSchema = ResultInfoSchema;

export type DnsRecordResultInfo = ResultInfo;

export const ListDnsRecordsResultSchema = z.object({
  records: z.array(DnsRecordSchema),
  resultInfo: DnsRecordResultInfoSchema.optional(),
});

export type ListDnsRecordsResult = z.infer<typeof ListDnsRecordsResultSchema>;

export const UpdateDnsRecordParamsSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  ttl: z.number().int().nonnegative().optional(),
  proxied: z.boolean().optional(),
  comment: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});

export type UpdateDnsRecordParams = z.infer<typeof UpdateDnsRecordParamsSchema>;

// ---------------------------------------------------------------------------
// API Response wrappers
// ---------------------------------------------------------------------------

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  });

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ---------------------------------------------------------------------------
// Cache purge schemas
// ---------------------------------------------------------------------------

export const PurgeCacheResultSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();

export type PurgeCacheResult = z.infer<typeof PurgeCacheResultSchema>;

// ---------------------------------------------------------------------------
// Log Explorer schemas
// ---------------------------------------------------------------------------

export const LogExplorerScopeSchema = z.enum(["account", "zone"]);
export type LogExplorerScope = z.infer<typeof LogExplorerScopeSchema>;

export const QueryLogExplorerParamsSchema = z.object({
  sql: z.string().min(1, "SQL query is required"),
  scope: LogExplorerScopeSchema.optional(),
});

export type QueryLogExplorerParams = z.infer<typeof QueryLogExplorerParamsSchema>;

export const LogExplorerRowSchema = z.record(z.unknown());
export type LogExplorerRow = z.infer<typeof LogExplorerRowSchema>;

export const QueryLogExplorerResultSchema = z.object({
  rows: z.array(LogExplorerRowSchema),
});

export type QueryLogExplorerResult = z.infer<typeof QueryLogExplorerResultSchema>;

export const LogExplorerDatasetSchema = z
  .object({
    dataset: z.string(),
    object_type: z.string(),
    object_id: z.string(),
    dataset_id: z.string(),
    enabled: z.boolean(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export type LogExplorerDataset = z.infer<typeof LogExplorerDatasetSchema>;

export const EnableLogExplorerDatasetParamsSchema = z.object({
  dataset: z.string().min(1, "Dataset name is required"),
  scope: LogExplorerScopeSchema.optional(),
});

export type EnableLogExplorerDatasetParams = z.infer<
  typeof EnableLogExplorerDatasetParamsSchema
>;

// ---------------------------------------------------------------------------
// Custom hostname (SSL for SaaS) schemas
// ---------------------------------------------------------------------------

export const CustomHostnameValidationRecordSchema = z
  .object({
    txt_name: z.string().optional(),
    txt_value: z.string().optional(),
    http_url: z.string().optional(),
    http_body: z.string().optional(),
    cname: z.string().optional(),
    cname_target: z.string().optional(),
    emails: z.array(z.string()).optional(),
  })
  .passthrough();

export type CustomHostnameValidationRecord = z.infer<
  typeof CustomHostnameValidationRecordSchema
>;

export const CustomHostnameValidationErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .passthrough();

export type CustomHostnameValidationError = z.infer<
  typeof CustomHostnameValidationErrorSchema
>;

export const CustomHostnameSslSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    method: z.string().optional(),
    hosts: z.array(z.string()).optional(),
    issuer: z.string().optional(),
    serial_number: z.string().optional(),
    signature: z.string().optional(),
    certificate_authority: z.string().optional(),
    bundle_method: z.string().optional(),
    wildcard: z.boolean().optional(),
    uploaded_on: z.string().optional(),
    expires_on: z.string().optional(),
    validation_records: z.array(CustomHostnameValidationRecordSchema).optional(),
    validation_errors: z.array(CustomHostnameValidationErrorSchema).optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type CustomHostnameSsl = z.infer<typeof CustomHostnameSslSchema>;

export const CustomHostnameOwnershipVerificationSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
    value: z.string().optional(),
  })
  .passthrough();

export type CustomHostnameOwnershipVerification = z.infer<
  typeof CustomHostnameOwnershipVerificationSchema
>;

export const CustomHostnameOwnershipVerificationHttpSchema = z
  .object({
    http_url: z.string().optional(),
    http_body: z.string().optional(),
  })
  .passthrough();

export type CustomHostnameOwnershipVerificationHttp = z.infer<
  typeof CustomHostnameOwnershipVerificationHttpSchema
>;

export const CustomHostnameSchema = z
  .object({
    id: z.string(),
    hostname: z.string(),
    status: z.string().optional(),
    ssl: CustomHostnameSslSchema.optional(),
    verification_errors: z.array(z.string()).optional(),
    ownership_verification: CustomHostnameOwnershipVerificationSchema.optional(),
    ownership_verification_http:
      CustomHostnameOwnershipVerificationHttpSchema.optional(),
    custom_origin_server: z.string().optional(),
    custom_origin_sni: z.string().optional(),
    custom_metadata: z.record(z.unknown()).optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export type CustomHostname = z.infer<typeof CustomHostnameSchema>;

export const ListCustomHostnamesParamsSchema = z.object({
  hostname: z.string().optional(),
  id: z.string().optional(),
  ssl: z.boolean().optional(),
  order: z.enum(["ssl", "ssl_status"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().positive().optional(),
  perPage: z.number().int().min(5).max(50).optional(),
});

export type ListCustomHostnamesParams = z.infer<
  typeof ListCustomHostnamesParamsSchema
>;

export const ListCustomHostnamesResultSchema = z.object({
  hostnames: z.array(CustomHostnameSchema),
  resultInfo: ResultInfoSchema.optional(),
});

export type ListCustomHostnamesResult = z.infer<
  typeof ListCustomHostnamesResultSchema
>;

// ---------------------------------------------------------------------------
// Zone schemas
// ---------------------------------------------------------------------------

export const ZoneSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string().optional(),
    paused: z.boolean().optional(),
    type: z.string().optional(),
    account: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    owner: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough()
      .optional(),
    plan: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    name_servers: z.array(z.string()).optional(),
    original_name_servers: z.array(z.string()).nullable().optional(),
    original_registrar: z.string().nullable().optional(),
    original_dnshost: z.string().nullable().optional(),
    vanity_name_servers: z.array(z.string()).optional(),
    development_mode: z.number().optional(),
    created_on: z.string().optional(),
    activated_on: z.string().nullable().optional(),
    modified_on: z.string().optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type Zone = z.infer<typeof ZoneSchema>;

/**
 * Cloudflare refines `name` / `account.name` searches with an operator prefix,
 * e.g. `?name=contains:example`. `equal` is the API default and sends the bare
 * value.
 */
export const ZoneNameFilterOperatorSchema = z.enum([
  "equal",
  "not_equal",
  "starts_with",
  "ends_with",
  "contains",
  "starts_with_case_sensitive",
  "ends_with_case_sensitive",
  "contains_case_sensitive",
]);

export type ZoneNameFilterOperator = z.infer<typeof ZoneNameFilterOperatorSchema>;

export const ZoneStatusSchema = z.enum([
  "initializing",
  "pending",
  "active",
  "moved",
]);

export type ZoneStatus = z.infer<typeof ZoneStatusSchema>;

export const ZoneTypeSchema = z.enum(["full", "partial", "secondary", "internal"]);

export type ZoneType = z.infer<typeof ZoneTypeSchema>;

export const ListZonesParamsSchema = z.object({
  name: z.string().optional(),
  nameOperator: ZoneNameFilterOperatorSchema.optional(),
  accountId: z.string().optional(),
  accountName: z.string().optional(),
  accountNameOperator: ZoneNameFilterOperatorSchema.optional(),
  status: ZoneStatusSchema.optional(),
  type: z.array(ZoneTypeSchema).nonempty().optional(),
  match: z.enum(["all", "any"]).optional(),
  order: z
    .enum(["name", "status", "account.id", "account.name", "plan.id"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().positive().optional(),
  perPage: z.number().int().min(5).max(50).optional(),
});

export type ListZonesParams = z.infer<typeof ListZonesParamsSchema>;

export const ListZonesResultSchema = z.object({
  zones: z.array(ZoneSchema),
  resultInfo: ResultInfoSchema.optional(),
});

export type ListZonesResult = z.infer<typeof ListZonesResultSchema>;
