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
// API token introspection
// ---------------------------------------------------------------------------

/**
 * A permission group as returned either by the permission-group catalog or
 * embedded in a token policy.
 *
 * The two sources disagree on where the scope lives: the catalog endpoint
 * returns `scopes` as an array of strings, while groups embedded in a policy
 * carry a single scope string under `meta.scopes`. Both are accepted here and
 * normalised by `flattenTokenPolicies`.
 *
 * Cloudflare treats `id` as the stable key and documents `name` as "cosmetic
 * and subject to change", which is why permission checks match on either.
 *
 * @see https://developers.cloudflare.com/fundamentals/api/how-to/create-via-api/
 */
export const TokenPermissionGroupSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    meta: z
      .object({
        label: z.string().optional(),
        scopes: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type TokenPermissionGroup = z.infer<typeof TokenPermissionGroupSchema>;

/**
 * Resources a policy applies to, keyed by Cloudflare resource identifier. The
 * value is either `"*"` or a nested object for account-scoped zone wildcards
 * (`{"com.cloudflare.api.account.<id>": {"com.cloudflare.api.account.zone.*": "*"}}`).
 */
export const TokenPolicyResourcesSchema = z.record(
  z.union([z.string(), z.record(z.string())])
);

export type TokenPolicyResources = z.infer<typeof TokenPolicyResourcesSchema>;

export const TokenPolicyEffectSchema = z.enum(["allow", "deny"]);

export type TokenPolicyEffect = z.infer<typeof TokenPolicyEffectSchema>;

export const TokenPolicySchema = z
  .object({
    id: z.string(),
    effect: TokenPolicyEffectSchema,
    permission_groups: z.array(TokenPermissionGroupSchema),
    resources: TokenPolicyResourcesSchema,
  })
  .passthrough();

export type TokenPolicy = z.infer<typeof TokenPolicySchema>;

export const ApiTokenSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    issued_on: z.string().optional(),
    modified_on: z.string().optional(),
    not_before: z.string().optional(),
    expires_on: z.string().optional(),
    last_used_on: z.string().nullable().optional(),
    policies: z.array(TokenPolicySchema).optional(),
  })
  .passthrough();

export type ApiToken = z.infer<typeof ApiTokenSchema>;

/**
 * Which resource category a permission group applies to. Derived from the
 * Cloudflare scope URNs: `com.cloudflare.api.user`,
 * `com.cloudflare.api.account`, and `com.cloudflare.api.account.zone`.
 */
export const TokenPermissionScopeSchema = z.enum([
  "user",
  "account",
  "zone",
  "unknown",
]);

export type TokenPermissionScope = z.infer<typeof TokenPermissionScopeSchema>;

/** One permission group flattened out of its enclosing policy. */
export const TokenPermissionSchema = z.object({
  policyId: z.string(),
  effect: TokenPolicyEffectSchema,
  id: z.string(),
  name: z.string().optional(),
  scope: TokenPermissionScopeSchema,
  scopes: z.array(z.string()),
  resources: z.array(z.string()),
});

export type TokenPermission = z.infer<typeof TokenPermissionSchema>;

export const TokenPermissionsResultSchema = z.object({
  tokenId: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  notBefore: z.string().optional(),
  expiresOn: z.string().optional(),
  permissions: z.array(TokenPermissionSchema),
});

export type TokenPermissionsResult = z.infer<typeof TokenPermissionsResultSchema>;

export const ListTokenPermissionGroupsParamsSchema = z.object({
  name: z.string().optional(),
  scope: z.string().optional(),
  accountId: z.string().optional(),
});

export type ListTokenPermissionGroupsParams = z.infer<
  typeof ListTokenPermissionGroupsParamsSchema
>;

/** Outcome of matching one `--check` query against a token's permissions. */
export const TokenPermissionCheckSchema = z.object({
  query: z.string(),
  granted: z.boolean(),
  matched: z.array(TokenPermissionSchema),
});

export type TokenPermissionCheck = z.infer<typeof TokenPermissionCheckSchema>;

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

export const LogExplorerDatasetFieldSchema = z.object({
  enabled: z.boolean(),
  name: z.string(),
});

export type LogExplorerDatasetField = z.infer<typeof LogExplorerDatasetFieldSchema>;

export const LogExplorerDatasetSchema = z
  .object({
    dataset: z.string(),
    object_type: z.string(),
    object_id: z.string(),
    dataset_id: z.string(),
    enabled: z.boolean(),
    deletion_protection: z.boolean().optional(),
    fields: z.array(LogExplorerDatasetFieldSchema).nullable().optional(),
    filter: z.string().optional(),
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

export const ListLogExplorerDatasetsParamsSchema = z.object({
  scope: LogExplorerScopeSchema.optional(),
  includeZones: z.boolean().optional(),
});

export type ListLogExplorerDatasetsParams = z.infer<
  typeof ListLogExplorerDatasetsParamsSchema
>;

export const GetLogExplorerDatasetParamsSchema = z.object({
  datasetId: z.string().min(1, "Dataset ID is required"),
  scope: LogExplorerScopeSchema.optional(),
});

export type GetLogExplorerDatasetParams = z.infer<typeof GetLogExplorerDatasetParamsSchema>;

export const UpdateLogExplorerDatasetParamsSchema = z.object({
  datasetId: z.string().min(1, "Dataset ID is required"),
  enabled: z.boolean(),
  deletionProtection: z.boolean().optional(),
  fields: z.array(LogExplorerDatasetFieldSchema).optional(),
  filter: z.string().optional(),
  scope: LogExplorerScopeSchema.optional(),
});

export type UpdateLogExplorerDatasetParams = z.infer<
  typeof UpdateLogExplorerDatasetParamsSchema
>;

export const DeleteLogExplorerDatasetParamsSchema = z.object({
  datasetId: z.string().min(1, "Dataset ID is required"),
  scope: LogExplorerScopeSchema.optional(),
});

export type DeleteLogExplorerDatasetParams = z.infer<
  typeof DeleteLogExplorerDatasetParamsSchema
>;

export const ListAvailableLogExplorerDatasetsParamsSchema = z.object({
  scope: LogExplorerScopeSchema.optional(),
});

export type ListAvailableLogExplorerDatasetsParams = z.infer<
  typeof ListAvailableLogExplorerDatasetsParamsSchema
>;

export const AvailableLogExplorerDatasetSchema = z
  .object({
    dataset: z.string(),
    object_type: z.string(),
    timestamp_field: z.string(),
    schema: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type AvailableLogExplorerDataset = z.infer<typeof AvailableLogExplorerDatasetSchema>;

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

export const CustomHostnameSslSettingsSchema = z
  .object({
    ciphers: z.array(z.string()).optional(),
    early_hints: z.enum(["on", "off"]).optional(),
    http2: z.enum(["on", "off"]).optional(),
    min_tls_version: z.enum(["1.0", "1.1", "1.2", "1.3"]).optional(),
    tls_1_3: z.enum(["on", "off"]).optional(),
  })
  .passthrough();

export type CustomHostnameSslSettings = z.infer<typeof CustomHostnameSslSettingsSchema>;

/**
 * SSL properties accepted when creating or updating a custom hostname.
 * Sent verbatim as the request's `ssl` object.
 */
export const CustomHostnameSslInputSchema = z
  .object({
    method: z.enum(["http", "txt", "email"]).optional(),
    type: z.literal("dv").optional(),
    wildcard: z.boolean().optional(),
    bundle_method: z.enum(["ubiquitous", "optimal", "force"]).optional(),
    certificate_authority: z
      .enum(["digicert", "google", "lets_encrypt", "ssl_com"])
      .optional(),
    cloudflare_branding: z.boolean().optional(),
    custom_certificate: z.string().optional(),
    custom_key: z.string().optional(),
    custom_csr_id: z.string().optional(),
    settings: CustomHostnameSslSettingsSchema.optional(),
  })
  .passthrough();

export type CustomHostnameSslInput = z.infer<typeof CustomHostnameSslInputSchema>;

export const CreateCustomHostnameParamsSchema = z.object({
  hostname: z.string().min(1, "Hostname is required"),
  custom_origin_server: z.string().optional(),
  custom_origin_sni: z.string().optional(),
  custom_metadata: z.record(z.unknown()).optional(),
  ssl: CustomHostnameSslInputSchema.optional(),
});

export type CreateCustomHostnameParams = z.infer<typeof CreateCustomHostnameParamsSchema>;

export const UpdateCustomHostnameParamsSchema = z
  .object({
    custom_origin_server: z.string().optional(),
    custom_origin_sni: z.string().optional(),
    custom_metadata: z.record(z.unknown()).optional(),
    ssl: CustomHostnameSslInputSchema.optional(),
  })
  .refine(
    (params) =>
      params.custom_origin_server !== undefined ||
      params.custom_origin_sni !== undefined ||
      params.custom_metadata !== undefined ||
      params.ssl !== undefined,
    { message: "Provide at least one field to update" }
  );

export type UpdateCustomHostnameParams = z.infer<
  typeof UpdateCustomHostnameParamsSchema
>;

// ---------------------------------------------------------------------------
// Firewall (WAF) rule schemas
// ---------------------------------------------------------------------------

export const FIREWALL_RULE_ACTIONS = [
  "block",
  "challenge",
  "js_challenge",
  "managed_challenge",
  "allow",
  "log",
  "bypass",
] as const;

export const FirewallRuleActionSchema = z.enum(FIREWALL_RULE_ACTIONS);

export type FirewallRuleAction = z.infer<typeof FirewallRuleActionSchema>;

export const FIREWALL_RULE_PRODUCTS = [
  "zoneLockdown",
  "uaBlock",
  "bic",
  "hot",
  "securityLevel",
  "rateLimit",
  "waf",
] as const;

export const FirewallRuleProductSchema = z.enum(FIREWALL_RULE_PRODUCTS);

export type FirewallRuleProduct = z.infer<typeof FirewallRuleProductSchema>;

export const FirewallFilterSchema = z
  .object({
    id: z.string().optional(),
    description: z.string().optional(),
    expression: z.string().optional(),
    paused: z.boolean().optional(),
    ref: z.string().optional(),
  })
  .passthrough();

export type FirewallFilter = z.infer<typeof FirewallFilterSchema>;

export const FirewallRuleSchema = z
  .object({
    id: z.string().optional(),
    action: FirewallRuleActionSchema.optional(),
    description: z.string().optional(),
    filter: FirewallFilterSchema.optional(),
    paused: z.boolean().optional(),
    priority: z.number().optional(),
    products: z.array(FirewallRuleProductSchema).optional(),
    ref: z.string().optional(),
  })
  .passthrough();

export type FirewallRule = z.infer<typeof FirewallRuleSchema>;

export const ListFirewallRulesParamsSchema = z.object({
  id: z.string().optional(),
  action: FirewallRuleActionSchema.optional(),
  description: z.string().optional(),
  paused: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  perPage: z.number().int().min(1).max(100).optional(),
});

export type ListFirewallRulesParams = z.infer<typeof ListFirewallRulesParamsSchema>;

export const ListFirewallRulesResultSchema = z.object({
  rules: z.array(FirewallRuleSchema),
  resultInfo: ResultInfoSchema.optional(),
});

export type ListFirewallRulesResult = z.infer<typeof ListFirewallRulesResultSchema>;

/**
 * Body for POST /zones/{zone_id}/firewall/rules. The filter expression is
 * required; Cloudflare creates the underlying filter record automatically.
 */
export const CreateFirewallRuleParamsSchema = z.object({
  expression: z.string().min(1, "Filter expression is required"),
  action: FirewallRuleActionSchema,
  description: z.string().optional(),
  paused: z.boolean().optional(),
  priority: z.number().int().optional(),
  products: z.array(FirewallRuleProductSchema).optional(),
  ref: z.string().optional(),
});

export type CreateFirewallRuleParams = z.infer<typeof CreateFirewallRuleParamsSchema>;

/**
 * Body for PUT /zones/{zone_id}/firewall/rules/{rule_id}. PUT replaces the
 * rule, so the action and expression are required.
 */
export const UpdateFirewallRuleParamsSchema = z.object({
  expression: z.string().min(1, "Filter expression is required"),
  action: FirewallRuleActionSchema,
  description: z.string().optional(),
  paused: z.boolean().optional(),
  priority: z.number().int().optional(),
  products: z.array(FirewallRuleProductSchema).optional(),
  ref: z.string().optional(),
});

export type UpdateFirewallRuleParams = z.infer<typeof UpdateFirewallRuleParamsSchema>;

// ---------------------------------------------------------------------------
// Redirect rule (Rulesets Engine, http_request_dynamic_redirect phase) schemas
// ---------------------------------------------------------------------------

export const REDIRECT_RULE_PHASE = "http_request_dynamic_redirect";

export const REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308] as const;

export const RedirectStatusCodeSchema = z.union([
  z.literal(301),
  z.literal(302),
  z.literal(303),
  z.literal(307),
  z.literal(308),
]);

export type RedirectStatusCode = z.infer<typeof RedirectStatusCodeSchema>;

export const RedirectTargetUrlSchema = z
  .object({
    value: z.string().optional(),
    expression: z.string().optional(),
  })
  .passthrough();

export type RedirectTargetUrl = z.infer<typeof RedirectTargetUrlSchema>;

export const RedirectFromValueSchema = z
  .object({
    target_url: RedirectTargetUrlSchema.optional(),
    status_code: RedirectStatusCodeSchema.optional(),
    preserve_query_string: z.boolean().optional(),
  })
  .passthrough();

export type RedirectFromValue = z.infer<typeof RedirectFromValueSchema>;

export const RedirectActionParametersSchema = z
  .object({
    from_list: z.record(z.unknown()).optional(),
    from_value: RedirectFromValueSchema.optional(),
  })
  .passthrough();

export type RedirectActionParameters = z.infer<typeof RedirectActionParametersSchema>;

export const RedirectRuleSchema = z
  .object({
    id: z.string().optional(),
    action: z.string().optional(),
    expression: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    action_parameters: RedirectActionParametersSchema.optional(),
    version: z.string().optional(),
    last_updated: z.string().optional(),
    ref: z.string().optional(),
  })
  .passthrough();

export type RedirectRule = z.infer<typeof RedirectRuleSchema>;

export const RulesetSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    kind: z.string().optional(),
    phase: z.string().optional(),
    version: z.string().optional(),
    last_updated: z.string().optional(),
    description: z.string().optional(),
    rules: z.array(RedirectRuleSchema).optional(),
  })
  .passthrough();

export type Ruleset = z.infer<typeof RulesetSchema>;

export const ListRedirectRulesResultSchema = z.object({
  rulesetId: z.string().optional(),
  rules: z.array(RedirectRuleSchema),
});

export type ListRedirectRulesResult = z.infer<typeof ListRedirectRulesResultSchema>;

/**
 * Flat creation params — the SDK builds the nested `action_parameters.from_value`
 * object the Rulesets API expects. Pass exactly one of `targetUrl` (literal URL)
 * or `targetExpression` (dynamic rules-language expression evaluating to a URL).
 */
export const CreateRedirectRuleParamsSchema = z
  .object({
    expression: z.string().min(1, "Filter expression is required"),
    targetUrl: z.string().optional(),
    targetExpression: z.string().optional(),
    statusCode: RedirectStatusCodeSchema.optional(),
    preserveQueryString: z.boolean().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  })
  .refine(
    (params) => Boolean(params.targetUrl ?? params.targetExpression),
    { message: "Provide targetUrl (literal) or targetExpression (dynamic) — exactly one" }
  )
  .refine(
    (params) => !(params.targetUrl !== undefined && params.targetExpression !== undefined),
    { message: "Pass only one of targetUrl or targetExpression" }
  );

export type CreateRedirectRuleParams = z.infer<typeof CreateRedirectRuleParamsSchema>;

/**
 * Partial update params. Any redirect-action field (targetUrl, targetExpression,
 * statusCode, preserveQueryString) merges with the rule's current from_value, so
 * you can change just the status code without resending the target.
 */
export const UpdateRedirectRuleParamsSchema = z
  .object({
    expression: z.string().min(1).optional(),
    targetUrl: z.string().optional(),
    targetExpression: z.string().optional(),
    statusCode: RedirectStatusCodeSchema.optional(),
    preserveQueryString: z.boolean().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (params) =>
      params.expression !== undefined ||
      params.targetUrl !== undefined ||
      params.targetExpression !== undefined ||
      params.statusCode !== undefined ||
      params.preserveQueryString !== undefined ||
      params.description !== undefined ||
      params.enabled !== undefined,
    { message: "Provide at least one field to update" }
  );

export type UpdateRedirectRuleParams = z.infer<typeof UpdateRedirectRuleParamsSchema>;

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
    vanity_name_servers: z.array(z.string()).nullable().optional(),
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

// ---------------------------------------------------------------------------
// Zone custom (vanity) nameserver schemas
// ---------------------------------------------------------------------------

/**
 * Cloudflare's Zone details response carries a `vanity_name_servers_ips` field
 * that is absent from the public OpenAPI schema, so `ZoneSchema` lets it
 * through untyped (the schema is `passthrough`) and we parse it leniently here.
 * A shape we do not recognise degrades to an empty list rather than throwing.
 */
export const VanityNameServerIpSchema = z
  .object({
    ns_name: z.string().optional(),
    ipv4: z.string().nullable().optional(),
    ipv6: z.string().nullable().optional(),
  })
  .passthrough();

export type VanityNameServerIp = z.infer<typeof VanityNameServerIpSchema>;

export const VanityNameServerIpsSchema = z
  .array(VanityNameServerIpSchema)
  .nullable()
  .optional()
  .catch(undefined);

/**
 * Zone custom nameservers (ZCNS), historically "vanity nameservers". Each name
 * must be a subdomain of the zone it is configured on, and the feature is
 * gated to Business and Enterprise plans.
 *
 * @see https://developers.cloudflare.com/dns/nameservers/custom-nameservers/zone-custom-nameservers/
 */
export const VanityNameServerNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Nameserver name is empty")
  .max(253, "Nameserver name exceeds 253 characters")
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/u,
    "Nameserver must be a fully qualified hostname (e.g. ns1.example.com)"
  );

/**
 * Cloudflare does not document a maximum count, so we only enforce uniqueness
 * and let the API reject anything beyond its own limit.
 */
export const VanityNameServersSchema = z
  .array(VanityNameServerNameSchema)
  .refine(
    (names) => new Set(names).size === names.length,
    "Nameserver names must be unique"
  );

export const SetZoneVanityNameServersParamsSchema = z.object({
  nameServers: VanityNameServersSchema,
});

export type SetZoneVanityNameServersParams = z.infer<
  typeof SetZoneVanityNameServersParamsSchema
>;

export const ZoneVanityNameServersSchema = z.object({
  zoneId: z.string(),
  zoneName: z.string(),
  /** `true` when the zone has at least one custom nameserver configured. */
  enabled: z.boolean(),
  /** Configured custom nameservers; empty when the zone uses Cloudflare's. */
  nameServers: z.array(z.string()),
  /** Cloudflare-assigned glue record addresses, one entry per nameserver. */
  ips: z.array(VanityNameServerIpSchema),
  /** Cloudflare's assigned nameservers, which ZCNS replace at the registrar. */
  assignedNameServers: z.array(z.string()),
});

export type ZoneVanityNameServers = z.infer<typeof ZoneVanityNameServersSchema>;
