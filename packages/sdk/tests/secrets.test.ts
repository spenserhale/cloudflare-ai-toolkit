import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { CloudflareConfigError } from "../src/errors.js";
import {
  CREDENTIAL_KEYS,
  readKeychainValues,
  resourceForCredentialKey,
  type SecretStore,
} from "../src/secrets.js";

/** In-memory store that records every `get`, so tests never touch the real keychain. */
function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const gets: string[] = [];
  const store: SecretStore = {
    description: "memory",
    get: async (name) => {
      gets.push(name);
      return values.get(name) ?? null;
    },
    set: async (name, value) => {
      values.set(name, value);
    },
    delete: async (name) => values.delete(name),
  };
  return { store, values, gets };
}

function throwingStore(): SecretStore & { calls: number } {
  const store = {
    description: "broken",
    calls: 0,
    get: async () => {
      store.calls += 1;
      throw new CloudflareConfigError("Could not read from the OS keychain", {
        detail: "no secret service",
      });
    },
    set: async () => {
      throw new Error("unreachable");
    },
    delete: async () => {
      throw new Error("unreachable");
    },
  };
  return store;
}

const tempDirs: string[] = [];

/** A fresh directory with an optional .env, so the developer's own .env never leaks in. */
function projectDir(dotenv?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-toolkit-secrets-"));
  tempDirs.push(dir);
  if (dotenv !== undefined) writeFileSync(join(dir, ".env"), dotenv, "utf8");
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("credential keys", () => {
  it("names entries after their env vars and maps them back to a resource", () => {
    expect(CREDENTIAL_KEYS).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"]);
    expect(resourceForCredentialKey("CLOUDFLARE_EMAIL")).toBe("global-api-key");
    expect(resourceForCredentialKey("CLOUDFLARE_API_EMAIL")).toBeUndefined();
  });
});

describe("loadConfig with a secret store", () => {
  it("resolves the token from the keychain when env and .env are empty", async () => {
    const { store } = memoryStore({ CLOUDFLARE_API_TOKEN: "kc-token" });
    const config = await loadConfig({ env: {}, cwd: projectDir(), secretStore: store });

    expect(config.auth).toEqual({ type: "apiToken", token: "kc-token" });
    expect(config.credentialSources.CLOUDFLARE_API_TOKEN).toBe("keychain");
    expect(config.keychain).toEqual({ status: "ok" });
  });

  it("ranks env over .env over keychain", async () => {
    const { store } = memoryStore({ CLOUDFLARE_API_TOKEN: "kc-token", CLOUDFLARE_API_KEY: "kc-key" });
    const dir = projectDir("CLOUDFLARE_API_TOKEN=file-token\n");

    const fromEnv = await loadConfig({
      env: { CLOUDFLARE_API_TOKEN: "env-token" },
      cwd: dir,
      secretStore: store,
    });
    expect(fromEnv.auth).toEqual({ type: "apiToken", token: "env-token" });
    expect(fromEnv.credentialSources.CLOUDFLARE_API_TOKEN).toBe("env");

    const fromFile = await loadConfig({ env: {}, cwd: dir, secretStore: store });
    expect(fromFile.auth).toEqual({ type: "apiToken", token: "file-token" });
    expect(fromFile.credentialSources.CLOUDFLARE_API_TOKEN).toBe(`envfile:${join(dir, ".env")}`);
  });

  it("attributes a process env value copied from .env (Bun autoload) to the file", async () => {
    const dir = projectDir("CLOUDFLARE_API_TOKEN=file-token\n");
    const config = await loadConfig({
      env: { CLOUDFLARE_API_TOKEN: "file-token" },
      cwd: dir,
      secretStore: null,
    });
    expect(config.credentialSources.CLOUDFLARE_API_TOKEN).toBe(`envfile:${join(dir, ".env")}`);
  });

  it("lets an explicit global API key beat a token that only lives in the keychain", async () => {
    const { store } = memoryStore({ CLOUDFLARE_API_TOKEN: "kc-token" });
    const config = await loadConfig({
      env: { CLOUDFLARE_API_KEY: "env-key", CLOUDFLARE_EMAIL: "dev@example.com" },
      cwd: projectDir(),
      secretStore: store,
    });

    expect(config.auth).toEqual({ type: "globalApiKey", apiKey: "env-key", email: "dev@example.com" });
  });

  it("resolves a global API key pair from the keychain", async () => {
    const { store } = memoryStore({ CLOUDFLARE_API_KEY: "kc-key", CLOUDFLARE_EMAIL: "kc@example.com" });
    const config = await loadConfig({ env: {}, cwd: projectDir(), secretStore: store });

    expect(config.auth).toEqual({ type: "globalApiKey", apiKey: "kc-key", email: "kc@example.com" });
    expect(config.credentialSources.CLOUDFLARE_EMAIL).toBe("keychain");
  });

  it("asks the store only for keys env and .env did not supply", async () => {
    const { store, gets } = memoryStore();
    await loadConfig({
      env: { CLOUDFLARE_API_KEY: "env-key" },
      cwd: projectDir(),
      secretStore: store,
    });
    expect(gets.sort()).toEqual(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL"]);
  });

  it("does not touch the store when env already holds a complete credential", async () => {
    const { store, gets } = memoryStore();
    await loadConfig({ env: { CLOUDFLARE_API_TOKEN: "env-token" }, cwd: projectDir(), secretStore: store });
    await loadConfig({
      env: {},
      cwd: projectDir("CLOUDFLARE_API_KEY=k\nCLOUDFLARE_API_EMAIL=a@example.com\n"),
      secretStore: store,
    });
    expect(gets).toEqual([]);
  });

  it("skips the store when CLOUDFLARE_KEYCHAIN=0 in env or .env", async () => {
    const { store, gets } = memoryStore({ CLOUDFLARE_API_TOKEN: "kc-token" });

    const viaEnv = await loadConfig({
      env: { CLOUDFLARE_KEYCHAIN: "0" },
      cwd: projectDir(),
      secretStore: store,
    });
    const viaFile = await loadConfig({
      env: {},
      cwd: projectDir("CLOUDFLARE_KEYCHAIN=off\n"),
      secretStore: store,
    });
    const viaNull = await loadConfig({ env: {}, cwd: projectDir(), secretStore: null });

    expect(gets).toEqual([]);
    for (const config of [viaEnv, viaFile, viaNull]) {
      expect(config.keychain).toEqual({ status: "disabled" });
      expect(config.auth).toEqual({ type: "apiToken", token: "" });
    }
  });

  it("reports an unavailable store and still uses env credentials", async () => {
    const store = throwingStore();
    const config = await loadConfig({
      env: { CLOUDFLARE_API_KEY: "env-key", CLOUDFLARE_ACCOUNT_ID: "acc" },
      cwd: projectDir(),
      secretStore: store,
    });

    expect(store.calls).toBeGreaterThan(0);
    expect(config.keychain).toEqual({ status: "unavailable", error: "no secret service" });
    expect(config.auth).toEqual({ type: "globalApiKey", apiKey: "env-key", email: "" });
    expect(config.accountId).toBe("acc");
  });
});

describe("readKeychainValues", () => {
  it("drops empty values", async () => {
    const { store } = memoryStore({ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_EMAIL: "" });
    const result = await readKeychainValues(store, ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL"]);
    expect(result).toEqual({ status: "ok", values: { CLOUDFLARE_API_TOKEN: "t" } });
  });

  it("never throws", async () => {
    const result = await readKeychainValues(throwingStore(), ["CLOUDFLARE_API_TOKEN"]);
    expect(result.status).toBe("unavailable");
    expect(result.values).toEqual({});
  });
});
