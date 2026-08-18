import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  REDIRECT_STATUS_CODES,
  resolveConfig,
  type RedirectRule,
  type RedirectStatusCode,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface RedirectsDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "listRedirectRules"
    | "getRedirectRule"
    | "createRedirectRule"
    | "updateRedirectRule"
    | "deleteRedirectRule"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: RedirectsDeps = {
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

function parseStatusCode(value: string): RedirectStatusCode {
  const code = Number.parseInt(value, 10);
  if ((REDIRECT_STATUS_CODES as readonly number[]).includes(code)) {
    return code as RedirectStatusCode;
  }
  throw new Error(
    `Status code must be one of ${REDIRECT_STATUS_CODES.join("|")}, got '${value}'`
  );
}

function parseBoolean(flagName: string): (value: string) => boolean {
  return (value: string) => {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${flagName} must be 'true' or 'false', got '${value}'`);
  };
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

function describeTarget(rule: RedirectRule): string {
  const fromValue = rule.action_parameters?.from_value;
  const target = fromValue?.target_url;
  const fromList = rule.action_parameters?.from_list;
  const url = target?.value !== undefined
    ? target.value
    : target?.expression !== undefined
      ? `expr: ${target.expression}`
      : fromList !== undefined
        ? `list: ${String(fromList.name ?? "-")}`
        : "-";
  return `${orDash(fromValue?.status_code)} -> ${url}`;
}

function formatRuleLine(rule: RedirectRule): string {
  const fields = [
    describeTarget(rule),
    rule.enabled === false ? "disabled" : "",
    fromValueOf(rule).preserve_query_string ? "keep-query" : "",
  ].filter((f) => f.length > 0);
  return `${rule.id ?? "-"}  ${fields.join(" ")}  ${orDash(rule.expression)}`;
}

function fromValueOf(rule: RedirectRule) {
  return rule.action_parameters?.from_value ?? {};
}

function formatRuleDetails(rule: RedirectRule): string {
  const fromValue = fromValueOf(rule);
  const target = fromValue.target_url;
  const lines = [
    `Redirect rule ${rule.id ?? "-"}`,
    `Expression:   ${orDash(rule.expression)}`,
    `Status code:  ${orDash(fromValue.status_code)}`,
    `Target URL:   ${target?.value ?? "-"}`,
    `Target expr:  ${target?.expression ?? "-"}`,
    `Query string: ${fromValue.preserve_query_string ? "preserved" : "dropped"}`,
    `Enabled:      ${rule.enabled !== false}`,
  ];
  if (rule.description) {
    lines.push(`Description:  ${rule.description}`);
  }
  if (rule.last_updated) {
    lines.push(`Updated:      ${rule.last_updated}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// redirects list
// ---------------------------------------------------------------------------

export interface RedirectsListFlags {
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runListRedirectRules(
  flags: RedirectsListFlags,
  deps: RedirectsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.listRedirectRules(flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }

    const count = result.rules.length;
    const noun = count === 1 ? "redirect rule" : "redirect rules";
    deps.log(`Showing ${count} ${noun} (first match wins)\n`);
    if (count === 0) {
      deps.log(
        "No redirect rules configured. Create one with `cloudflare redirects create`."
      );
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

export const listRedirectRulesCommand = buildCommand({
  docs: {
    brief: "List redirect rules in a zone",
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
  },
  async func(this: void, flags: RedirectsListFlags) {
    await runListRedirectRules(flags);
  },
});

// ---------------------------------------------------------------------------
// redirects get
// ---------------------------------------------------------------------------

export type RedirectsGetFlags = RedirectsListFlags;

export async function runGetRedirectRule(
  ruleId: string,
  flags: RedirectsGetFlags,
  deps: RedirectsDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.getRedirectRule(ruleId.trim(), flags.zoneId);

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

export const getRedirectRuleCommand = buildCommand({
  docs: {
    brief: "Show one redirect rule",
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
          brief: "Redirect rule ID (find it with `redirects list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: RedirectsGetFlags, ruleId: string) {
    await runGetRedirectRule(ruleId, flags);
  },
});

// ---------------------------------------------------------------------------
// redirects create
// ---------------------------------------------------------------------------

export interface RedirectsCreateFlags {
  readonly expression: string;
  readonly targetUrl?: string;
  readonly targetExpression?: string;
  readonly statusCode?: RedirectStatusCode;
  readonly preserveQueryString?: boolean;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly dryRun: boolean;
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runCreateRedirectRule(
  flags: RedirectsCreateFlags,
  deps: RedirectsDeps = defaultDeps
): Promise<void> {
  try {
    const expression = flags.expression.trim();
    if (expression.length === 0) {
      throw new Error("Filter expression is empty.");
    }
    if (flags.targetUrl === undefined && flags.targetExpression === undefined) {
      throw new Error(
        "Provide a target: --targetUrl <url> for a fixed destination or --targetExpression <expr> for a dynamic one."
      );
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.createRedirectRule(
      {
        expression,
        targetUrl: flags.targetUrl,
        targetExpression: flags.targetExpression,
        statusCode: flags.statusCode,
        preserveQueryString: flags.preserveQueryString,
        description: flags.description,
        enabled: flags.enabled,
        dryRun: flags.dryRun,
      },
      flags.zoneId
    );

    if (flags.json) {
      deps.log(JSON.stringify(rule, null, 2));
      return;
    }
    if (flags.dryRun) {
      deps.log("Dry run: the rule validates. Re-run without --dryRun to create it.\n");
    } else {
      deps.log(`Created redirect rule ${rule.id ?? "(unknown id)"}.\n`);
    }
    deps.log(formatRuleDetails(rule));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const createRedirectRuleCommand = buildCommand({
  docs: {
    brief: "Create a redirect rule",
    customUsage: [
      "--expression 'http.request.uri.path eq \"/old\"' --targetUrl https://example.com/new --statusCode 301",
      "--expression 'starts_with(http.request.uri.path, \"/blog/\")' --targetExpression 'concat(\"https://blog.example.com\", http.request.uri.path)' --preserveQueryString true",
    ],
  },
  parameters: {
    flags: {
      expression: {
        kind: "parsed",
        parse: String,
        brief: "Rules language expression selecting matched requests",
      },
      targetUrl: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Literal redirect destination URL (mutually exclusive with --targetExpression)",
      },
      targetExpression: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Dynamic expression evaluating to the destination URL",
      },
      statusCode: {
        kind: "parsed",
        parse: parseStatusCode,
        optional: true,
        brief: `Redirect status code (${REDIRECT_STATUS_CODES.join("|")}); default 301`,
      },
      preserveQueryString: {
        kind: "parsed",
        parse: parseBoolean("--preserveQueryString"),
        optional: true,
        brief: "Keep the original query string (true|false)",
      },
      description: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Human-readable summary",
      },
      enabled: {
        kind: "parsed",
        parse: parseBoolean("--enabled"),
        optional: true,
        brief: "Create enabled (default) or disabled",
      },
      dryRun: {
        kind: "boolean",
        brief: "Validate the rule without creating it",
        default: false,
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
  async func(this: void, flags: RedirectsCreateFlags) {
    await runCreateRedirectRule(flags);
  },
});

// ---------------------------------------------------------------------------
// redirects update
// ---------------------------------------------------------------------------

export interface RedirectsUpdateFlags {
  readonly expression?: string;
  readonly targetUrl?: string;
  readonly targetExpression?: string;
  readonly statusCode?: RedirectStatusCode;
  readonly preserveQueryString?: boolean;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runUpdateRedirectRule(
  ruleId: string,
  flags: RedirectsUpdateFlags,
  deps: RedirectsDeps = defaultDeps
): Promise<void> {
  try {
    const trimmed = ruleId.trim();
    if (trimmed.length === 0) {
      throw new Error("Rule ID is empty.");
    }

    const changed =
      flags.expression !== undefined ||
      flags.targetUrl !== undefined ||
      flags.targetExpression !== undefined ||
      flags.statusCode !== undefined ||
      flags.preserveQueryString !== undefined ||
      flags.description !== undefined ||
      flags.enabled !== undefined;
    if (!changed) {
      throw new Error(
        "Nothing to update. Pass --expression, --targetUrl, --targetExpression, --statusCode, --preserveQueryString, --description, or --enabled. Other fields keep their current values."
      );
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const rule = await client.updateRedirectRule(
      trimmed,
      {
        expression: flags.expression,
        targetUrl: flags.targetUrl,
        targetExpression: flags.targetExpression,
        statusCode: flags.statusCode,
        preserveQueryString: flags.preserveQueryString,
        description: flags.description,
        enabled: flags.enabled,
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

export const updateRedirectRuleCommand = buildCommand({
  docs: {
    brief: "Update a redirect rule (partial; unspecified fields keep their values)",
    customUsage: [
      "<rule-id> --statusCode 302",
      "<rule-id> --enabled false",
      "<rule-id> --expression 'http.request.uri.path eq \"/old\"' --targetUrl https://example.com/new",
    ],
  },
  parameters: {
    flags: {
      expression: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New rules language expression",
      },
      targetUrl: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New literal destination URL",
      },
      targetExpression: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New dynamic destination expression",
      },
      statusCode: {
        kind: "parsed",
        parse: parseStatusCode,
        optional: true,
        brief: `New redirect status code (${REDIRECT_STATUS_CODES.join("|")})`,
      },
      preserveQueryString: {
        kind: "parsed",
        parse: parseBoolean("--preserveQueryString"),
        optional: true,
        brief: "Preserve (true) or drop (false) the query string",
      },
      description: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New description",
      },
      enabled: {
        kind: "parsed",
        parse: parseBoolean("--enabled"),
        optional: true,
        brief: "Enable or disable the rule",
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
          brief: "Redirect rule ID (find it with `redirects list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: RedirectsUpdateFlags, ruleId: string) {
    await runUpdateRedirectRule(ruleId, flags);
  },
});

// ---------------------------------------------------------------------------
// redirects delete
// ---------------------------------------------------------------------------

export interface RedirectsDeleteFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runDeleteRedirectRule(
  ruleId: string,
  flags: RedirectsDeleteFlags,
  deps: RedirectsDeps = defaultDeps
): Promise<void> {
  try {
    const trimmed = ruleId.trim();
    if (trimmed.length === 0) {
      throw new Error("Rule ID is empty.");
    }

    if (!flags.yes) {
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to delete a redirect rule without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to delete redirect rule ${trimmed}. Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    await client.deleteRedirectRule(trimmed, flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify({ deleted: true, id: trimmed }, null, 2));
      return;
    }
    deps.log(`Deleted redirect rule ${trimmed}.`);
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const deleteRedirectRuleCommand = buildCommand({
  docs: {
    brief: "Delete a redirect rule",
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
          brief: "Redirect rule ID (find it with `redirects list`)",
          parse: String,
          placeholder: "rule-id",
        },
      ],
    },
  },
  async func(this: void, flags: RedirectsDeleteFlags, ruleId: string) {
    await runDeleteRedirectRule(ruleId, flags);
  },
});
