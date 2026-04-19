import { buildCommand } from "@stricli/core";
import { createInterface } from "node:readline/promises";
import {
  CloudflareError,
  CloudflareClient,
  resolveConfig,
  type PurgeCacheResult,
} from "@cloudflare-ai-toolkit/sdk";

// ---------------------------------------------------------------------------
// Shared types & helpers
// ---------------------------------------------------------------------------

interface CachePurgeDeps {
  readonly resolveConfig: typeof resolveConfig;
  readonly createClient: (config: ReturnType<typeof resolveConfig>) => Pick<
    CloudflareClient,
    | "purgeCacheEverything"
    | "purgeCacheByUrls"
    | "purgeCacheByTags"
    | "purgeCacheByPrefixes"
    | "purgeCacheByHosts"
  >;
  readonly log: typeof console.log;
  readonly error: typeof console.error;
  readonly exit: (code: number) => never;
  readonly isTTY: () => boolean;
  readonly confirm: (prompt: string) => Promise<boolean>;
}

const defaultDeps: CachePurgeDeps = {
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

async function confirmDestructive(
  deps: CachePurgeDeps,
  yes: boolean,
  prompt: string,
  nonInteractiveHint: string
): Promise<boolean> {
  if (yes) return true;
  if (!deps.isTTY()) {
    deps.error(`Error: ${nonInteractiveHint}`);
    deps.exit(1);
    return false;
  }
  return deps.confirm(prompt);
}

function formatError(err: unknown): string {
  if (err instanceof CloudflareError) {
    const parts = [err.message];
    if (err.requiredPermissions && err.requiredPermissions.length > 0) {
      const perms = err.requiredPermissions.map((p) => `'${p}'`).join(" or ");
      parts.push(`Required permission: ${perms}`);
    }
    if (err.docsUrl) {
      parts.push(`Docs: ${err.docsUrl}`);
    }
    return parts.join("\n");
  }
  return err instanceof Error ? err.message : String(err);
}

function formatSuccess(result: PurgeCacheResult, description: string): string {
  return `Cache purge successful (${description}). ID: ${result.id}`;
}

// ---------------------------------------------------------------------------
// Purge everything
// ---------------------------------------------------------------------------

interface PurgeEverythingFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runPurgeCacheEverything(
  flags: PurgeEverythingFlags,
  deps: CachePurgeDeps = defaultDeps
): Promise<void> {
  try {
    const target = flags.zoneId ?? "the configured zone";
    const confirmed = await confirmDestructive(
      deps,
      flags.yes,
      `About to purge ALL cached content for zone ${target}. Type 'yes' to continue: `,
      "Refusing to purge everything without confirmation. Pass --yes to proceed non-interactively."
    );
    if (!confirmed) {
      deps.error("Aborted.");
      deps.exit(1);
      return;
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.purgeCacheEverything(flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatSuccess(result, "everything"));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const purgeCacheEverythingCommand = buildCommand({
  docs: {
    brief: "Purge all cached content for a zone",
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
  },
  async func(this: void, flags: PurgeEverythingFlags) {
    await runPurgeCacheEverything(flags);
  },
});

// ---------------------------------------------------------------------------
// Purge by URLs
// ---------------------------------------------------------------------------

interface PurgeUrlsFlags {
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runPurgeCacheByUrls(
  flags: PurgeUrlsFlags,
  urls: readonly string[],
  deps: CachePurgeDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.purgeCacheByUrls([...urls], flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatSuccess(result, `${urls.length} URL(s)`));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const purgeCacheByUrlsCommand = buildCommand({
  docs: {
    brief: "Purge cached content by URL(s)",
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
      kind: "array",
      parameter: {
        brief: "URL(s) to purge",
        parse: String,
      },
    },
  },
  async func(this: void, flags: PurgeUrlsFlags, ...urls: string[]) {
    if (urls.length === 0) {
      console.error("Error: At least one URL is required");
      process.exit(1);
    }
    await runPurgeCacheByUrls(flags, urls);
  },
});

// ---------------------------------------------------------------------------
// Purge by tags
// ---------------------------------------------------------------------------

interface PurgeTagsFlags {
  readonly zoneId?: string;
  readonly json: boolean;
}

export async function runPurgeCacheByTags(
  flags: PurgeTagsFlags,
  tags: readonly string[],
  deps: CachePurgeDeps = defaultDeps
): Promise<void> {
  try {
    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.purgeCacheByTags([...tags], flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatSuccess(result, `${tags.length} tag(s)`));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const purgeCacheByTagsCommand = buildCommand({
  docs: {
    brief: "Purge cached content by cache tag(s)",
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
      kind: "array",
      parameter: {
        brief: "Cache tag(s) to purge",
        parse: String,
      },
    },
  },
  async func(this: void, flags: PurgeTagsFlags, ...tags: string[]) {
    if (tags.length === 0) {
      console.error("Error: At least one tag is required");
      process.exit(1);
    }
    await runPurgeCacheByTags(flags, tags);
  },
});

// ---------------------------------------------------------------------------
// Purge by prefixes
// ---------------------------------------------------------------------------

interface PurgePrefixesFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runPurgeCacheByPrefixes(
  flags: PurgePrefixesFlags,
  prefixes: readonly string[],
  deps: CachePurgeDeps = defaultDeps
): Promise<void> {
  try {
    const confirmed = await confirmDestructive(
      deps,
      flags.yes,
      `About to purge cache for ${prefixes.length} prefix(es). Type 'yes' to continue: `,
      "Refusing to purge prefixes without confirmation. Pass --yes to proceed non-interactively."
    );
    if (!confirmed) {
      deps.error("Aborted.");
      deps.exit(1);
      return;
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.purgeCacheByPrefixes([...prefixes], flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatSuccess(result, `${prefixes.length} prefix(es)`));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const purgeCacheByPrefixesCommand = buildCommand({
  docs: {
    brief: "Purge cached content by URL prefix(es)",
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
      kind: "array",
      parameter: {
        brief: "URL prefix(es) to purge",
        parse: String,
      },
    },
  },
  async func(this: void, flags: PurgePrefixesFlags, ...prefixes: string[]) {
    if (prefixes.length === 0) {
      console.error("Error: At least one prefix is required");
      process.exit(1);
    }
    await runPurgeCacheByPrefixes(flags, prefixes);
  },
});

// ---------------------------------------------------------------------------
// Purge by hosts
// ---------------------------------------------------------------------------

interface PurgeHostsFlags {
  readonly zoneId?: string;
  readonly json: boolean;
  readonly yes: boolean;
}

export async function runPurgeCacheByHosts(
  flags: PurgeHostsFlags,
  hosts: readonly string[],
  deps: CachePurgeDeps = defaultDeps
): Promise<void> {
  try {
    const confirmed = await confirmDestructive(
      deps,
      flags.yes,
      `About to purge cache for ${hosts.length} host(s). Type 'yes' to continue: `,
      "Refusing to purge hosts without confirmation. Pass --yes to proceed non-interactively."
    );
    if (!confirmed) {
      deps.error("Aborted.");
      deps.exit(1);
      return;
    }

    const config = deps.resolveConfig();
    const client = deps.createClient(config);
    const result = await client.purgeCacheByHosts([...hosts], flags.zoneId);

    if (flags.json) {
      deps.log(JSON.stringify(result, null, 2));
    } else {
      deps.log(formatSuccess(result, `${hosts.length} host(s)`));
    }
  } catch (err) {
    deps.error(`Error: ${formatError(err)}`);
    deps.exit(1);
  }
}

export const purgeCacheByHostsCommand = buildCommand({
  docs: {
    brief: "Purge cached content by hostname(s)",
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
      kind: "array",
      parameter: {
        brief: "Hostname(s) to purge",
        parse: String,
      },
    },
  },
  async func(this: void, flags: PurgeHostsFlags, ...hosts: string[]) {
    if (hosts.length === 0) {
      console.error("Error: At least one host is required");
      process.exit(1);
    }
    await runPurgeCacheByHosts(flags, hosts);
  },
});
