import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type FirewallRule,
  type FirewallRuleAction,
  type ListFirewallRulesResult,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface WafRulesDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "listFirewallRules"
    | "getFirewallRule"
    | "createFirewallRule"
    | "updateFirewallRule"
    | "deleteFirewallRule"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: WafRulesDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: async (prompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(prompt);
      return /^y(es)?$/i.test(answer.trim());
    } finally {
      rl.close();
    }
  },
};

const ACTIONS = [
  "block",
  "challenge",
  "js_challenge",
  "managed_challenge",
  "allow",
  "log",
  "bypass",
] as const;

function parseAction(value: string): FirewallRuleAction {
  const match = ACTIONS.find((a) => a === value);
  if (match) return match;
  throw new Error(`Action must be one of ${ACTIONS.join("|")}, got '${value}'`);
}

function parseBoolean(flagName: string): (value: string) => boolean {
  return (value: string) => {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${flagName} must be 'true' or 'false', got '${value}'`);
  };
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

function formatError(err: unknown): string {
  const base =
    err instanceof CloudflareAuthError
      ? `Authentication failed: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);

  if (!(err instanceof CloudflareError)) return base;

  const parts = [base];
  if (err.requiredPermissions && err.requiredPermissions.length > 0) {
    const perms = err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
    parts.push(`Required permission: ${perms}`);
  }
  if (err.docsUrl) {
    parts.push(`Docs: ${err.docsUrl}`);
  }
  return parts.join("\n");
}

function orDash(value: string | number | boolean | undefined): string {
  if (value === undefined) return "-";
  const text = String(value);
  return text.length > 0 ? text : "-";
}

function formatRuleLine(rule: FirewallRule): string {
  const fields = [
    `action=${orDash(rule.action)}`,
    rule.paused ? "paused=true" : "",
    rule.priority !== undefined ? `priority=${rule.priority}` : "",
  ].filter((f) => f.length > 0);
  return `${rule.id ?? "-"}  ${fields.join(" ")}  ${orDash(rule.description)}`;
}

function formatRuleDetails(rule: FirewallRule): string {
  const lines = [
    `Firewall rule ${rule.id ?? "-"}`,
    `Action:      ${orDash(rule.action)}${rule.paused ? " (paused)" : ""}`,
    `Description: ${orDash(rule.description)}`,
    `Priority:    ${orDash(rule.priority)}`,
    `Expression:  ${orDash(rule.filter?.expression)}`,
  ];
  if (rule.filter?.id) {
    lines.push(`Filter ID:   ${rule.filter.id}`);
  }
  if (rule.products && rule.products.length > 0) {
    lines.push(`Products:    ${rule.products.join(", ")}`);
  }
  if (rule.ref) {
    lines.push(`Ref:         ${rule.ref}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// List firewall rules
// ---------------------------------------------------------------------------

export interface WafRulesListFlags {
  readonly action?: FirewallRuleAction;
  readonly description?: string;
  readonly paused?: boolean;
  readonly page?: number;
  readonly perPage?: number;
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runListFirewallRules(
  flags: WafRulesListFlags,
  deps: WafRulesDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result: ListFirewallRulesResult = await client.listFirewallRules(
      {
        action: flags.action,
        description: flags.description,
        paused: flags.paused,
        page: flags.page,
        perPage: flags.perPage,
      },
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    const info = result.resultInfo;
    const count = result.rules.length;
    const noun = count === 1 ? "rule" : "rules";
    if (info?.page && info.total_pages) {
      const scope =
        info.total_count === undefined
          ? `${count} ${noun}`
          : `${count} of ${info.total_count} rules`;
      deps.log(`Showing ${scope} (page ${info.page} of ${info.total_pages})\n`);
    } else {
      deps.log(`Showing ${count} ${noun}\n`);
    }

    if (result.rules.length === 0) {
      deps.log("No firewall rules matched.");
      return;
    }
    for (const rule of result.rules) {
      deps.log(formatRuleLine(rule));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listFirewallRulesCommand = buildCommand({
  docs: {
    brief: "List firewall (WAF custom) rules in a zone",
  },
  parameters: {
    flags: {
      action: {
        kind: "parsed",
        parse: parseAction,
        optional: true,
        brief: `Filter by action (${ACTIONS.join("|")})`,
      },
      description: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Case-insensitive substring of the rule description",
      },
      paused: {
        kind: "parsed",
        parse: parseBoolean("--paused"),
        optional: true,
        brief: "Filter by paused state (true|false)",
      },
      page: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Page number",
      },
      perPage: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Rules per page (1-100)",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: WafRulesListFlags) {
    await runListFirewallRules(flags);
  },
});

// ---------------------------------------------------------------------------
// Get a firewall rule
// ---------------------------------------------------------------------------

export interface WafRuleGetFlags {
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runGetFirewallRule(
  ruleId: string,
  flags: WafRuleGetFlags,
  deps: WafRulesDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.getFirewallRule(ruleId.trim(), flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(rule, null, 2));
      return;
    }
    deps.log(formatRuleDetails(rule));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const getFirewallRuleCommand = buildCommand({
  docs: {
    brief: "Show one firewall rule, including its filter expression",
  },
  parameters: {
    flags: {
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Firewall rule ID (find it with `waf rules list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: WafRuleGetFlags, ruleId: string) {
    await runGetFirewallRule(ruleId, flags);
  },
});

// ---------------------------------------------------------------------------
// Create a firewall rule
// ---------------------------------------------------------------------------

export interface WafRuleCreateFlags {
  readonly action: FirewallRuleAction;
  readonly expression: string;
  readonly description?: string;
  readonly paused?: boolean;
  readonly priority?: number;
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runCreateFirewallRule(
  flags: WafRuleCreateFlags,
  deps: WafRulesDeps = defaultDeps
): Promise<void> {
  try {
    const expression = flags.expression.trim();
    if (expression.length === 0) {
      throw new Error("Filter expression is empty.");
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.createFirewallRule(
      {
        expression,
        action: flags.action,
        description: flags.description,
        paused: flags.paused,
        priority: flags.priority,
      },
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(rule, null, 2));
      return;
    }
    deps.log(`Created firewall rule ${rule.id ?? "(unknown id)"}.`);
    deps.log(formatRuleDetails(rule));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const createFirewallRuleCommand = buildCommand({
  docs: {
    brief: "Create a firewall (WAF custom) rule from a filter expression",
    customUsage: [
      "--action block --expression 'http.request.uri.path contains \"/wp-login.php\"'",
      "--action managed_challenge --expression 'ip.src.country eq \"CN\"' --description 'Challenge CN'",
    ],
  },
  parameters: {
    flags: {
      action: {
        kind: "parsed",
        parse: parseAction,
        brief: `Action on match (${ACTIONS.join("|")}); log is Enterprise-only`,
      },
      expression: {
        kind: "parsed",
        parse: String,
        brief: "Rules language filter expression (https://developers.cloudflare.com/ruleset-engine/rules-language/expressions/)",
      },
      description: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Human-readable summary of the rule",
      },
      paused: {
        kind: "parsed",
        parse: parseBoolean("--paused"),
        optional: true,
        brief: "Create the rule paused (true) so it does not act yet",
      },
      priority: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Processing priority (lower runs first)",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: WafRuleCreateFlags) {
    await runCreateFirewallRule(flags);
  },
});

// ---------------------------------------------------------------------------
// Update a firewall rule
// ---------------------------------------------------------------------------

export interface WafRuleUpdateFlags {
  readonly action: FirewallRuleAction;
  readonly expression: string;
  readonly description?: string;
  readonly paused?: boolean;
  readonly priority?: number;
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runUpdateFirewallRule(
  ruleId: string,
  flags: WafRuleUpdateFlags,
  deps: WafRulesDeps = defaultDeps
): Promise<void> {
  try {
    const trimmedId = ruleId.trim();
    if (trimmedId.length === 0) {
      throw new Error("Rule ID is empty.");
    }
    const expression = flags.expression.trim();
    if (expression.length === 0) {
      throw new Error("Filter expression is empty.");
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.updateFirewallRule(
      trimmedId,
      {
        expression,
        action: flags.action,
        description: flags.description,
        paused: flags.paused,
        priority: flags.priority,
      },
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(rule, null, 2));
      return;
    }
    deps.log(formatRuleDetails(rule));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const updateFirewallRuleCommand = buildCommand({
  docs: {
    brief: "Replace a firewall rule's action, expression, description, or state (PUT; resend current values to keep them)",
  },
  parameters: {
    flags: {
      action: {
        kind: "parsed",
        parse: parseAction,
        brief: `Action on match (${ACTIONS.join("|")}); required on every update`,
      },
      expression: {
        kind: "parsed",
        parse: String,
        brief: "New filter expression; required on every update (fetch the current one with `waf rules get`)",
      },
      description: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New rule description",
      },
      paused: {
        kind: "parsed",
        parse: parseBoolean("--paused"),
        optional: true,
        brief: "Pause (true) or unpause (false) the rule",
      },
      priority: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "New processing priority",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Firewall rule ID (find it with `waf rules list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: WafRuleUpdateFlags, ruleId: string) {
    await runUpdateFirewallRule(ruleId, flags);
  },
});

// ---------------------------------------------------------------------------
// Delete a firewall rule
// ---------------------------------------------------------------------------

export interface WafRuleDeleteFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runDeleteFirewallRule(
  ruleId: string,
  flags: WafRuleDeleteFlags,
  deps: WafRulesDeps = defaultDeps
): Promise<void> {
  try {
    const trimmed = ruleId.trim();
    if (trimmed.length === 0) {
      throw new Error("Rule ID is empty.");
    }

    if (!flags.yes) {
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to delete a firewall rule without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to delete firewall rule ${trimmed}. Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    await client.deleteFirewallRule(trimmed, flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify({ deleted: true, id: trimmed }, null, 2));
      return;
    }
    deps.log(`Deleted firewall rule ${trimmed}.`);
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const deleteFirewallRuleCommand = buildCommand({
  docs: {
    brief: "Delete a firewall rule",
  },
  parameters: {
    flags: {
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
      yes: {
        kind: "boolean",
        brief: "Skip the confirmation prompt",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Firewall rule ID (find it with `waf rules list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: WafRuleDeleteFlags, ruleId: string) {
    await runDeleteFirewallRule(ruleId, flags);
  },
});
