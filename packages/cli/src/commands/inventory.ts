import { buildCommand } from "@stricli/core";
import { CloudflareClient, describeError, loadConfig, type CloudflareConfig } from "@cloudflare-ai-toolkit/sdk";

interface OutputFlags {
  readonly json: boolean;
}

interface ZoneFlags extends OutputFlags {
  readonly zoneId?: string;
}

interface ScopedFlags extends ZoneFlags {
  readonly scope: "zone" | "account";
  readonly accountId?: string;
}

interface RulesetsListFlags extends ScopedFlags {
  readonly cursor?: string;
  readonly perPage?: number;
  readonly all: boolean;
}

interface RulesetGetFlags extends ScopedFlags {
  readonly version?: string;
}

interface WorkerDomainsFlags extends ZoneFlags {
  readonly accountId?: string;
}

interface InventoryDeps {
  readonly loadConfig: () => Promise<CloudflareConfig>;
  readonly createClient: (config: CloudflareConfig) => Pick<CloudflareClient, "inventory">;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: InventoryDeps = {
  loadConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};

const jsonFlag = { kind: "boolean", brief: "Output as JSON", default: false } as const;
const zoneIdFlag = {
  kind: "parsed", parse: String, optional: true,
  brief: "Zone ID (defaults to CLOUDFLARE_ZONE_ID)",
} as const;
const accountIdFlag = {
  kind: "parsed", parse: String, optional: true,
  brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID)",
} as const;
const zoneFlags = { zoneId: zoneIdFlag, json: jsonFlag } as const;

function parseScope(value: string): ScopedFlags["scope"] {
  if (value === "zone" || value === "account") return value;
  throw new Error(`Scope must be zone|account, got '${value}'`);
}

function parsePerPage(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error(`--per-page must be an integer in 1-50, got '${value}'`);
  }
  return parsed;
}

const scopedFlags = {
  scope: { kind: "parsed", parse: parseScope, brief: "Required target scope (zone|account)" },
  zoneId: zoneIdFlag,
  accountId: accountIdFlag,
  json: jsonFlag,
} as const;

function validateScope(flags: ScopedFlags): void {
  if (flags.scope === "zone" && flags.accountId !== undefined) {
    throw new Error("--account-id conflicts with --scope zone; use --zone-id.");
  }
  if (flags.scope === "account" && flags.zoneId !== undefined) {
    throw new Error("--zone-id conflicts with --scope account; use --account-id.");
  }
}

function target(flags: ScopedFlags) {
  return flags.scope === "zone"
    ? { scope: "zone" as const, zoneId: flags.zoneId }
    : { scope: "account" as const, accountId: flags.accountId };
}

async function runRead<T>(
  flags: OutputFlags,
  label: string,
  read: (inventory: CloudflareClient["inventory"]) => Promise<T>,
  deps: InventoryDeps = defaultDeps,
  validate?: () => void,
): Promise<void> {
  try {
    validate?.();
    const config = await deps.loadConfig();
    const result = await read(deps.createClient(config).inventory);
    if (!flags.json) deps.log(label);
    deps.log(JSON.stringify(result, null, 2));
  } catch (err) {
    deps.error(`Error: ${describeError(err)}`);
    deps.exit(1);
  }
}

export async function runListRulesets(flags: RulesetsListFlags, deps: InventoryDeps = defaultDeps): Promise<void> {
  await runRead(flags, "Rulesets inventory", async (inventory) => {
    const result = await inventory.listRulesets(target(flags), {
      cursor: flags.cursor, perPage: flags.perPage, all: flags.all,
    });
    if (result.truncated) {
      const cursor = result.resultInfo.cursors?.after;
      deps.error(`More rulesets are available. Continue with --cursor ${cursor ?? "<next-cursor>"} or use --all.`);
    }
    return result;
  }, deps, () => validateScope(flags));
}

export const listRulesetsCommand = buildCommand({
  docs: { brief: "List Rulesets metadata in an explicit zone or account scope" },
  parameters: {
    flags: {
      ...scopedFlags,
      cursor: { kind: "parsed", parse: String, optional: true, brief: "Continuation cursor from resultInfo.cursors.after" },
      perPage: { kind: "parsed", parse: parsePerPage, optional: true, brief: "Rulesets per page (1-50)" },
      all: { kind: "boolean", default: false, brief: "Read every page, following continuation cursors" },
    },
  },
  async func(this: void, flags: RulesetsListFlags) { await runListRulesets(flags); },
});

export const getRulesetCommand = buildCommand({
  docs: { brief: "Read a full Ruleset and its ordered native rule parameters" },
  parameters: {
    flags: {
      ...scopedFlags,
      version: { kind: "parsed", parse: String, optional: true, brief: "Read a pinned Ruleset version" },
    },
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Ruleset ID", parse: String, placeholder: "ruleset-id" }],
    },
  },
  async func(this: void, flags: RulesetGetFlags, id: string) {
    await runRead(flags, "Ruleset detail", (inventory) => inventory.getRuleset(id, target(flags), flags.version), defaultDeps, () => validateScope(flags));
  },
});

export const getPhaseEntrypointCommand = buildCommand({
  docs: { brief: "Read a phase entrypoint; a missing entrypoint is explicitly absent" },
  parameters: {
    flags: scopedFlags,
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Ruleset Engine phase, such as http_request_origin", parse: String, placeholder: "phase" }],
    },
  },
  async func(this: void, flags: ScopedFlags, phase: string) {
    await runRead(flags, `Phase entrypoint ${phase}`, (inventory) => inventory.getPhaseEntrypoint(phase, target(flags)), defaultDeps, () => validateScope(flags));
  },
});

export const getZoneSettingCommand = buildCommand({
  docs: { brief: "Read one zone setting by ID" },
  parameters: {
    flags: zoneFlags,
    positional: {
      kind: "tuple",
      parameters: [{ brief: "Setting ID, such as ssl or always_use_https", parse: String, placeholder: "setting-id" }],
    },
  },
  async func(this: void, flags: ZoneFlags, id: string) {
    await runRead(flags, `Zone setting ${id}`, (inventory) => inventory.getZoneSetting(id, flags.zoneId));
  },
});

export const getBotManagementCommand = buildCommand({
  docs: { brief: "Read Bot Management settings for a zone" },
  parameters: { flags: zoneFlags },
  async func(this: void, flags: ZoneFlags) {
    await runRead(flags, "Bot Management settings", (inventory) => inventory.getBotManagement(flags.zoneId));
  },
});

export const listWorkerRoutesCommand = buildCommand({
  docs: { brief: "List Worker routes and attached scripts for a zone" },
  parameters: { flags: zoneFlags },
  async func(this: void, flags: ZoneFlags) {
    await runRead(flags, "Worker routes", (inventory) => inventory.listWorkerRoutes(flags.zoneId));
  },
});

export const listWorkerDomainsCommand = buildCommand({
  docs: { brief: "List account Worker custom domains, optionally filtered by zone" },
  parameters: {
    flags: {
      accountId: accountIdFlag,
      zoneId: { ...zoneIdFlag, brief: "Optional zone filter; does not use CLOUDFLARE_ZONE_ID" },
      json: jsonFlag,
    },
  },
  async func(this: void, flags: WorkerDomainsFlags) {
    await runRead(flags, "Worker custom domains (account scope)", (inventory) => inventory.listWorkerDomains({ accountId: flags.accountId, zoneId: flags.zoneId }));
  },
});

export const listPageRulesCommand = buildCommand({
  docs: { brief: "List Page Rules with targets, actions, and evaluation order" },
  parameters: { flags: zoneFlags },
  async func(this: void, flags: ZoneFlags) {
    await runRead(flags, "Page Rules", (inventory) => inventory.listPageRules(flags.zoneId));
  },
});

export const getManagedTransformsCommand = buildCommand({
  docs: { brief: "Read managed request and response header transforms" },
  parameters: { flags: zoneFlags },
  async func(this: void, flags: ZoneFlags) {
    await runRead(flags, "Managed transforms", (inventory) => inventory.getManagedTransforms(flags.zoneId));
  },
});

export const getUrlNormalizationCommand = buildCommand({
  docs: { brief: "Read URL normalization settings for a zone" },
  parameters: { flags: zoneFlags },
  async func(this: void, flags: ZoneFlags) {
    await runRead(flags, "URL normalization settings", (inventory) => inventory.getUrlNormalization(flags.zoneId));
  },
});
