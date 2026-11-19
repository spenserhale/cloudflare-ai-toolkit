import { readFile } from "node:fs/promises";
import { buildCommand } from "@stricli/core";
import {
  CloudflareClient,
  CloudflareError,
  describeError,
  loadConfig,
  parseRulesetRuleUpdateBody,
  type RulesetRuleSnapshot,
  type UpdateRulesetRuleBody,
  type UpdateRulesetRuleOptions,
} from "@cloudflare-ai-toolkit/sdk";
import { readAllStdin } from "../lib/prompt.js";
import { rulesetTarget, scopedFlags, validateScope, type ScopedFlags } from "./inventory.js";

interface UpdateFlags extends ScopedFlags, UpdateRulesetRuleOptions {
  readonly rulesetId: string;
  readonly body?: string;
  readonly stdin: boolean;
  readonly dryRun: boolean;
}

async function readBody(flags: UpdateFlags): Promise<UpdateRulesetRuleBody> {
  if ((flags.body !== undefined) === flags.stdin) {
    throw new CloudflareError("Provide exactly one of --body <file> and --stdin.", "INVALID_ARGUMENT");
  }
  const text = flags.body === undefined ? await readAllStdin() : await readFile(flags.body, "utf8");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new CloudflareError("Rule body must be valid JSON.", "INVALID_RULE_BODY");
  }
  return parseRulesetRuleUpdateBody(body);
}

function parseVersion(value: string): string {
  if (!/^\d+$/u.test(value)) throw new Error("Expected version must contain only digits.");
  return value;
}

function formatSnapshot(state: RulesetRuleSnapshot): string {
  return [
    `  Ruleset version: ${state.rulesetVersion ?? "(unavailable)"}`,
    `  Rule version: ${state.ruleVersion ?? "(unavailable)"}`,
    `  Position: ${state.position}`,
    `  Description: ${state.description === null ? "(unavailable)" : JSON.stringify(state.description)}`,
    `  last_updated: ${state.last_updated ?? "(unavailable)"}`,
  ].join("\n");
}

export const updateRulesetRuleCommand = buildCommand({
  docs: {
    brief: "Update one rule in a zone or account Ruleset",
    fullDescription:
      "Choose one input source: --body <file> or --stdin. Include the complete rule definition you want Cloudflare to retain. " +
      "Include position only to move the rule. " +
      "Version guards check the current ruleset before PATCH. Use --dry-run to validate without applying.",
  },
  parameters: {
    flags: {
      ...scopedFlags,
      rulesetId: { kind: "parsed", parse: String, brief: "Ruleset ID containing the rule" },
      body: { kind: "parsed", parse: String, optional: true, brief: "Read the native JSON rule definition from this file" },
      stdin: { kind: "boolean", default: false, brief: "Read the native JSON rule definition from stdin" },
      dryRun: { kind: "boolean", default: false, brief: "Validate with Cloudflare without applying the update" },
      expectRulesetVersion: { kind: "parsed", parse: parseVersion, optional: true, brief: "Require this ruleset version in the preflight read" },
      expectRuleVersion: { kind: "parsed", parse: parseVersion, optional: true, brief: "Require this rule version in the preflight read" },
    },
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Rulesets rule ID", parse: String, placeholder: "rule-id" }],
    },
  },
  async func(this: void, flags: UpdateFlags, ruleId: string) {
    try {
      validateScope(flags);
      const body = await readBody(flags);
      const client = new CloudflareClient(await loadConfig());
      const result = await client.updateRulesetRule(flags.rulesetId, ruleId, body, rulesetTarget(flags), {
        dryRun: flags.dryRun,
        expectRulesetVersion: flags.expectRulesetVersion,
        expectRuleVersion: flags.expectRuleVersion,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log([
        `Ruleset ${result.rulesetId}, rule ${result.ruleId}`,
        `Dry run: ${result.dryRun ? "yes" : "no"}`,
        "Before",
        formatSnapshot(result.before),
        `  GET cf-ray: ${result.before["cf-ray"] ?? "(unavailable)"}`,
        "After",
        result.after ? formatSnapshot(result.after) : "  Cloudflare returned no updated ruleset for the dry run.",
        `  PATCH cf-ray: ${result["cf-ray"] ?? "(unavailable)"}`,
      ].join("\n"));
    } catch (error) {
      const cloudflare = error instanceof CloudflareError ? error : undefined;
      const message = describeError(error);
      const detail = flags.json
        ? JSON.stringify({
          success: false,
          message,
          errors: cloudflare?.errors?.length
            ? cloudflare.errors
            : [{ code: cloudflare?.code ?? "CLI_ERROR", message: cloudflare?.message ?? message }],
          statusCode: cloudflare?.statusCode ?? null,
          "cf-ray": cloudflare?.cfRay ?? null,
        }, null, 2)
        : [
          `Error: ${message}`,
          ...(cloudflare?.errors?.slice(1) ?? []).map((entry) =>
            `Cloudflare error ${entry.code ?? "(no code)"}: ${entry.message}`),
        ].join("\n");
      // Wait for piped stderr to drain before exiting so JSON stays parseable.
      await new Promise<void>((resolve) => {
        process.stderr.write(`${detail}\n`, "utf8", () => resolve());
      });
      process.exit(1);
    }
  },
});
