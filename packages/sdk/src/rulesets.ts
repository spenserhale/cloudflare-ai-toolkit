import { z } from "zod";
import { CloudflareError, type CloudflareErrorOptions } from "./errors.js";
import { InventoryRuleSchema, InventoryRulesetMetadataSchema, type InventoryScope } from "./types.js";

// Action variants of Rulesets Rules Edit in the Cloudflare API reference.
const RuleActionSchema = z.enum([
  "block",
  "challenge",
  "compress_response",
  "ddos_dynamic",
  "execute",
  "force_connection_close",
  "js_challenge",
  "log",
  "log_custom_field",
  "managed_challenge",
  "redirect",
  "rewrite",
  "route",
  "score",
  "serve_error",
  "set_cache_control",
  "set_cache_settings",
  "set_cache_tags",
  "set_config",
  "skip",
  "transform_response_html",
]);

const UpdateBodySchema = z.object({
  action: RuleActionSchema.optional(),
  expression: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  ref: z.string().optional(),
}).passthrough();

export type UpdateRulesetRuleBody = z.infer<typeof UpdateBodySchema>;

export function parseRulesetRuleUpdateBody(body: unknown): UpdateRulesetRuleBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new CloudflareError("Ruleset rule body must be a JSON object.", "INVALID_RULE_BODY");
  }
  const legacy = ["filter", "paused", "priority", "products"].filter((field) => Object.hasOwn(body, field));
  if (legacy.length > 0) {
    throw new CloudflareError(
      `Legacy Firewall Rules fields are unsupported: ${legacy.join(", ")}. Use a native Rulesets rule definition with fields like expression, enabled, position, and action_parameters.`,
      "INVALID_RULE_BODY",
    );
  }
  const parsed = UpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new CloudflareError(`Invalid Rulesets rule body.\n${details}`, "INVALID_RULE_BODY");
  }
  return parsed.data;
}

export interface UpdateRulesetRuleOptions {
  readonly dryRun?: boolean;
  readonly expectRulesetVersion?: string;
  readonly expectRuleVersion?: string;
}

export interface RulesetRuleSnapshot {
  readonly rulesetVersion: string | null;
  readonly ruleVersion: string | null;
  readonly position: number;
  readonly description: string | null;
  readonly last_updated: string | null;
}

export type UpdateRulesetRuleResult = InventoryScope & {
  readonly rulesetId: string;
  readonly ruleId: string;
  readonly dryRun: boolean;
  readonly before: RulesetRuleSnapshot & { readonly "cf-ray": string | null };
  readonly after: RulesetRuleSnapshot | null;
  readonly "cf-ray": string | null;
};

const RuleSnapshotSchema = InventoryRuleSchema.pick({
  id: true, version: true, description: true, last_updated: true,
}).strip();
const RulesetSnapshotSchema = InventoryRulesetMetadataSchema.pick({ id: true, version: true })
  .extend({ rules: z.array(RuleSnapshotSchema) }).strip();

export function rulesetRuleSnapshot(
  result: unknown,
  rulesetId: string,
  ruleId: string,
  request: CloudflareErrorOptions,
): RulesetRuleSnapshot {
  const ruleset = RulesetSnapshotSchema.safeParse(result);
  if (!ruleset.success || ruleset.data.id !== rulesetId) {
    const hint = request.requestMethod === "PATCH" ? " Read the ruleset again to verify the update." : "";
    throw new CloudflareError(`Cloudflare response did not contain ruleset "${rulesetId}".${hint}`, "MALFORMED_RESPONSE", undefined, request);
  }
  const index = ruleset.data.rules.findIndex((rule) => rule.id === ruleId);
  const rule = ruleset.data.rules[index];
  if (!rule) {
    throw new CloudflareError(`Rule "${ruleId}" not found in ruleset "${rulesetId}".`, "RULE_NOT_FOUND", undefined, request);
  }
  return {
    rulesetVersion: ruleset.data.version ?? null,
    ruleVersion: rule.version ?? null,
    position: index + 1,
    description: rule.description ?? null,
    last_updated: rule.last_updated ?? null,
  };
}

export function checkRulesetRuleVersions(
  before: RulesetRuleSnapshot,
  options: UpdateRulesetRuleOptions,
  request: CloudflareErrorOptions,
): void {
  const versions = [
    ["Ruleset", options.expectRulesetVersion, before.rulesetVersion],
    ["Rule", options.expectRuleVersion, before.ruleVersion],
  ] as const;
  for (const [label, expected, actual] of versions) {
    if (expected !== undefined && expected !== actual) {
      throw new CloudflareError(
        `${label} version mismatch. Expected "${expected}", live version ${actual === null ? "unavailable" : `"${actual}"`}.`,
        "VERSION_MISMATCH",
        undefined,
        request,
      );
    }
  }
}
