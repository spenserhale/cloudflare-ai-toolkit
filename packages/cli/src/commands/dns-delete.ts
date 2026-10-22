import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareAuthError,
  CloudflareClient,
  CloudflareError,
  resolveConfig,
} from "@cloudflare-ai-toolkit/sdk";

interface DnsDeleteDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (
    config: ReturnType<typeof resolveConfig>
  ) => Pick<CloudflareClient, "deleteDnsRecord">;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: DnsDeleteDeps = {
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

export interface DnsDeleteFlags {
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runDeleteDnsRecords(
  zoneId: string,
  recordIds: readonly string[],
  flags: DnsDeleteFlags,
  deps: DnsDeleteDeps = defaultDeps
): Promise<void> {
  try {
    const trimmedZoneId = zoneId.trim();
    if (trimmedZoneId.length === 0) {
      throw new Error("Zone ID is empty.");
    }
    const ids = recordIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (ids.length === 0) {
      throw new Error("Specify at least one DNS record ID.");
    }

    if (!flags.yes) {
      if (!deps.isTTY()) {
        throw new Error(
          "Refusing to delete DNS records without confirmation. Pass --yes to proceed non-interactively."
        );
      }
      const confirmed = await deps.confirm(
        `About to delete ${ids.length} DNS record(s) from zone ${trimmedZoneId}: ${ids.join(", ")}. Type 'yes' to continue: `
      );
      if (!confirmed) {
        deps.error("Aborted.");
        deps.exit(1);
        return;
      }
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);

    // Delete sequentially so a failure stops the run and the output says
    // exactly which records are already gone.
    const deleted: string[] = [];
    for (const id of ids) {
      try {
        await client.deleteDnsRecord(trimmedZoneId, id);
      } catch (err) {
        if (deleted.length > 0) {
          deps.error(`Deleted before failure: ${deleted.join(", ")}`);
        }
        throw new Error(`Failed to delete DNS record ${id}: ${formatError(err)}`);
      }
      deleted.push(id);
      if (!flags.json) {
        deps.log(`Deleted DNS record ${id}.`);
      }
    }

    if (flags.json) {
      deps.log(JSON.stringify({ deleted }, null, 2));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const deleteDnsRecordCommand = buildCommand({
  docs: {
    brief: "Delete one or more DNS records from a zone",
  },
  parameters: {
    flags: {
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
      kind: "array",
      parameter: {
        brief: "Zone ID, then one or more DNS record IDs (find them with `dns records list`)",
        parse: String,
        placeholder: "zone-id record-id",
      },
    },
  },
  async func(this: void, flags: DnsDeleteFlags, ...args: string[]) {
    const [zoneId = "", ...recordIds] = args;
    await runDeleteDnsRecords(zoneId, recordIds, flags);
  },
});
