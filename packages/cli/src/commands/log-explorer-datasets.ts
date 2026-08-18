import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
  type AvailableLogExplorerDataset,
  type LogExplorerDataset,
  type LogExplorerDatasetField,
  type LogExplorerScope,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

function parseScope(value: string): LogExplorerScope {
  if (value !== "account" && value !== "zone") {
    throw new Error(`Scope must be 'account' or 'zone', got '${value}'`);
  }
  return value;
}

function parseBoolean(flagName: string): (value: string) => boolean {
  return (value: string) => {
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error(`${flagName} must be 'true' or 'false', got '${value}'`);
  };
}

function parseFieldList(value: string): [LogExplorerDatasetField, ...LogExplorerDatasetField[]] {
  const fields = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((name) => ({ name, enabled: true }));

  const [first, ...rest] = fields;
  if (first === undefined) {
    throw new Error(
      `Fields must be a comma-separated list of field names, e.g. --fields ClientIP,EdgeResponseStatus (got '${value}')`
    );
  }
  return [first, ...rest];
}

interface DatasetDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "listLogExplorerDatasets"
    | "listAvailableLogExplorerDatasets"
    | "getLogExplorerDataset"
    | "updateLogExplorerDataset"
    | "deleteLogExplorerDataset"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: DatasetDeps = {
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

function formatPermissionHint(err: unknown): string | undefined {
  if (!(err instanceof CloudflareError)) return undefined;
  if (!err.requiredPermissions || err.requiredPermissions.length === 0) return undefined;
  const clause =
    err.requiredPermissions.length === 1
      ? `'${err.requiredPermissions[0]}'`
      : err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
  const docs = err.docsUrl ? ` Docs: ${err.docsUrl}` : "";
  return `Required permission for this endpoint: ${clause}.${docs}`;
}

function formatError(err: unknown): string {
  const base =
    err instanceof CloudflareAuthError
      ? `Authentication failed: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  const hint = formatPermissionHint(err);
  return hint ? `${base}\n${hint}` : base;
}

function orDash(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return "-";
  const text = String(value);
  return text.length > 0 ? text : "-";
}

interface DatasetScopeFlags {
  readonly scope?: LogExplorerScope;
  readonly accountId?: string;
  readonly zoneId?: string;
  readonly json: boolean;
}

function scopeOverrides(flags: DatasetScopeFlags): { accountId?: string; zoneId?: string } {
  return { accountId: flags.accountId, zoneId: flags.zoneId };
}

function formatDatasetLine(dataset: LogExplorerDataset): string {
  const fields = [
    `enabled=${dataset.enabled}`,
    `${dataset.object_type}/${dataset.object_id}`,
  ];
  if (dataset.deletion_protection !== undefined) {
    fields.push(`protected=${dataset.deletion_protection}`);
  }
  return `${dataset.dataset_id}  ${dataset.dataset}  ${fields.join(" ")}`;
}

function formatDatasetDetails(dataset: LogExplorerDataset): string {
  const lines = [
    `Dataset:      ${dataset.dataset}`,
    `Dataset ID:   ${dataset.dataset_id}`,
    `Enabled:      ${dataset.enabled}`,
    `Scope:        ${dataset.object_type} ${dataset.object_id}`,
  ];
  if (dataset.deletion_protection !== undefined) {
    lines.push(`Deletion protected: ${dataset.deletion_protection}`);
  }
  if (dataset.filter !== undefined) {
    lines.push(`Filter:       ${orDash(dataset.filter)}`);
  }
  const fields = dataset.fields;
  if (fields && fields.length > 0) {
    const enabledFields = fields.filter((f) => f.enabled);
    lines.push(`Fields:       ${enabledFields.length} of ${fields.length} enabled`);
    for (const field of fields) {
      lines.push(`  ${field.enabled ? "*" : " "} ${field.name}`);
    }
  }
  if (dataset.created_at) lines.push(`Created:      ${dataset.created_at}`);
  if (dataset.updated_at) lines.push(`Updated:      ${dataset.updated_at}`);
  return lines.join("\n");
}

function formatAvailableLine(dataset: AvailableLogExplorerDataset): string {
  const fieldCount = dataset.schema?.properties
    ? Object.keys(dataset.schema.properties).length
    : undefined;
  const fields =
    fieldCount === undefined ? "" : `  fields=${fieldCount}`;
  return `${dataset.dataset}  ${dataset.object_type}  timestamp=${dataset.timestamp_field}${fields}`;
}

// ---------------------------------------------------------------------------
// datasets list
// ---------------------------------------------------------------------------

export interface ListDatasetsFlags extends DatasetScopeFlags {
  readonly includeZones: boolean;
}

export async function runListLogExplorerDatasets(
  flags: ListDatasetsFlags,
  deps: DatasetDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const datasets = await client.listLogExplorerDatasets(
      { scope: flags.scope, includeZones: flags.includeZones },
      scopeOverrides(flags)
    );

    if (flags.json) {
      deps.log(JSON.stringify(datasets, null, 2));
      return;
    }

    const noun = datasets.length === 1 ? "dataset" : "datasets";
    deps.log(`Showing ${datasets.length} ${noun}\n`);
    if (datasets.length === 0) {
      deps.log(
        "No datasets configured. Enable one with `cloudflare log-explorer datasets enable <dataset>`, or see what exists with `cloudflare log-explorer datasets available`."
      );
      return;
    }
    for (const dataset of datasets) {
      deps.log(formatDatasetLine(dataset));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listLogExplorerDatasetsCommand = buildCommand({
  docs: {
    brief: "List configured Log Explorer datasets",
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
      includeZones: {
        kind: "boolean",
        brief: "Include zone-scoped datasets belonging to the account (account scope only)",
        default: false,
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
  },
  async func(this: void, flags: ListDatasetsFlags) {
    await runListLogExplorerDatasets(flags);
  },
});

// ---------------------------------------------------------------------------
// datasets available
// ---------------------------------------------------------------------------

export type AvailableDatasetsFlags = DatasetScopeFlags;

export async function runListAvailableLogExplorerDatasets(
  flags: AvailableDatasetsFlags,
  deps: DatasetDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const datasets = await client.listAvailableLogExplorerDatasets(
      { scope: flags.scope },
      scopeOverrides(flags)
    );

    if (flags.json) {
      deps.log(JSON.stringify(datasets, null, 2));
      return;
    }

    const noun = datasets.length === 1 ? "dataset" : "datasets";
    deps.log(`Showing ${datasets.length} available ${noun}\n`);
    if (datasets.length === 0) {
      deps.log("No dataset types are available for this account or zone.");
      return;
    }
    for (const dataset of datasets) {
      deps.log(formatAvailableLine(dataset));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const listAvailableLogExplorerDatasetsCommand = buildCommand({
  docs: {
    brief: "List dataset types available to enable, with their timestamp fields",
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
  },
  async func(this: void, flags: AvailableDatasetsFlags) {
    await runListAvailableLogExplorerDatasets(flags);
  },
});

// ---------------------------------------------------------------------------
// datasets get
// ---------------------------------------------------------------------------

export type GetDatasetFlags = DatasetScopeFlags;

export async function runGetLogExplorerDataset(
  datasetId: string,
  flags: GetDatasetFlags,
  deps: DatasetDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const dataset = await client.getLogExplorerDataset(
      { datasetId: datasetId.trim(), scope: flags.scope },
      scopeOverrides(flags)
    );

    if (flags.json) {
      deps.log(JSON.stringify(dataset, null, 2));
      return;
    }
    deps.log(formatDatasetDetails(dataset));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const getLogExplorerDatasetCommand = buildCommand({
  docs: {
    brief: "Show one dataset's field configuration, filter, and ingest state",
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
          brief: "Dataset ID from `datasets list`",
          parse: String,
          placeholder: "dataset-id",
        },
      ],
    },
  },
  async func(this: void, flags: GetDatasetFlags, datasetId: string) {
    await runGetLogExplorerDataset(datasetId, flags);
  },
});

// ---------------------------------------------------------------------------
// datasets update
// ---------------------------------------------------------------------------

export interface UpdateDatasetFlags extends DatasetScopeFlags {
  readonly enabled?: boolean;
  readonly fields?: readonly LogExplorerDatasetField[];
  readonly filter?: string;
  readonly deletionProtection?: boolean;
}

export async function runUpdateLogExplorerDataset(
  datasetId: string,
  flags: UpdateDatasetFlags,
  deps: DatasetDeps = defaultDeps
): Promise<void> {
  try {
    const trimmedId = datasetId.trim();
    if (trimmedId.length === 0) {
      throw new Error("Dataset ID is empty.");
    }
    if (flags.enabled === undefined) {
      throw new Error(
        "Pass --enabled true or --enabled false (required on every update). Find the current value with `cloudflare log-explorer datasets get <dataset-id>`."
      );
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const dataset = await client.updateLogExplorerDataset(
      {
        datasetId: trimmedId,
        enabled: flags.enabled,
        fields: flags.fields === undefined ? undefined : [...flags.fields],
        filter: flags.filter,
        deletionProtection: flags.deletionProtection,
        scope: flags.scope,
      },
      scopeOverrides(flags)
    );

    if (flags.json) {
      deps.log(JSON.stringify(dataset, null, 2));
      return;
    }
    deps.log(formatDatasetDetails(dataset));
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const updateLogExplorerDatasetCommand = buildCommand({
  docs: {
    brief: "Update a dataset's ingest state, fields, filter, or deletion protection",
    customUsage: [
      "<dataset-id> --enabled false",
      "<dataset-id> --enabled true --fields ClientIP,EdgeResponseStatus",
      "<dataset-id> --enabled true --filter '{http.request.method==\"GET\"}'",
      "<dataset-id> --enabled true --deletionProtection false",
    ],
  },
  parameters: {
    flags: {
      enabled: {
        kind: "parsed",
        parse: parseBoolean("--enabled"),
        optional: true,
        brief: "Enable or disable log ingest (required)",
      },
      fields: {
        kind: "parsed",
        parse: parseFieldList,
        optional: true,
        brief: "Comma-separated field names to ingest (enables only these; omit to keep current fields)",
      },
      filter: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Logpush filter predicate; '' (empty) clears the filter",
      },
      deletionProtection: {
        kind: "parsed",
        parse: parseBoolean("--deletionProtection"),
        optional: true,
        brief: "Set false to allow deleting the dataset",
      },
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
          brief: "Dataset ID from `datasets list`",
          parse: String,
          placeholder: "dataset-id",
        },
      ],
    },
  },
  async func(this: void, flags: UpdateDatasetFlags, datasetId: string) {
    await runUpdateLogExplorerDataset(datasetId, flags);
  },
});

// ---------------------------------------------------------------------------
// datasets delete
// ---------------------------------------------------------------------------

export interface DeleteDatasetFlags extends DatasetScopeFlags {
  readonly yes: boolean;
}

export async function runDeleteLogExplorerDataset(
  datasetId: string,
  flags: DeleteDatasetFlags,
  deps: DatasetDeps = defaultDeps
): Promise<void> {
  try {
    const trimmedId = datasetId.trim();
    if (trimmedId.length === 0) {
      throw new Error("Dataset ID is empty.");
    }

    if (!flags.yes) {
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to delete a dataset without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to delete Log Explorer dataset ${trimmedId} and stop its log ingest. Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    await client.deleteLogExplorerDataset(
      { datasetId: trimmedId, scope: flags.scope },
      scopeOverrides(flags)
    );

    if (flags.json) {
      deps.log(JSON.stringify({ deleted: true, datasetId: trimmedId }, null, 2));
      return;
    }
    deps.log(`Deleted Log Explorer dataset ${trimmedId}.`);
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const deleteLogExplorerDatasetCommand = buildCommand({
  docs: {
    brief: "Delete a dataset and stop its log ingest (requires deletion protection off)",
  },
  parameters: {
    flags: {
      yes: {
        kind: "boolean",
        brief: "Skip the confirmation prompt",
        default: false,
      },
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
          brief: "Dataset ID from `datasets list`",
          parse: String,
          placeholder: "dataset-id",
        },
      ],
    },
  },
  async func(this: void, flags: DeleteDatasetFlags, datasetId: string) {
    await runDeleteLogExplorerDataset(datasetId, flags);
  },
});
