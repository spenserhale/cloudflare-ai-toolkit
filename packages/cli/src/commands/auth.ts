import { buildCommand, buildRouteMap } from "@stricli/core";
import {
  bunSecretStore,
  CREDENTIAL_RESOURCES,
  KEYCHAIN_SERVICE,
  loadConfig,
  readDotEnv,
} from "@cloudflare-ai-toolkit/sdk";
import {
  AuthUsageError,
  csvCell,
  deleteCredentials,
  exitCodeFor,
  formatAuthError,
  listCredentials,
  migrateCredentials,
  parseResource,
  selectCredentialKeys,
  setCredentials,
} from "../lib/auth.js";
import { promptHidden, readAllStdin, stdinIsInteractive } from "../lib/prompt.js";

// Thin Stricli wrappers. The logic, and its tests, live in ../lib/auth.ts.

async function runAuth(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`Error: ${formatAuthError(error)}`);
    process.exit(exitCodeFor(error));
  }
}

const resourcePositional = {
  kind: "tuple",
  parameters: [
    {
      brief: `Credential to act on: ${CREDENTIAL_RESOURCES.join(", ")}`,
      parse: String,
      placeholder: "credential",
    },
  ],
} as const;

const keyFlag = {
  key: {
    kind: "parsed",
    parse: String,
    brief: "Only this entry (e.g. CLOUDFLARE_EMAIL); default: every key the credential uses",
    optional: true,
  },
} as const;

const dryRunFlag = {
  dryRun: {
    kind: "boolean",
    brief: "Report what would change without touching the keychain",
    default: false,
  },
} as const;

const jsonFlag = {
  json: {
    kind: "boolean",
    brief: "Output as JSON",
    default: false,
  },
} as const;

interface SetFlags {
  readonly key?: string;
  readonly stdin: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export const authSetCommand = buildCommand({
  docs: {
    brief: "Store a credential in the OS keychain (hidden prompt, or --stdin)",
    fullDescription:
      `Saves the value under keychain service \`${KEYCHAIN_SERVICE}\`, named by its env var ` +
      "(CLOUDFLARE_API_TOKEN, CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL). On a terminal it prompts with " +
      "hidden input. For scripts and agents, pipe the value with --stdin: one value per call, so " +
      "global-api-key needs --key. The value is never accepted as an argument, which keeps it out " +
      "of shell history and process listings. Env vars and .env files still take precedence over " +
      "the keychain; the output flags a stored value that one of them shadows.\n\n" +
      "Exit codes: 0 ok, 2 usage (bad credential, no terminal and no --stdin, empty value), " +
      "3 keychain unavailable.",
  },
  parameters: {
    positional: resourcePositional,
    flags: {
      ...keyFlag,
      stdin: {
        kind: "boolean",
        brief: "Read the value from stdin instead of prompting (non-interactive)",
        default: false,
      },
      ...dryRunFlag,
      ...jsonFlag,
    },
  },
  async func(this: void, flags: SetFlags, resourceArg: string) {
    await runAuth(async () => {
      const resource = parseResource(resourceArg);
      const keys = selectCredentialKeys(resource, flags.key);

      let readValue: (key: string) => Promise<string>;
      if (flags.stdin) {
        if (keys.length > 1) {
          throw new AuthUsageError(
            `${resource} uses ${keys.length} keys (${keys.join(", ")}); --stdin stores one per call`,
            `Run once per key: ... | cloudflare auth set ${resource} --key ${keys[0]} --stdin`
          );
        }
        const piped = await readAllStdin();
        readValue = async () => piped;
      } else {
        if (!stdinIsInteractive()) {
          throw new AuthUsageError(
            "No terminal to prompt on",
            `Pipe the value instead: ... | cloudflare auth set ${resource}` +
              `${keys.length > 1 ? ` --key ${keys[0]}` : ""} --stdin`
          );
        }
        readValue = (key) => promptHidden(`${key}: `);
      }

      const config = await loadConfig({ secretStore: null });
      const result = await setCredentials({
        resource,
        keys,
        readValue,
        store: bunSecretStore(),
        config,
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const credential of result.credentials) {
        console.log(
          `${credential.action} ${credential.key} in ${result.store}` +
            (credential.shadowed_by ? ` (warning: ${credential.shadowed_by} still overrides it)` : "")
        );
      }
    });
  },
});

interface ListFlags {
  readonly json: boolean;
  readonly csv: boolean;
}

export const authListCommand = buildCommand({
  docs: {
    brief: "Show which credentials are in the keychain and which source is active",
    fullDescription:
      "Lists every credential key with its keychain state (set, missing, or unknown when the " +
      "keychain cannot be read) and the source that currently wins (env, envfile:<path>, " +
      "keychain, or missing). Values are never printed.",
  },
  parameters: {
    flags: {
      ...jsonFlag,
      csv: {
        kind: "boolean",
        brief: "Output as CSV",
        default: false,
      },
    },
  },
  async func(this: void, flags: ListFlags) {
    await runAuth(async () => {
      const store = bunSecretStore();
      const config = await loadConfig({ secretStore: store });
      const result = await listCredentials(store, config);
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (flags.csv) {
        console.log(
          [
            "resource,key,keychain,active_source",
            ...result.credentials.map((row) =>
              [row.resource, row.key, row.keychain, row.active_source].map(csvCell).join(",")
            ),
          ].join("\n")
        );
        return;
      }
      console.log(
        [
          `store: ${result.store} (${result.keychain_status}` +
            `${result.keychain_error ? `: ${result.keychain_error}` : ""})`,
          ...result.credentials.map(
            (row) =>
              `${row.key.padEnd(22)} keychain=${row.keychain.padEnd(7)} active=${row.active_source}`
          ),
        ].join("\n")
      );
    });
  },
});

interface DeleteFlags {
  readonly key?: string;
  readonly yes: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export const authDeleteCommand = buildCommand({
  docs: {
    brief: "Remove a credential from the OS keychain (requires --yes)",
    fullDescription:
      "Deletes the credential's keychain entries, or only --key. Values set through env or .env " +
      "are not touched. Exit codes: 0 ok, 2 usage (no --yes, bad credential), 3 keychain unavailable.",
  },
  parameters: {
    positional: resourcePositional,
    flags: {
      ...keyFlag,
      yes: {
        kind: "boolean",
        brief: "Confirm the deletion",
        default: false,
      },
      ...dryRunFlag,
      ...jsonFlag,
    },
  },
  async func(this: void, flags: DeleteFlags, resourceArg: string) {
    await runAuth(async () => {
      const resource = parseResource(resourceArg);
      const keys = selectCredentialKeys(resource, flags.key);
      if (!flags.yes && !flags.dryRun) {
        throw new AuthUsageError(
          "Deleting a keychain entry needs --yes",
          `Preview with --dry-run, then run: cloudflare auth delete ${resource} --yes`
        );
      }
      const result = await deleteCredentials({
        resource,
        keys,
        store: bunSecretStore(),
        dryRun: flags.dryRun,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      for (const row of result.credentials) console.log(`${row.action} ${row.key}`);
    });
  },
});

interface MigrateFlags {
  readonly overwrite: boolean;
  readonly dryRun: boolean;
  readonly json: boolean;
}

export const authMigrateCommand = buildCommand({
  docs: {
    brief: "Copy plaintext credentials from .env into the keychain",
    fullDescription:
      "Stores every credential whose active source is a .env file in the OS keychain, skipping " +
      "keys already there unless --overwrite. Process-environment values (op run, CI) are left " +
      "alone. Files are not edited: remove the lines listed under clean_up yourself, because a " +
      ".env value keeps overriding the keychain until you do.",
  },
  parameters: {
    flags: {
      overwrite: {
        kind: "boolean",
        brief: "Replace keys that already exist in the keychain",
        default: false,
      },
      ...dryRunFlag,
      ...jsonFlag,
    },
  },
  async func(this: void, flags: MigrateFlags) {
    await runAuth(async () => {
      const store = bunSecretStore();
      const config = await loadConfig({ secretStore: null });
      const result = await migrateCredentials({
        store,
        config,
        envFileValues: readDotEnv().values,
        dryRun: flags.dryRun,
        overwrite: flags.overwrite,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      const lines =
        result.credentials.length === 0
          ? ["nothing to migrate: no credentials come from a .env file"]
          : result.credentials.map((row) => `${row.action} ${row.key} (from ${row.from})`);
      if (result.clean_up.length > 0) {
        lines.push(
          "",
          "remove the migrated keys from these files; until you do, they keep overriding the keychain:",
          ...result.clean_up.map((file) => `  ${file}`)
        );
      }
      console.log(lines.join("\n"));
    });
  },
});

export const authRoutes = buildRouteMap({
  routes: {
    set: authSetCommand,
    list: authListCommand,
    delete: authDeleteCommand,
    migrate: authMigrateCommand,
  },
  docs: {
    brief: "Store, list, and remove Cloudflare credentials in the OS keychain",
  },
});
