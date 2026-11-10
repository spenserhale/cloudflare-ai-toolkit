import { buildCommand } from "@stricli/core";
import {
  CloudflareClient,
  loadConfig,
  type LogExplorerDataset,
  type LogExplorerScope,
  describeError,
  type CloudflareConfig,
} from "@cloudflare-ai-toolkit/sdk";

export interface EnableDatasetFlags {
  readonly scope?: LogExplorerScope;
  readonly accountId?: string;
  readonly zoneId?: string;
  readonly json: boolean;
}

function parseScope(value: string): LogExplorerScope {
  if (value !== "account" && value !== "zone") {
    throw new Error(`Scope must be 'account' or 'zone', got '${value}'`);
  }
  return value;
}

interface EnableDatasetDeps {
  readonly loadConfig: () => Promise<CloudflareConfig>;
  readonly createClient: (config: CloudflareConfig) => Pick<
    CloudflareClient,
    "enableLogExplorerDataset"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
}

const defaultDeps: EnableDatasetDeps = {
  loadConfig,
  createClient: (config) => new CloudflareClient(config),
  log: console.log,
  error: console.error,
  exit: (code) => process.exit(code),
};


function formatError(err: unknown): string {
  return describeError(err);
}

function renderHuman(dataset: LogExplorerDataset): string {
  const lines = [
    `Dataset:    ${dataset.dataset}`,
    `Enabled:    ${dataset.enabled}`,
    `Scope:      ${dataset.object_type} ${dataset.object_id}`,
    `Dataset ID: ${dataset.dataset_id}`,
  ];
  if (dataset.created_at) lines.push(`Created:    ${dataset.created_at}`);
  if (dataset.updated_at) lines.push(`Updated:    ${dataset.updated_at}`);
  return lines.join("\n");
}

export async function runEnableLogExplorerDataset(
  dataset: string,
  flags: EnableDatasetFlags,
  deps: EnableDatasetDeps = defaultDeps
): Promise<void> {
  try {
    const datasetName = dataset.trim();
    if (datasetName.length === 0) {
      throw new Error("Dataset name is empty.");
    }
    const config = await deps.loadConfig();
    const client = deps.createClient(config);
    const result = await client.enableLogExplorerDataset(
      { dataset: datasetName, scope: flags.scope },
      { accountId: flags.accountId, zoneId: flags.zoneId }
    );

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
      return;
    }
    deps.log(renderHuman(result));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const enableLogExplorerDatasetCommand = buildCommand({
  docs: {
    brief: "Enable a Log Explorer dataset for the account or zone",
  },
  parameters: {
    flags: {
      scope: {
        kind: "parsed",
        parse: parseScope,
        optional: true,
        brief: "Target scope (account|zone). Defaults to zone if CLOUDFLARE_ZONE_ID is set, else account.",
      },
      accountId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Override CLOUDFLARE_ACCOUNT_ID",
      },
      zoneId: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Override CLOUDFLARE_ZONE_ID",
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
          brief: "Dataset name (e.g. http_requests, gateway_dns)",
          parse: String,
        },
      ],
    },
  },
  async func(this: void, flags: EnableDatasetFlags, dataset: string) {
    await runEnableLogExplorerDataset(dataset, flags);
  },
});
