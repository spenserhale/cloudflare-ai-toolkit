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

export const DnsRecordResultInfoSchema = z
  .object({
    page: z.number().optional(),
    per_page: z.number().optional(),
    count: z.number().optional(),
    total_count: z.number().optional(),
    total_pages: z.number().optional(),
  })
  .passthrough();

export type DnsRecordResultInfo = z.infer<typeof DnsRecordResultInfoSchema>;

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
