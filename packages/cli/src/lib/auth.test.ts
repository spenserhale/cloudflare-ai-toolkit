import { describe, expect, it } from "vitest";
import type { ResolvedConfig, SecretStore } from "@cloudflare-ai-toolkit/sdk";
import {
  AuthUsageError,
  deleteCredentials,
  exitCodeFor,
  listCredentials,
  migrateCredentials,
  parseResource,
  selectCredentialKeys,
  setCredentials,
} from "./auth.js";

/** In-memory SecretStore; these tests never touch the real keychain. */
function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store: SecretStore = {
    description: "memory",
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      values.set(name, value);
    },
    delete: async (name) => values.delete(name),
  };
  return { store, values };
}

function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    auth: { type: "apiToken", token: "" },
    baseUrl: "https://api.cloudflare.com",
    credentialSources: {
      CLOUDFLARE_API_TOKEN: "missing",
      CLOUDFLARE_API_KEY: "missing",
      CLOUDFLARE_EMAIL: "missing",
    },
    keychain: { status: "disabled" },
    envFile: null,
    ...overrides,
  };
}

describe("parseResource / selectCredentialKeys", () => {
  it("rejects unknown credentials and keys as usage errors", () => {
    expect(() => parseResource("ssh-key")).toThrow(AuthUsageError);
    expect(() => selectCredentialKeys("api-token", "CLOUDFLARE_EMAIL")).toThrow(AuthUsageError);
    expect(exitCodeFor(new AuthUsageError("x"))).toBe(2);
  });

  it("expands a credential to its keys, or narrows to --key", () => {
    expect(selectCredentialKeys(parseResource("Global-API-Key"), undefined)).toEqual([
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_EMAIL",
    ]);
    expect(selectCredentialKeys("global-api-key", "cloudflare_email")).toEqual(["CLOUDFLARE_EMAIL"]);
  });
});

describe("setCredentials", () => {
  it("trims and stores the value", async () => {
    const { store, values } = memoryStore();
    const result = await setCredentials({
      resource: "api-token",
      keys: ["CLOUDFLARE_API_TOKEN"],
      readValue: async () => "  tok-123\n",
      store,
      config: config(),
      dryRun: false,
    });

    expect(values.get("CLOUDFLARE_API_TOKEN")).toBe("tok-123");
    expect(result.credentials).toEqual([{ key: "CLOUDFLARE_API_TOKEN", action: "stored" }]);
  });

  it("writes nothing with --dry-run", async () => {
    const { store, values } = memoryStore();
    const result = await setCredentials({
      resource: "api-token",
      keys: ["CLOUDFLARE_API_TOKEN"],
      readValue: async () => "tok-123",
      store,
      config: config(),
      dryRun: true,
    });

    expect(values.size).toBe(0);
    expect(result.credentials[0]?.action).toBe("would_store");
  });

  it("rejects empty input and stores nothing, even for keys already read", async () => {
    const { store, values } = memoryStore();
    const answers = ["key-1", "   "];
    await expect(
      setCredentials({
        resource: "global-api-key",
        keys: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"],
        readValue: async () => answers.shift() ?? "",
        store,
        config: config(),
        dryRun: false,
      })
    ).rejects.toThrow(/CLOUDFLARE_EMAIL must not be empty/);
    expect(values.size).toBe(0);
  });

  it("flags a stored value that env or .env still shadows", async () => {
    const { store } = memoryStore();
    const result = await setCredentials({
      resource: "global-api-key",
      keys: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"],
      readValue: async (key) => (key === "CLOUDFLARE_API_KEY" ? "k" : "a@example.com"),
      store,
      config: config({
        credentialSources: {
          CLOUDFLARE_API_TOKEN: "missing",
          CLOUDFLARE_API_KEY: "env",
          CLOUDFLARE_EMAIL: "envfile:/p/.env",
        },
      }),
      dryRun: false,
    });

    expect(result.credentials).toEqual([
      { key: "CLOUDFLARE_API_KEY", action: "stored", shadowed_by: "env" },
      { key: "CLOUDFLARE_EMAIL", action: "stored", shadowed_by: "envfile:/p/.env" },
    ]);
  });
});

describe("listCredentials", () => {
  it("reports keychain state and active source without printing values", async () => {
    const secret = "super-secret-token-value";
    const { store } = memoryStore({ CLOUDFLARE_API_TOKEN: secret });
    const result = await listCredentials(
      store,
      config({
        auth: { type: "apiToken", token: secret },
        credentialSources: {
          CLOUDFLARE_API_TOKEN: "keychain",
          CLOUDFLARE_API_KEY: "missing",
          CLOUDFLARE_EMAIL: "missing",
        },
      })
    );

    expect(result.keychain_status).toBe("ok");
    expect(result.credentials).toContainEqual({
      resource: "api-token",
      key: "CLOUDFLARE_API_TOKEN",
      keychain: "set",
      active_source: "keychain",
    });
    expect(result.credentials.find((row) => row.key === "CLOUDFLARE_EMAIL")?.keychain).toBe("missing");
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("marks every key unknown when the store cannot be read", async () => {
    const store: SecretStore = {
      description: "broken",
      get: async () => {
        throw new Error("keychain locked");
      },
      set: async () => undefined,
      delete: async () => false,
    };
    const result = await listCredentials(store, config());

    expect(result.keychain_status).toBe("unavailable");
    expect(result.keychain_error).toBe("keychain locked");
    expect(result.credentials.every((row) => row.keychain === "unknown")).toBe(true);
  });
});

describe("deleteCredentials", () => {
  it("reports deleted and not_found, and deletes nothing on a dry run", async () => {
    const { store, values } = memoryStore({ CLOUDFLARE_API_KEY: "k" });
    const keys = ["CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"];

    const preview = await deleteCredentials({ resource: "global-api-key", keys, store, dryRun: true });
    expect(preview.credentials.map((row) => row.action)).toEqual(["would_delete", "would_delete"]);
    expect(values.has("CLOUDFLARE_API_KEY")).toBe(true);

    const result = await deleteCredentials({ resource: "global-api-key", keys, store, dryRun: false });
    expect(result.credentials).toEqual([
      { key: "CLOUDFLARE_API_KEY", action: "deleted" },
      { key: "CLOUDFLARE_EMAIL", action: "not_found" },
    ]);
  });
});

describe("migrateCredentials", () => {
  const envFile = "/project/.env";
  const migrateConfig = config({
    auth: { type: "apiToken", token: "file-token" },
    credentialSources: {
      CLOUDFLARE_API_TOKEN: `envfile:${envFile}`,
      CLOUDFLARE_API_KEY: "env",
      CLOUDFLARE_EMAIL: `envfile:${envFile}`,
    },
    envFile,
  });
  const envFileValues = {
    CLOUDFLARE_API_TOKEN: "file-token",
    CLOUDFLARE_API_EMAIL: "file@example.com",
  };

  it("stores .env credentials, ignores process env, and lists files to clean up", async () => {
    const { store, values } = memoryStore();
    const result = await migrateCredentials({
      store,
      config: migrateConfig,
      envFileValues,
      dryRun: false,
      overwrite: false,
    });

    expect(values.get("CLOUDFLARE_API_TOKEN")).toBe("file-token");
    expect(values.get("CLOUDFLARE_EMAIL")).toBe("file@example.com");
    expect(values.has("CLOUDFLARE_API_KEY")).toBe(false);
    expect(result.credentials.map((row) => [row.key, row.action])).toEqual([
      ["CLOUDFLARE_API_TOKEN", "stored"],
      ["CLOUDFLARE_EMAIL", "stored"],
    ]);
    expect(result.clean_up).toEqual([envFile]);
  });

  it("skips keys already in the keychain unless --overwrite", async () => {
    const { store, values } = memoryStore({ CLOUDFLARE_API_TOKEN: "already" });
    const skipped = await migrateCredentials({
      store,
      config: migrateConfig,
      envFileValues,
      dryRun: false,
      overwrite: false,
    });
    expect(skipped.credentials[0]).toMatchObject({ key: "CLOUDFLARE_API_TOKEN", action: "skipped_exists" });
    expect(values.get("CLOUDFLARE_API_TOKEN")).toBe("already");

    await migrateCredentials({ store, config: migrateConfig, envFileValues, dryRun: false, overwrite: true });
    expect(values.get("CLOUDFLARE_API_TOKEN")).toBe("file-token");
  });

  it("writes nothing with --dry-run", async () => {
    const { store, values } = memoryStore();
    const result = await migrateCredentials({
      store,
      config: migrateConfig,
      envFileValues,
      dryRun: true,
      overwrite: false,
    });
    expect(values.size).toBe(0);
    expect(result.credentials.every((row) => row.action === "would_store")).toBe(true);
  });
});
