import { buildCommand } from "@stricli/core";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  CloudflareClient,
  CloudflareError,
  prepareDomainRegistration,
  RegistrationContactSchema,
  RegistrationContactsSchema,
  loadConfig,
  waitForRegistration,
  type DomainAvailability,
  type DomainRegistration,
  type PrivacyMode,
  type RegistrationContacts,
  type RegistrationWorkflowStatus,
  describeError,
  type CloudflareConfig,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

type RegistrarClient = Pick<
  CloudflareClient,
  | "searchDomains"
  | "checkDomains"
  | "registerDomain"
  | "getRegistrationStatus"
  | "getRegistration"
  | "listRegistrations"
>;

export interface RegistrarDeps {
  readonly loadConfig: () => Promise<CloudflareConfig>;
  readonly createClient: (config: CloudflareConfig) => RegistrarClient;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
  /** Injectable so tests do not wait between status polls. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultDeps: RegistrarDeps = {
  loadConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm: async (prompt) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(prompt);
      // Spending money takes the full word, not just "y".
      return answer.trim().toLowerCase() === "yes";
    } finally {
      rl.close();
    }
  },
};

function formatError(err: unknown): string {
  return describeError(err);
}

function orDash(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return "-";
  const text = String(value);
  return text.length > 0 ? text : "-";
}

function parsePositiveInt(value: string): number {
  const parsed = /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

function parseRange(min: number, max: number, label: string) {
  return (value: string): number => {
    const parsed = parsePositiveInt(value);
    if (parsed < min || parsed > max) {
      throw new Error(`${label} must be between ${min} and ${max}, got '${value}'`);
    }
    return parsed;
  };
}

function parsePrice(value: string): string {
  if (!/^\d+(\.\d{1,6})?$/u.test(value.trim())) {
    throw new Error(`Expected a decimal amount like 10 or 10.50, got '${value}'`);
  }
  return value.trim();
}

function parsePrivacyMode(value: string): PrivacyMode {
  if (value === "off" || value === "redaction") return value;
  throw new Error(`Privacy mode must be 'off' or 'redaction', got '${value}'`);
}

/**
 * Reads a contacts JSON file: either a full `{ registrant, administrator, ... }`
 * object or a single contact, which becomes the registrant.
 */
export function parseContactFile(path: string): RegistrationContacts {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Could not read contact JSON from '${path}': ${err instanceof Error ? err.message : String(err)}`);
  }
  const roles = ["registrant", "administrator", "technical", "billing"];
  const isRoleMap =
    typeof raw === "object" && raw !== null && roles.some((role) => role in raw);
  const parsed = isRoleMap
    ? RegistrationContactsSchema.safeParse(raw)
    : RegistrationContactSchema.transform((registrant) => ({ registrant })).safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid contact in '${path}': ${issues}`);
  }
  return parsed.data;
}

function parseExtensions(value: string): string[] {
  return value
    .split(",")
    .map((ext) => ext.trim().replace(/^\./u, ""))
    .filter((ext) => ext.length > 0);
}

/** `9.77 USD (renews 11.20)`, or `-` when Cloudflare returned no price. */
function formatPrice(domain: DomainAvailability): string {
  const pricing = domain.pricing;
  if (!pricing) return "-";
  const renew =
    pricing.renewal_cost === pricing.registration_cost ? "" : ` (renews ${pricing.renewal_cost})`;
  return `${pricing.registration_cost} ${pricing.currency}${renew}`;
}

/** One search/check row: name, availability, then price or the reason it is blocked. */
export function formatAvailabilityLine(domain: DomainAvailability): string {
  if (!domain.registrable) {
    return `${domain.name}  unavailable  ${orDash(domain.reason)}`;
  }
  const tier = domain.tier && domain.tier !== "standard" ? `  tier=${domain.tier}` : "";
  return `${domain.name}  available  ${formatPrice(domain)}${tier}`;
}

function formatRegistration(registration: DomainRegistration): string[] {
  return [
    `Domain:     ${registration.domain_name}`,
    `Status:     ${registration.status}`,
    `Created:    ${orDash(registration.created_at)}`,
    `Expires:    ${orDash(registration.expires_at)}`,
    `Auto-renew: ${orDash(registration.auto_renew)}`,
    `Privacy:    ${orDash(registration.privacy_mode)}`,
    `Locked:     ${orDash(registration.locked)}`,
  ];
}

/** Human-readable workflow status, including any error or required action. */
export function formatWorkflowStatus(status: RegistrationWorkflowStatus): string {
  const lines = [
    `Domain:    ${orDash(status.domain_name)}`,
    `State:     ${status.state}${status.completed ? " (completed)" : ""}`,
    `Updated:   ${orDash(status.updated_at)}`,
  ];
  if (status.error) {
    lines.push(`Error:     ${status.error.code}: ${status.error.message}`);
  }
  const registration = status.context?.registration;
  if (registration) {
    lines.push("", ...formatRegistration(registration));
  }
  return lines.join("\n");
}

/** Exit code for a finished workflow: 0 succeeded or still running, 1 otherwise. */
function workflowExitCode(status: RegistrationWorkflowStatus): number {
  return status.state === "failed" ||
    status.state === "blocked" ||
    status.state === "action_required"
    ? 1
    : 0;
}

function workflowAdvice(status: RegistrationWorkflowStatus, sandboxFlag: string): string | undefined {
  switch (status.state) {
    case "action_required":
      return "Cloudflare needs action before this registration can finish. Check the domain in the dashboard: https://dash.cloudflare.com/?to=/:account/domains/registrations";
    case "blocked":
      return "The registration is blocked. Check the account's billing profile, default registrant contact, and the Domain Registration Agreement in the dashboard.";
    case "failed":
      return "The registration failed. Read the error above before retrying.";
    case "pending":
    case "in_progress":
      return `Still processing. Do not re-run register; check progress with: cloudflare registrar status ${orDash(status.domain_name)}${sandboxFlag} --wait`;
    default:
      return undefined;
  }
}

interface TargetFlags {
  readonly accountId?: string;
  readonly sandbox: boolean;
  readonly json: boolean;
}

const targetFlagDefs = {
  accountId: {
    kind: "parsed",
    parse: String,
    optional: true,
    brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
  },
  sandbox: {
    kind: "boolean",
    brief: "Use Cloudflare's non-billing Registrar sandbox",
    default: false,
  },
  json: {
    kind: "boolean",
    brief: "Output as JSON",
    default: false,
  },
} as const;

async function withClient(
  deps: RegistrarDeps,
  action: (client: RegistrarClient) => Promise<void>
): Promise<void> {
  try {
    const client = deps.createClient(await deps.loadConfig());
    await action(client);
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

// ---------------------------------------------------------------------------
// registrar search
// ---------------------------------------------------------------------------

export interface RegistrarSearchFlags extends TargetFlags {
  readonly extensions?: string[];
  readonly limit?: number;
}

export async function runRegistrarSearch(
  query: string,
  flags: RegistrarSearchFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  await withClient(deps, async (client) => {
    const result = await client.searchDomains({
      query,
      extensions: flags.extensions,
      limit: flags.limit,
      accountId: flags.accountId,
      sandbox: flags.sandbox,
    });

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }
    if (result.domains.length === 0) {
      deps.log(`No suggestions for '${query}'.`);
      return;
    }
    for (const domain of result.domains) deps.log(formatAvailabilityLine(domain));
    deps.log(
      "\nSearch uses cached data. Confirm with `cloudflare registrar check <domain>` before registering."
    );
  });
}

export const registrarSearchCommand = buildCommand({
  docs: {
    brief: "Suggest available domain names for a keyword or phrase",
    customUsage: ["\"acme corp\"", "acme --extensions com,dev --limit 10"],
  },
  parameters: {
    flags: {
      extensions: {
        kind: "parsed",
        parse: parseExtensions,
        optional: true,
        brief: "Comma-separated extensions to limit suggestions to (e.g. com,dev)",
      },
      limit: {
        kind: "parsed",
        parse: parseRange(1, 50, "Limit"),
        optional: true,
        brief: "Maximum suggestions (1-50, default 20)",
      },
      ...targetFlagDefs,
    },
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Keyword, phrase, or partial domain", parse: String, placeholder: "query" }],
    },
  },
  async func(this: void, flags: RegistrarSearchFlags, query: string) {
    await runRegistrarSearch(query, flags);
  },
});

// ---------------------------------------------------------------------------
// registrar check
// ---------------------------------------------------------------------------

export async function runRegistrarCheck(
  domains: readonly string[],
  flags: TargetFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  if (domains.length > 20) {
    deps.error("Error: Check accepts at most 20 domains per call.");
    deps.exit(1);
    return;
  }
  await withClient(deps, async (client) => {
    const result = await client.checkDomains({
      domains: domains.map((d) => d.trim().toLowerCase()),
      accountId: flags.accountId,
      sandbox: flags.sandbox,
    });

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }
    for (const domain of result.domains) deps.log(formatAvailabilityLine(domain));
  });
}

export const registrarCheckCommand = buildCommand({
  docs: {
    brief: "Check real-time availability and price for up to 20 domains",
    customUsage: ["acmecorp.dev", "acmecorp.com acmecorp.dev acmecorp.app --json"],
  },
  parameters: {
    flags: targetFlagDefs,
    positional: {
      kind: "array",
      parameter: { brief: "Domain names", parse: String, placeholder: "domain" },
      minimum: 1,
    },
  },
  async func(this: void, flags: TargetFlags, ...domains: string[]) {
    await runRegistrarCheck(domains, flags);
  },
});

// ---------------------------------------------------------------------------
// registrar register
// ---------------------------------------------------------------------------

export interface RegistrarRegisterFlags extends TargetFlags {
  readonly maxPrice?: string;
  readonly years?: number;
  readonly autoRenew: boolean;
  readonly privacy?: PrivacyMode;
  readonly contact?: RegistrationContacts;
  readonly yes: boolean;
  readonly noWait: boolean;
  readonly timeout?: number;
}

export async function runRegistrarRegister(
  domain: string,
  flags: RegistrarRegisterFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  const sandboxFlag = flags.sandbox ? " --sandbox" : "";

  await withClient(deps, async (client) => {
    // A fresh registry check gates every purchase: availability, tier, price limit.
    const assessment = await prepareDomainRegistration(client, domain, {
      accountId: flags.accountId,
      sandbox: flags.sandbox,
      maxRegistrationCost: flags.maxPrice,
    });

    if (!assessment.ok) {
      deps.error(`Error: Not registering. ${assessment.message}`);
      deps.exit(1);
      return;
    }

    const { pricing } = assessment;
    const summary = [
      flags.sandbox
        ? "Registrar SANDBOX: no charge will be made."
        : "This is a billable, non-refundable purchase charged to the account's default payment method.",
      "",
      `Domain:     ${assessment.domain}`,
      `Price:      ${pricing.registration_cost} ${pricing.currency}`,
      `Renewal:    ${pricing.renewal_cost} ${pricing.currency}`,
      `Term:       ${flags.years === undefined ? "registry minimum (usually 1 year)" : `${flags.years} year(s)`}`,
      `Auto-renew: ${flags.autoRenew ? "on (renewals will be charged)" : "off"}`,
      `Privacy:    ${flags.privacy ?? "redaction (default)"}`,
      `Registrant: ${
        flags.contact?.registrant
          ? `${flags.contact.registrant.postal_info.name} <${flags.contact.registrant.email}>`
          : "account default contact"
      }`,
    ];
    if (flags.years !== undefined && flags.years > 1) {
      summary.push(
        "",
        "Note: the price above is Cloudflare's quoted registration cost; a multi-year term can cost more."
      );
    }
    // In --json mode keep stdout parseable and put the summary on stderr.
    const show = flags.json ? deps.error : deps.log;
    for (const line of summary) show(line);

    if (!flags.yes) {
      if (!deps.isTTY()) {
        deps.error(
          "Error: Refusing to register without confirmation. Pass --yes to proceed non-interactively."
        );
        deps.exit(1);
        return;
      }
      const confirmed = await deps.confirm(
        `\nRegister ${assessment.domain} for ${pricing.registration_cost} ${pricing.currency}? Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.log("Aborted. Nothing was registered.");
        return;
      }
    }

    let status = await client.registerDomain({
      domainName: assessment.domain,
      years: flags.years,
      autoRenew: flags.autoRenew ? true : undefined,
      privacyMode: flags.privacy,
      contacts: flags.contact,
      accountId: flags.accountId,
      sandbox: flags.sandbox,
      respondAsync: flags.noWait ? true : undefined,
    });

    let timedOut = false;
    if (!status.completed && !flags.noWait) {
      show(`\nRegistration started (${status.state}); waiting for it to finish...`);
      const waited = await waitForRegistration(client, assessment.domain, {
        accountId: flags.accountId,
        sandbox: flags.sandbox,
        timeoutMs: (flags.timeout ?? 120) * 1000,
        sleep: deps.sleep,
      });
      status = waited.status;
      timedOut = waited.timedOut;
    }

    // The live API does not embed the registration in the workflow; fetch it.
    let registration = status.context?.registration;
    if (status.state === "succeeded" && registration === undefined) {
      registration = await client
        .getRegistration(assessment.domain, { accountId: flags.accountId, sandbox: flags.sandbox })
        .catch(() => undefined);
    }

    if (flags.json) {
      deps.log(JSON.stringify({ ...status, timedOut, registration }, null, 2));
    } else {
      deps.log("");
      deps.log(formatWorkflowStatus(status));
      if (registration && status.context?.registration === undefined) {
        deps.log("");
        for (const line of formatRegistration(registration)) deps.log(line);
      }
    }

    const advice = workflowAdvice(status, sandboxFlag);
    if (advice) (flags.json ? deps.error : deps.log)(`\n${advice}`);

    const code = workflowExitCode(status);
    if (code !== 0) deps.exit(code);
  });
}

export const registrarRegisterCommand = buildCommand({
  docs: {
    brief: "Register (purchase) a domain after a fresh availability and price check",
    fullDescription: [
      "Runs a real-time availability check, prints the price, and asks you to type 'yes'",
      "before registering. Outside --sandbox this charges the account's default payment",
      "method and is non-refundable. Uses the account's default registrant contact.",
      "",
      "Use --maxPrice to refuse automatically if the quoted price is higher than expected,",
      "and --yes to skip the prompt in scripts.",
    ].join("\n"),
    customUsage: [
      "acmecorp.dev",
      "acmecorp.dev --maxPrice 12 --yes",
      "acmecorp.dev --sandbox",
    ],
  },
  parameters: {
    flags: {
      maxPrice: {
        kind: "parsed",
        parse: parsePrice,
        optional: true,
        brief: "Refuse if the quoted registration cost exceeds this amount",
      },
      years: {
        kind: "parsed",
        parse: parseRange(1, 10, "Years"),
        optional: true,
        brief: "Registration term in years (1-10; defaults to the registry minimum)",
      },
      autoRenew: {
        kind: "boolean",
        brief: "Enable auto-renew (authorizes renewal charges)",
        default: false,
      },
      privacy: {
        kind: "parsed",
        parse: parsePrivacyMode,
        optional: true,
        brief: "WHOIS privacy: redaction (default) or off",
      },
      contact: {
        kind: "parsed",
        parse: parseContactFile,
        optional: true,
        brief: "JSON file with the registrant contact (or a {registrant, ...} map); defaults to the account's default contact",
      },
      yes: {
        kind: "boolean",
        brief: "Skip the confirmation prompt",
        default: false,
      },
      noWait: {
        kind: "boolean",
        brief: "Return immediately instead of waiting for the registration to finish",
        default: false,
      },
      timeout: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Seconds to wait for completion (default 120)",
      },
      ...targetFlagDefs,
    },
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Domain name to register", parse: String, placeholder: "domain" }],
    },
  },
  async func(this: void, flags: RegistrarRegisterFlags, domain: string) {
    await runRegistrarRegister(domain, flags);
  },
});

// ---------------------------------------------------------------------------
// registrar status
// ---------------------------------------------------------------------------

export interface RegistrarStatusFlags extends TargetFlags {
  readonly wait: boolean;
  readonly timeout?: number;
}

export async function runRegistrarStatus(
  domain: string,
  flags: RegistrarStatusFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  const name = domain.trim().toLowerCase();
  await withClient(deps, async (client) => {
    try {
      await reportRegistrationStatus(client, name, flags, deps);
    } catch (err) {
      if (err instanceof CloudflareError && /no workflow found/iu.test(err.message)) {
        throw new Error(
          `${err.message}. Status only tracks registrations started through the API; use \`cloudflare registrar get ${name}\` for an existing domain.`
        );
      }
      throw err;
    }
  });
}

async function reportRegistrationStatus(
  client: RegistrarClient,
  name: string,
  flags: RegistrarStatusFlags,
  deps: RegistrarDeps
): Promise<void> {
  const target = { accountId: flags.accountId, sandbox: flags.sandbox };
  let timedOut = false;
  let status: RegistrationWorkflowStatus;
  if (flags.wait) {
    const waited = await waitForRegistration(client, name, {
      ...target,
      timeoutMs: (flags.timeout ?? 120) * 1000,
      sleep: deps.sleep,
    });
    status = waited.status;
    timedOut = waited.timedOut;
  } else {
    status = await client.getRegistrationStatus(name, target);
  }

  if (flags.json) {
    deps.log(JSON.stringify(flags.wait ? { ...status, timedOut } : status, null, 2));
  } else {
    deps.log(formatWorkflowStatus(status));
    const advice = workflowAdvice(status, flags.sandbox ? " --sandbox" : "");
    if (advice) deps.log(`\n${advice}`);
  }

  const code = workflowExitCode(status);
  if (code !== 0) deps.exit(code);
}

export const registrarStatusCommand = buildCommand({
  docs: {
    brief: "Show a domain registration workflow's state",
    customUsage: ["acmecorp.dev", "acmecorp.dev --wait --timeout 300"],
  },
  parameters: {
    flags: {
      wait: {
        kind: "boolean",
        brief: "Poll until the workflow finishes",
        default: false,
      },
      timeout: {
        kind: "parsed",
        parse: parsePositiveInt,
        optional: true,
        brief: "Seconds to wait with --wait (default 120)",
      },
      ...targetFlagDefs,
    },
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Domain name", parse: String, placeholder: "domain" }],
    },
  },
  async func(this: void, flags: RegistrarStatusFlags, domain: string) {
    await runRegistrarStatus(domain, flags);
  },
});

// ---------------------------------------------------------------------------
// registrar get
// ---------------------------------------------------------------------------

export async function runRegistrarGet(
  domain: string,
  flags: TargetFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  await withClient(deps, async (client) => {
    const registration = await client.getRegistration(domain.trim().toLowerCase(), {
      accountId: flags.accountId,
      sandbox: flags.sandbox,
    });
    if (flags.json) {
      deps.log(JSON.stringify(registration, null, 2));
      return;
    }
    for (const line of formatRegistration(registration)) deps.log(line);
  });
}

export const registrarGetCommand = buildCommand({
  docs: {
    brief: "Show a domain registered to the account",
    customUsage: ["acmecorp.dev", "acmecorp.dev --json"],
  },
  parameters: {
    flags: targetFlagDefs,
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Domain name", parse: String, placeholder: "domain" }],
    },
  },
  async func(this: void, flags: TargetFlags, domain: string) {
    await runRegistrarGet(domain, flags);
  },
});

// ---------------------------------------------------------------------------
// registrar list
// ---------------------------------------------------------------------------

type RegistrationSort = "registry_created_at" | "registry_expires_at" | "name";

export interface RegistrarListFlags extends TargetFlags {
  readonly cursor?: string;
  readonly perPage?: number;
  readonly sort?: RegistrationSort;
  readonly desc: boolean;
  readonly all: boolean;
}

function parseSort(value: string): RegistrationSort {
  if (value === "created") return "registry_created_at";
  if (value === "expires") return "registry_expires_at";
  if (value === "name") return "name";
  throw new Error(`Sort must be one of created|expires|name, got '${value}'`);
}

export async function runRegistrarList(
  flags: RegistrarListFlags,
  deps: RegistrarDeps = defaultDeps
): Promise<void> {
  await withClient(deps, async (client) => {
    const registrations: DomainRegistration[] = [];
    let cursor = flags.cursor;
    let nextCursor: string | undefined;
    do {
      const page = await client.listRegistrations({
        cursor,
        perPage: flags.perPage,
        sortBy: flags.sort,
        direction: flags.desc ? "desc" : undefined,
        accountId: flags.accountId,
        sandbox: flags.sandbox,
      });
      registrations.push(...page.registrations);
      nextCursor = page.nextCursor;
      cursor = nextCursor;
    } while (flags.all && nextCursor !== undefined);

    if (flags.json) {
      deps.log(JSON.stringify({ registrations, nextCursor }, null, 2));
      return;
    }
    if (registrations.length === 0) {
      deps.log("No domain registrations.");
      return;
    }
    for (const r of registrations) {
      deps.log(
        `${r.domain_name}  ${r.status}  expires=${orDash(r.expires_at)} auto_renew=${orDash(r.auto_renew)}`
      );
    }
    if (nextCursor !== undefined) {
      deps.log(`\nMore registrations available: --cursor ${nextCursor} (or --all)`);
    }
  });
}

export const registrarListCommand = buildCommand({
  docs: {
    brief: "List domains registered to the account",
    customUsage: ["", "--sort expires --all", "--perPage 50 --cursor <cursor>"],
  },
  parameters: {
    flags: {
      cursor: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Cursor from a previous page",
      },
      perPage: {
        kind: "parsed",
        parse: parseRange(1, 50, "Items per page"),
        optional: true,
        brief: "Items per page (1-50, default 20)",
      },
      sort: {
        kind: "parsed",
        parse: parseSort,
        optional: true,
        brief: "Sort by created|expires|name",
      },
      desc: {
        kind: "boolean",
        brief: "Sort descending",
        default: false,
      },
      all: {
        kind: "boolean",
        brief: "Fetch every page",
        default: false,
      },
      ...targetFlagDefs,
    },
    positional: { kind: "tuple", parameters: [] },
  },
  async func(this: void, flags: RegistrarListFlags) {
    await runRegistrarList(flags);
  },
});
