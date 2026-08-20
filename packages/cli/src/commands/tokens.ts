import { buildCommand } from "@stricli/core";
import {
  checkTokenPermissions,
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  suggestPermissionNames,
  type ApiToken,
  type TokenPermission,
  type TokenPermissionCheck,
  type TokenPermissionGroup,
  type TokenPermissionsResult,
  type TokenVerificationResult,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface TokensDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "verifyToken"
    | "getApiToken"
    | "getTokenPermissions"
    | "listTokenPermissionGroups"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: TokensDeps = {
  resolveConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};

/**
 * Reading a token's own policies needs `API Tokens Read` on that token, which
 * most tokens are not issued with. Cloudflare reports the gap as a bare 403
 * code 9109, so spell out the fix rather than leaving the user to guess.
 */
const MISSING_INTROSPECTION_HINT =
  "This needs the 'User -> API Tokens -> Read' permission on the token itself.\n" +
  "Add it at https://dash.cloudflare.com/profile/api-tokens, or use `tokens verify`,\n" +
  "which reports status without listing permissions.";

function isForbidden(err: unknown): boolean {
  return (
    err instanceof CloudflareError &&
    (err.statusCode === 403 || err.code === "9109")
  );
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
  if (isForbidden(err)) {
    parts.push(MISSING_INTROSPECTION_HINT);
  }
  if (err.docsUrl) {
    parts.push(`Docs: ${err.docsUrl}`);
  }
  return parts.join("\n");
}

function orDash(value: string | null | undefined): string {
  if (value === undefined || value === null) return "-";
  return value.length > 0 ? value : "-";
}

function formatScope(permission: TokenPermission): string {
  return permission.scope === "unknown" ? "-" : permission.scope;
}

export function formatVerification(result: TokenVerificationResult): string {
  const lines = [
    `Token ${orDash(result.id)}`,
    `Status:      ${orDash(result.status)}`,
  ];
  if (result.not_before !== undefined) lines.push(`Not before:  ${result.not_before}`);
  if (result.expires_on !== undefined) lines.push(`Expires on:  ${result.expires_on}`);
  return lines.join("\n");
}

export function formatToken(token: ApiToken): string {
  const lines = [
    `Token ${orDash(token.id)}${token.name === undefined ? "" : ` (${token.name})`}`,
    `Status:       ${orDash(token.status)}`,
  ];
  if (token.issued_on !== undefined) lines.push(`Issued on:    ${token.issued_on}`);
  if (token.modified_on !== undefined) lines.push(`Modified on:  ${token.modified_on}`);
  if (token.not_before !== undefined) lines.push(`Not before:   ${token.not_before}`);
  if (token.expires_on !== undefined) lines.push(`Expires on:   ${token.expires_on}`);
  if (token.last_used_on !== undefined && token.last_used_on !== null) {
    lines.push(`Last used on: ${token.last_used_on}`);
  }
  lines.push(`Policies:     ${token.policies?.length ?? 0}`);
  return lines.join("\n");
}

export function formatPermissions(result: TokenPermissionsResult): string {
  const lines = [
    `Token ${orDash(result.tokenId)}${result.name === undefined ? "" : ` (${result.name})`}`,
    `Status: ${orDash(result.status)}`,
    "",
  ];

  if (result.permissions.length === 0) {
    lines.push("No permission groups on this token.");
    return lines.join("\n");
  }

  for (const permission of result.permissions) {
    const effect = permission.effect === "deny" ? "DENY " : "allow";
    lines.push(
      `${effect}  ${orDash(permission.name)}  [${formatScope(permission)}]  ${permission.id}`
    );
    for (const resource of permission.resources) {
      lines.push(`         ${resource}`);
    }
  }

  lines.push("", `${result.permissions.length} permission group(s).`);
  return lines.join("\n");
}

export function formatChecks(
  checks: readonly TokenPermissionCheck[],
  permissions: readonly TokenPermission[]
): string {
  const lines: string[] = [];
  for (const check of checks) {
    lines.push(`${check.granted ? "yes" : "NO "}  ${check.query}`);
    for (const match of check.matched) {
      const effect = match.effect === "deny" ? "denied by" : "granted by";
      lines.push(`     ${effect} ${orDash(match.name)} (${match.id})`);
      for (const resource of match.resources) {
        lines.push(`       on ${resource}`);
      }
    }
    if (!check.granted && check.matched.length === 0) {
      const suggestions = suggestPermissionNames(permissions, check.query);
      if (suggestions.length > 0) {
        lines.push(`     closest on this token: ${suggestions.join(", ")}`);
      }
    }
  }
  return lines.join("\n");
}

export function formatPermissionGroups(
  groups: readonly TokenPermissionGroup[]
): string {
  if (groups.length === 0) return "No permission groups matched.";

  const lines = groups.map((group) => {
    const scopes = group.scopes?.join(", ") ?? group.meta?.scopes ?? "-";
    return `${group.id}  ${orDash(group.name)}  [${scopes}]`;
  });
  lines.push("", `${groups.length} permission group(s).`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// tokens verify
// ---------------------------------------------------------------------------

export interface TokensVerifyFlags {
  readonly accountId?: string;
  readonly json: boolean;
}

export async function runVerifyToken(
  flags: TokensVerifyFlags,
  deps: TokensDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.verifyToken(flags.accountId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }
    deps.log(formatVerification(result));
    deps.log(
      "\nThis confirms the token is active but does not list its permissions.\nRun `tokens permissions` for that."
    );
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const verifyTokenCommand = buildCommand({
  docs: {
    brief: "Check that the configured API token is active",
    customUsage: ["", "--json", "--accountId <account-id>"],
  },
  parameters: {
    flags: {
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Verify an account-owned token instead of a user-owned one",
      },
      json: { kind: "boolean", brief: "Output as JSON", default: false },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async func(this: void, flags: TokensVerifyFlags) {
    await runVerifyToken(flags);
  },
});

// ---------------------------------------------------------------------------
// tokens show
// ---------------------------------------------------------------------------

export interface TokensShowFlags {
  readonly tokenId?: string;
  readonly accountId?: string;
  readonly json: boolean;
}

export async function runShowToken(
  flags: TokensShowFlags,
  deps: TokensDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const token = await client.getApiToken(flags.tokenId, flags.accountId);

    if (flags.json) {
      deps.log(JSON.stringify(token, null, 2));
      return;
    }
    deps.log(formatToken(token));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const showTokenCommand = buildCommand({
  docs: {
    brief: "Show an API token's details, including how many policies it carries",
    customUsage: ["", "--tokenId <token-id>", "--json"],
  },
  parameters: {
    flags: {
      tokenId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Token ID (defaults to the calling token, resolved via verify)",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Read an account-owned token instead of a user-owned one",
      },
      json: { kind: "boolean", brief: "Output as JSON", default: false },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async func(this: void, flags: TokensShowFlags) {
    await runShowToken(flags);
  },
});

// ---------------------------------------------------------------------------
// tokens permissions
// ---------------------------------------------------------------------------

export interface TokensPermissionsFlags {
  readonly tokenId?: string;
  readonly accountId?: string;
  readonly check?: readonly string[];
  readonly quiet: boolean;
  readonly json: boolean;
}

/**
 * Exit status follows grep's convention, because `--check` is used the same
 * way: 0 = every check granted, 1 = a check was definitively not granted,
 * 2 = the question could not be answered (no permission to introspect the
 * token, network failure, bad token). Collapsing 2 into 1 would tell a script
 * "you lack this permission" when the truth is "nobody could tell".
 */
const EXIT_NOT_GRANTED = 1;
const EXIT_UNDETERMINED = 2;

export async function runTokenPermissions(
  flags: TokensPermissionsFlags,
  deps: TokensDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.getTokenPermissions(flags.tokenId, flags.accountId);

    const queries = flags.check ?? [];
    if (queries.length === 0) {
      if (flags.json) {
        deps.log(JSON.stringify(result, null, 2));
        return;
      }
      deps.log(formatPermissions(result));
      return;
    }

    const checks = checkTokenPermissions(result.permissions, queries);
    const allGranted = checks.every((check) => check.granted);

    if (flags.json) {
      deps.log(JSON.stringify({ tokenId: result.tokenId, checks }, null, 2));
    } else if (!flags.quiet) {
      deps.log(formatChecks(checks, result.permissions));
    }

    // Exit status is the point of --check: it makes "can I do X" scriptable.
    if (!allGranted) deps.exit(EXIT_NOT_GRANTED);
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(EXIT_UNDETERMINED);
  }
}

export const tokenPermissionsCommand = buildCommand({
  docs: {
    brief: "List the permission groups on an API token, or check for specific ones",
    fullDescription:
      "List the permission groups on an API token, or check for specific ones.\n\n" +
      "With --check, the exit status follows grep's convention:\n" +
      "  0  every requested permission is granted\n" +
      "  1  at least one is definitively not granted\n" +
      "  2  the question could not be answered (the token cannot read its own\n" +
      "     permissions, or the request failed)\n\n" +
      "Reading a token's permissions requires 'User -> API Tokens -> Read' on the\n" +
      "token itself. `tokens verify` needs no extra permission but reports status only.",
    customUsage: [
      "",
      "--json",
      '--check "Zone:Config Rules:Edit"',
      '--check "Zone Read" --check "Logs Read" --quiet',
    ],
  },
  parameters: {
    flags: {
      tokenId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Token ID (defaults to the calling token, resolved via verify)",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Read an account-owned token instead of a user-owned one",
      },
      check: {
        kind: "parsed",
        parse: String,
        variadic: true,
        optional: true,
        brief:
          "Permission group name or ID to require; repeatable. Exits 1 unless every one is granted",
      },
      quiet: {
        kind: "boolean",
        brief: "With --check, report only via exit status",
        default: false,
      },
      json: { kind: "boolean", brief: "Output as JSON", default: false },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async func(this: void, flags: TokensPermissionsFlags) {
    await runTokenPermissions(flags);
  },
});

// ---------------------------------------------------------------------------
// tokens groups
// ---------------------------------------------------------------------------

export interface TokensGroupsFlags {
  readonly name?: string;
  readonly scope?: string;
  readonly accountId?: string;
  readonly json: boolean;
}

export async function runListPermissionGroups(
  flags: TokensGroupsFlags,
  deps: TokensDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const groups = await client.listTokenPermissionGroups({
      name: flags.name,
      scope: flags.scope,
      accountId: flags.accountId,
    });

    if (flags.json) {
      deps.log(JSON.stringify(groups, null, 2));
      return;
    }
    deps.log(formatPermissionGroups(groups));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listPermissionGroupsCommand = buildCommand({
  docs: {
    brief: "List the permission groups that can be assigned to a token",
    customUsage: [
      "",
      "--name Rules",
      "--scope com.cloudflare.api.account.zone --json",
    ],
  },
  parameters: {
    flags: {
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by permission group name",
      },
      scope: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief:
          "Filter by scope URN (com.cloudflare.api.user, .account, or .account.zone)",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "List account-owned token permission groups",
      },
      json: { kind: "boolean", brief: "Output as JSON", default: false },
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async func(this: void, flags: TokensGroupsFlags) {
    await runListPermissionGroups(flags);
  },
});
