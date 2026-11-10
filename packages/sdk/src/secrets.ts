import { CloudflareConfigError } from "./errors.js";

/** Service name every cloudflare-ai-toolkit keychain entry is stored under. */
export const KEYCHAIN_SERVICE = "cloudflare-ai-toolkit";

/** Env var that turns the keychain lookup off (`0`, `false`, `no`, `off`). */
export const KEYCHAIN_SWITCH_ENV = "CLOUDFLARE_KEYCHAIN";

/**
 * A credential store keyed by env-var name (for example `CLOUDFLARE_API_TOKEN`).
 * The default implementation is the OS keychain via `Bun.secrets`; tests
 * inject an in-memory store.
 */
export interface SecretStore {
  readonly description: string;
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

/** The kinds of credential `cloudflare auth set` can store. */
export const CREDENTIAL_RESOURCES = ["api-token", "global-api-key"] as const;
export type CredentialResource = (typeof CREDENTIAL_RESOURCES)[number];

/**
 * Keychain entry names per resource, named exactly like their env vars.
 * The `CLOUDFLARE_API_EMAIL` alias stays env-only. Account and zone IDs are
 * not secrets, so they stay in env, .env, or per-call flags.
 */
const RESOURCE_CREDENTIAL_KEYS: Record<CredentialResource, readonly string[]> = {
  "api-token": ["CLOUDFLARE_API_TOKEN"],
  "global-api-key": ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"],
};

export const CREDENTIAL_KEYS: readonly string[] = CREDENTIAL_RESOURCES.flatMap(
  (resource) => RESOURCE_CREDENTIAL_KEYS[resource]
);

export function resourceCredentialKeys(resource: CredentialResource): readonly string[] {
  return RESOURCE_CREDENTIAL_KEYS[resource];
}

export function resourceForCredentialKey(key: string): CredentialResource | undefined {
  return CREDENTIAL_RESOURCES.find((resource) => RESOURCE_CREDENTIAL_KEYS[resource].includes(key));
}

interface BunSecretsApi {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<void>;
  delete(options: { service: string; name: string }): Promise<boolean>;
}

function bunSecretsApi(): BunSecretsApi | undefined {
  const bun = (globalThis as { Bun?: { secrets?: BunSecretsApi } }).Bun;
  return bun?.secrets;
}

/**
 * The OS keychain (macOS Keychain, Linux libsecret, Windows Credential
 * Manager) via `Bun.secrets`. Every failure, including running on Node where
 * `Bun.secrets` does not exist, becomes a `CloudflareConfigError`.
 */
export function bunSecretStore(service: string = KEYCHAIN_SERVICE): SecretStore {
  const api = (): BunSecretsApi => {
    const secrets = bunSecretsApi();
    if (!secrets) {
      throw new CloudflareConfigError("The OS keychain is not available in this runtime", {
        hint:
          "Keychain lookup needs the Bun runtime (1.3 or newer): the standalone binary, `bun run`, or " +
          "`bunx --bun`. Otherwise set credentials through env, .env, or op run.",
      });
    }
    return secrets;
  };
  const wrap = async <T>(action: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof CloudflareConfigError) throw error;
      throw new CloudflareConfigError(`Could not ${action} the OS keychain`, {
        detail: error instanceof Error ? error.message : String(error),
        hint:
          "On macOS, unlock the login keychain and allow access when prompted. On Linux, start a " +
          "Secret Service daemon (GNOME Keyring or KWallet). Otherwise set credentials through env, " +
          ".env, or op run.",
        cause: error,
      });
    }
  };
  return {
    description: `os-keychain:${service}`,
    get: (name) => wrap("read from", () => api().get({ service, name })),
    set: (name, value) => wrap("write to", () => api().set({ service, name, value })),
    delete: (name) => wrap("delete from", () => api().delete({ service, name })),
  };
}

export type KeychainStatus = "ok" | "disabled" | "unavailable";

export interface KeychainState {
  status: KeychainStatus;
  error?: string;
}

export interface KeychainReadResult extends KeychainState {
  values: Record<string, string>;
}

/** Message for a caught store error, preferring the underlying cause. */
export function keychainErrorText(error: unknown): string {
  if (error instanceof CloudflareConfigError) return error.detail ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read the given credential names in parallel. A store failure is reported
 * as `unavailable` instead of thrown, so a missing keychain never breaks a
 * command that has credentials from elsewhere.
 */
export async function readKeychainValues(
  store: SecretStore,
  names: readonly string[]
): Promise<KeychainReadResult> {
  try {
    const entries = await Promise.all(
      names.map(async (name) => [name, await store.get(name)] as const)
    );
    const values: Record<string, string> = {};
    for (const [name, value] of entries) {
      if (value) values[name] = value;
    }
    return { status: "ok", values };
  } catch (error) {
    return { status: "unavailable", values: {}, error: keychainErrorText(error) };
  }
}

/** True when a `CLOUDFLARE_KEYCHAIN` value turns the keychain off. */
export function isKeychainDisabled(value: string | undefined): boolean {
  return ["0", "false", "no", "off"].includes((value ?? "").trim().toLowerCase());
}
