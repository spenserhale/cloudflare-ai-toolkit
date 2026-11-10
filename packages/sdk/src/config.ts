import type { CloudflareAuth, CloudflareConfig } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  bunSecretStore,
  CREDENTIAL_KEYS,
  isKeychainDisabled,
  KEYCHAIN_SWITCH_ENV,
  readKeychainValues,
  type KeychainState,
  type SecretStore,
} from "./secrets.js";

export type Env = Record<string, string | undefined>;

export interface DotEnvFile {
  /** Absolute path of the nearest .env, or null when none was found. */
  readonly path: string | null;
  readonly values: Record<string, string>;
}

const DOTENV_CACHE = new Map<string, DotEnvFile>();

function parseDotEnv(source: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trimStart()
      : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;

    let value = normalized.slice(equalsIndex + 1).trim();
    const isDoubleQuoted = value.startsWith("\"") && value.endsWith("\"");
    const isSingleQuoted = value.startsWith("'") && value.endsWith("'");

    if (isDoubleQuoted || isSingleQuoted) {
      value = value.slice(1, -1);
    } else {
      const inlineCommentStart = value.indexOf(" #");
      if (inlineCommentStart >= 0) {
        value = value.slice(0, inlineCommentStart).trimEnd();
      }
    }

    entries[key] = value;
  }

  return entries;
}

/**
 * The nearest `.env` at or above `cwd`, parsed. Cached per directory for the
 * life of the process.
 */
export function readDotEnv(cwd: string = process.cwd()): DotEnvFile {
  return loadDotEnv(resolve(cwd));
}

function loadDotEnv(cwd: string): DotEnvFile {
  const cached = DOTENV_CACHE.get(cwd);
  if (cached) return cached;

  let currentDir = cwd;
  while (true) {
    const envPath = join(currentDir, ".env");
    if (existsSync(envPath)) {
      const found = { path: envPath, values: parseDotEnv(readFileSync(envPath, "utf8")) };
      DOTENV_CACHE.set(cwd, found);
      return found;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  const empty: DotEnvFile = { path: null, values: {} };
  DOTENV_CACHE.set(cwd, empty);
  return empty;
}

/** Configuration plus where each credential came from. Safe to pass to `CloudflareClient`. */
export interface ResolvedConfig extends CloudflareConfig {
  /**
   * Winning source per credential key: `env`, `envfile:<path>`, `keychain`,
   * or `missing`. Never contains values.
   */
  credentialSources: Record<string, string>;
  /** Whether the OS keychain was consulted for credentials. */
  keychain: KeychainState;
  /** The nearest .env file, if one was found. */
  envFile: string | null;
}

export interface ResolveConfigOptions {
  /** Defaults to `process.env`. */
  env?: Env;
  /** Directory to search upward from for `.env`. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Credentials already read from the OS keychain; see `loadConfig()`. */
  keychainValues?: Record<string, string>;
  /** Keychain lookup status to report; defaults to disabled. */
  keychain?: KeychainState;
}

export interface LoadConfigOptions extends Omit<ResolveConfigOptions, "keychainValues" | "keychain"> {
  overrides?: Partial<CloudflareConfig>;
  /** Store to read credentials from. Defaults to the OS keychain; pass null to skip it. */
  secretStore?: SecretStore | null;
}

interface Picked {
  readonly value: string;
  readonly source: string;
}

/** Lower is stronger: process env beats .env, which beats the keychain. */
function sourceRank(source: string): number {
  if (source === "env") return 0;
  if (source.startsWith("envfile:")) return 1;
  if (source === "keychain") return 2;
  return 3;
}

function makePicker(env: Env, dotenv: DotEnvFile, keychainValues: Record<string, string>) {
  return (key: string, aliases: readonly string[] = []): Picked | undefined => {
    const names = [key, ...aliases];
    for (const name of names) {
      const direct = env[name];
      if (direct && direct.length > 0) {
        // Bun copies ./.env into process.env at startup. A value identical to
        // the nearest .env's came from that file, so label it as such.
        const source =
          dotenv.path && dotenv.values[name] === direct ? `envfile:${dotenv.path}` : "env";
        return { value: direct, source };
      }
    }
    for (const name of names) {
      const fromFile = dotenv.values[name];
      if (fromFile && fromFile.length > 0) {
        return { value: fromFile, source: `envfile:${dotenv.path ?? "unknown"}` };
      }
    }
    const fromKeychain = keychainValues[key];
    if (fromKeychain) return { value: fromKeychain, source: "keychain" };
    return undefined;
  };
}

const EMAIL_ALIASES = ["CLOUDFLARE_API_EMAIL"] as const;

/**
 * Resolve configuration from the process environment, the nearest `.env`,
 * and keychain values the caller already read. Synchronous; use
 * `loadConfig()` to include the OS keychain.
 *
 * Precedence per credential: process env > nearest .env > keychain.
 * When both an API token and a global API key resolve, the one from the
 * stronger source wins, and the token wins a tie.
 */
export function resolveConfig(
  overrides: Partial<CloudflareConfig> = {},
  options: ResolveConfigOptions = {}
): ResolvedConfig {
  const env = options.env ?? process.env;
  const dotenv = loadDotEnv(resolve(options.cwd ?? process.cwd()));
  const pick = makePicker(env, dotenv, options.keychainValues ?? {});
  const pickPlain = makePicker(env, dotenv, {});

  const token = pick("CLOUDFLARE_API_TOKEN");
  const apiKey = pick("CLOUDFLARE_API_KEY");
  const email = pick("CLOUDFLARE_EMAIL", EMAIL_ALIASES);

  const credentialSources: Record<string, string> = {
    CLOUDFLARE_API_TOKEN: token?.source ?? "missing",
    CLOUDFLARE_API_KEY: apiKey?.source ?? "missing",
    CLOUDFLARE_EMAIL: email?.source ?? "missing",
  };

  const resolvedAuth: CloudflareAuth =
    overrides.auth ??
    (() => {
      if (token && (!apiKey || sourceRank(token.source) <= sourceRank(apiKey.source))) {
        return { type: "apiToken", token: token.value };
      }
      if (apiKey) {
        return { type: "globalApiKey", apiKey: apiKey.value, email: email?.value ?? "" };
      }
      return { type: "apiToken", token: "" };
    })();

  return {
    auth: resolvedAuth,
    baseUrl:
      overrides.baseUrl ?? pickPlain("CLOUDFLARE_BASE_URL")?.value ?? "https://api.cloudflare.com",
    accountId: overrides.accountId ?? pickPlain("CLOUDFLARE_ACCOUNT_ID")?.value,
    zoneId: overrides.zoneId ?? pickPlain("CLOUDFLARE_ZONE_ID")?.value,
    credentialSources,
    keychain: options.keychain ?? { status: "disabled" },
    envFile: dotenv.path,
  };
}

/**
 * Credential keys the keychain still needs to supply. Empty when env or
 * .env already provide a complete credential, so an explicit token never
 * triggers a keychain prompt.
 */
function missingCredentialKeys(env: Env, dotenv: DotEnvFile): string[] {
  const pick = makePicker(env, dotenv, {});
  if (pick("CLOUDFLARE_API_TOKEN")) return [];
  if (pick("CLOUDFLARE_API_KEY") && pick("CLOUDFLARE_EMAIL", EMAIL_ALIASES)) return [];
  return CREDENTIAL_KEYS.filter((key) =>
    key === "CLOUDFLARE_EMAIL" ? !pick(key, EMAIL_ALIASES) : !pick(key)
  );
}

/**
 * `resolveConfig()` plus the OS keychain. Only credentials that the process
 * environment and `.env` did not supply are looked up. Set
 * `CLOUDFLARE_KEYCHAIN=0` (in env or .env), or pass `secretStore: null`, to
 * skip the lookup entirely. A keychain failure is reported in
 * `config.keychain`, never thrown.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedConfig> {
  const { secretStore, overrides = {}, ...resolveOptions } = options;
  const env = resolveOptions.env ?? process.env;
  const dotenv = loadDotEnv(resolve(resolveOptions.cwd ?? process.cwd()));
  const keychainSwitch = env[KEYCHAIN_SWITCH_ENV] ?? dotenv.values[KEYCHAIN_SWITCH_ENV];

  if (secretStore === null || isKeychainDisabled(keychainSwitch)) {
    return resolveConfig(overrides, { ...resolveOptions, keychain: { status: "disabled" } });
  }

  const missing = overrides.auth ? [] : missingCredentialKeys(env, dotenv);
  if (missing.length === 0) {
    return resolveConfig(overrides, { ...resolveOptions, keychain: { status: "ok" } });
  }

  const result = await readKeychainValues(secretStore ?? bunSecretStore(), missing);
  return resolveConfig(overrides, {
    ...resolveOptions,
    keychainValues: result.values,
    keychain: result.error ? { status: result.status, error: result.error } : { status: result.status },
  });
}
