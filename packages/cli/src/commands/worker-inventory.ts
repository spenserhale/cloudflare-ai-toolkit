import { buildCommand } from "@stricli/core";
import { CloudflareClient, describeError, loadConfig } from "@cloudflare-ai-toolkit/sdk";

interface WorkerFlags {
  readonly accountId?: string;
  readonly environment?: string;
  readonly json: boolean;
}

interface SourceFlags extends WorkerFlags { readonly outDir?: string }
interface ListFlags extends WorkerFlags { readonly page?: number; readonly perPage?: number }

const workerFlags = {
  accountId: {
    kind: "parsed", parse: String, optional: true,
    brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID; never uses zone scope)",
  },
  environment: {
    kind: "parsed", parse: String, optional: true,
    brief: "Domain service environment: production only; legacy environments are unsupported",
  },
  json: { kind: "boolean", default: false, brief: "Output bounded inspection metadata as JSON" },
} as const;

const sourceFlags = {
  ...workerFlags,
  outDir: {
    kind: "parsed", parse: String, optional: true,
    brief: "Export sensitive source into a NEW private local directory; never print or share its files",
  },
} as const;

function positivePage(value: string): number {
  const page = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(page) || page < 1) {
    throw new Error("--page must be a positive integer.");
  }
  return page;
}

function pageSize(value: string): number {
  const size = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new Error("--per-page must be an integer in 1-100.");
  }
  return size;
}

const listFlags = {
  ...workerFlags,
  page: { kind: "parsed", parse: positivePage, optional: true, brief: "Numeric page (default 1); follow nextPage until null" },
  perPage: { kind: "parsed", parse: pageSize, optional: true, brief: "Results per page (1-100; default 20)" },
} as const;

const workerPosition = {
  kind: "tuple",
  parameters: [{ parse: String, placeholder: "worker", brief: "Literal script name, or domain service name with --environment production" }],
} as const;

function target(worker: string, flags: WorkerFlags) {
  return flags.environment === undefined
    ? { script: worker, accountId: flags.accountId }
    : { service: worker, environment: flags.environment, accountId: flags.accountId };
}

async function read(
  flags: WorkerFlags,
  label: string,
  operation: (inventory: CloudflareClient["inventory"]) => Promise<unknown>,
): Promise<void> {
  try {
    const inventory = new CloudflareClient(await loadConfig()).inventory;
    const result = await operation(inventory);
    if (!flags.json) console.log(label);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Error: ${describeError(error)}`);
    process.exit(1);
  }
}

function continuation(result: { truncated: boolean; nextPage: number | null }): void {
  if (result.truncated) console.error(`More Worker inventory is available. Continue with --page ${result.nextPage ?? "<next-page>"} using the same --per-page.`);
}

export const getWorkerSettingsCommand = buildCommand({
  docs: { brief: "Read account Worker settings and binding references; binding values are redacted" },
  parameters: { flags: workerFlags, positional: workerPosition },
  async func(this: void, flags: WorkerFlags, worker: string) {
    await read(flags, "Worker settings and binding inventory", (inventory) => inventory.getWorkerSettings(target(worker, flags)));
  },
});

export const getWorkerSourceCommand = buildCommand({
  docs: { brief: "Inspect unpinned original source metadata; optionally export private files, never source on stdout" },
  parameters: { flags: sourceFlags, positional: workerPosition },
  async func(this: void, flags: SourceFlags, worker: string) {
    await read(flags, "Worker source metadata (unpinned observation)", (inventory) => inventory.getWorkerSource(target(worker, flags), { outDir: flags.outDir }));
  },
});

export const listWorkerDeploymentsCommand = buildCommand({
  docs: { brief: "Read one page of deployments and serving version percentages (first on page 1 is active)" },
  parameters: { flags: listFlags, positional: workerPosition },
  async func(this: void, flags: ListFlags, worker: string) {
    await read(flags, "Worker deployment inventory", async (inventory) => {
      const result = await inventory.listWorkerDeployments(target(worker, flags), { page: flags.page, perPage: flags.perPage });
      continuation(result);
      return result;
    });
  },
});

export const listWorkerVersionsCommand = buildCommand({
  docs: { brief: "Read one page of uploaded Worker version metadata; uploads do not prove deployment" },
  parameters: { flags: listFlags, positional: workerPosition },
  async func(this: void, flags: ListFlags, worker: string) {
    await read(flags, "Worker version inventory", async (inventory) => {
      const result = await inventory.listWorkerVersions(target(worker, flags), { page: flags.page, perPage: flags.perPage });
      continuation(result);
      return result;
    });
  },
});

export const getWorkerVersionCommand = buildCommand({
  docs: { brief: "Inspect pinned Worker bindings/modules through Beta API; source stays in private files" },
  parameters: {
    flags: sourceFlags,
    positional: {
      kind: "tuple",
      parameters: [
        workerPosition.parameters[0],
        { parse: String, placeholder: "version", brief: "Version UUID, UUID prefix (at least 8 characters), or latest (not necessarily serving)" },
      ],
    },
  },
  async func(this: void, flags: SourceFlags, worker: string, version: string) {
    await read(flags, "Worker version inspection (Beta API)", (inventory) => inventory.getWorkerVersion(target(worker, flags), version, { outDir: flags.outDir }));
  },
});
