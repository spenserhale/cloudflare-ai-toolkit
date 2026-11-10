import {
  CloudflareConfigError,
  CREDENTIAL_KEYS,
  CREDENTIAL_RESOURCES,
  describeError,
  keychainErrorText,
  resourceCredentialKeys,
  resourceForCredentialKey,
  type CredentialResource,
  type ResolvedConfig,
  type SecretStore,
} from "@cloudflare-ai-toolkit/sdk";

/** Exit codes for the `auth` commands. */
export const EXIT = {
  OK: 0,
  /** Unexpected runtime failure. */
  FAILURE: 1,
  /** Bad arguments, missing --yes/--stdin, empty input, or a cancelled prompt. */
  USAGE: 2,
  /** The OS keychain is unavailable (locked, no daemon, not running on Bun). */
  KEYCHAIN: 3,
} as const;

/** A caller mistake; the CLI exits 2 and prints the hint. */
export class AuthUsageError extends Error {
  constructor(
    message: string,
    public readonly hint?: string
  ) {
    super(message);
    this.name = "AuthUsageError";
  }
}

export function exitCodeFor(error: unknown): number {
  if (error instanceof AuthUsageError) return EXIT.USAGE;
  if (error instanceof CloudflareConfigError) return EXIT.KEYCHAIN;
  return EXIT.FAILURE;
}

export function formatAuthError(error: unknown): string {
  if (error instanceof AuthUsageError) {
    return error.hint ? `${error.message}\nHint: ${error.hint}` : error.message;
  }
  return describeError(error);
}

export function parseResource(raw: string): CredentialResource {
  const value = raw.trim().toLowerCase();
  if (!(CREDENTIAL_RESOURCES as readonly string[]).includes(value)) {
    throw new AuthUsageError(
      `Unknown credential '${raw}'`,
      `Use one of: ${CREDENTIAL_RESOURCES.join(", ")}`
    );
  }
  return value as CredentialResource;
}

/** The keychain entry names to act on: one --key, or every key the resource uses. */
export function selectCredentialKeys(resource: CredentialResource, key: string | undefined): string[] {
  const keys = resourceCredentialKeys(resource);
  if (key === undefined) return [...keys];
  const normalized = key.trim().toUpperCase();
  if (!keys.includes(normalized)) {
    throw new AuthUsageError(
      `--key '${key}' is not part of ${resource}`,
      `Use one of: ${keys.join(", ")}`
    );
  }
  return [normalized];
}

/** Sources that outrank the keychain, so a stored value would be ignored. */
function isShadowingSource(source: string | undefined): boolean {
  return source === "env" || (source?.startsWith("envfile:") ?? false);
}

export interface SetCredentialsInput {
  resource: CredentialResource;
  keys: readonly string[];
  readValue: (key: string) => Promise<string>;
  store: SecretStore;
  /** Config loaded without the keychain, so its sources show what would shadow a stored value. */
  config: ResolvedConfig;
  dryRun: boolean;
}

export interface SetCredentialsResult {
  resource: CredentialResource;
  store: string;
  dry_run: boolean;
  credentials: Array<{ key: string; action: "stored" | "would_store"; shadowed_by?: string }>;
}

export async function setCredentials(input: SetCredentialsInput): Promise<SetCredentialsResult> {
  // Read every value before writing any, so a cancelled second prompt leaves nothing half-stored.
  const values: Array<[string, string]> = [];
  for (const key of input.keys) {
    const value = (await input.readValue(key)).trim();
    if (!value) {
      throw new AuthUsageError(
        `${key} must not be empty; nothing was stored`,
        "Paste the value at the prompt, or pipe it with --stdin."
      );
    }
    values.push([key, value]);
  }
  const credentials: SetCredentialsResult["credentials"] = [];
  for (const [key, value] of values) {
    if (!input.dryRun) await input.store.set(key, value);
    const source = input.config.credentialSources[key];
    credentials.push({
      key,
      action: input.dryRun ? "would_store" : "stored",
      ...(isShadowingSource(source) ? { shadowed_by: source } : {}),
    });
  }
  return {
    resource: input.resource,
    store: input.store.description,
    dry_run: input.dryRun,
    credentials,
  };
}

export interface CredentialListRow {
  resource: CredentialResource;
  key: string;
  keychain: "set" | "missing" | "unknown";
  active_source: string;
}

export interface ListCredentialsResult {
  store: string;
  keychain_status: "ok" | "disabled" | "unavailable";
  keychain_error?: string;
  credentials: CredentialListRow[];
}

/** Every credential key with its keychain state and the source that wins. Never includes values. */
export async function listCredentials(
  store: SecretStore,
  config: ResolvedConfig
): Promise<ListCredentialsResult> {
  let stored: Record<string, boolean> | null = null;
  let error: string | undefined;
  try {
    const entries = await Promise.all(
      CREDENTIAL_KEYS.map(async (key) => [key, Boolean(await store.get(key))] as const)
    );
    stored = Object.fromEntries(entries);
  } catch (caught) {
    error = keychainErrorText(caught);
  }
  return {
    store: store.description,
    keychain_status: stored ? "ok" : "unavailable",
    ...(error ? { keychain_error: error } : {}),
    credentials: CREDENTIAL_KEYS.map((key) => ({
      resource: resourceForCredentialKey(key) as CredentialResource,
      key,
      keychain: stored ? (stored[key] ? "set" : "missing") : "unknown",
      active_source: config.credentialSources[key] ?? "missing",
    })),
  };
}

export interface DeleteCredentialsResult {
  resource: CredentialResource;
  store: string;
  dry_run: boolean;
  credentials: Array<{ key: string; action: "deleted" | "not_found" | "would_delete" }>;
}

export async function deleteCredentials(input: {
  resource: CredentialResource;
  keys: readonly string[];
  store: SecretStore;
  dryRun: boolean;
}): Promise<DeleteCredentialsResult> {
  const credentials: DeleteCredentialsResult["credentials"] = [];
  for (const key of input.keys) {
    if (input.dryRun) {
      credentials.push({ key, action: "would_delete" });
      continue;
    }
    const deleted = await input.store.delete(key);
    credentials.push({ key, action: deleted ? "deleted" : "not_found" });
  }
  return {
    resource: input.resource,
    store: input.store.description,
    dry_run: input.dryRun,
    credentials,
  };
}

export interface MigrateCredentialsResult {
  store: string;
  dry_run: boolean;
  credentials: Array<{
    resource: CredentialResource;
    key: string;
    from: string;
    action: "stored" | "would_store" | "skipped_exists";
  }>;
  /** Plaintext files that still hold migrated keys; remove the lines yourself. */
  clean_up: string[];
}

/** Env-only aliases a .env file may use instead of the primary key name. */
const ENV_ALIASES: Record<string, readonly string[]> = {
  CLOUDFLARE_EMAIL: ["CLOUDFLARE_API_EMAIL"],
};

function envFileValue(values: Record<string, string>, key: string): string | undefined {
  for (const name of [key, ...(ENV_ALIASES[key] ?? [])]) {
    if (values[name]) return values[name];
  }
  return undefined;
}

/**
 * Copy credentials whose winning source is a .env file into the store.
 * Process-environment credentials are left alone: they usually come from
 * op run or CI and are not plaintext at rest. Files are never edited.
 *
 * Values come from the parsed .env rather than `config.auth`, because the
 * config only carries the auth method that won.
 */
export async function migrateCredentials(input: {
  store: SecretStore;
  config: ResolvedConfig;
  /** Parsed values of `config.envFile`. */
  envFileValues: Record<string, string>;
  dryRun: boolean;
  overwrite: boolean;
}): Promise<MigrateCredentialsResult> {
  const credentials: MigrateCredentialsResult["credentials"] = [];
  const cleanUp = new Set<string>();
  for (const key of CREDENTIAL_KEYS) {
    const source = input.config.credentialSources[key];
    if (!source?.startsWith("envfile:")) continue;
    const file = source.slice("envfile:".length);
    const value = envFileValue(input.envFileValues, key);
    if (!value) continue;
    const resource = resourceForCredentialKey(key) as CredentialResource;

    if (!input.overwrite && (await input.store.get(key))) {
      credentials.push({ resource, key, from: source, action: "skipped_exists" });
      continue;
    }
    if (!input.dryRun) await input.store.set(key, value);
    credentials.push({ resource, key, from: source, action: input.dryRun ? "would_store" : "stored" });
    cleanUp.add(file);
  }
  return {
    store: input.store.description,
    dry_run: input.dryRun,
    credentials,
    clean_up: [...cleanUp],
  };
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
