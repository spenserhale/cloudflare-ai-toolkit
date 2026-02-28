import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.js";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_CWD = process.cwd();

function restoreProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

afterEach(() => {
  restoreProcessEnv();
  process.chdir(ORIGINAL_CWD);
});

describe("resolveConfig", () => {
  it("uses CLOUDFLARE_API_TOKEN from process.env", () => {
    process.env.CLOUDFLARE_API_TOKEN = "api-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";

    const config = resolveConfig();

    expect(config.auth).toEqual({
      type: "apiToken",
      token: "api-token",
    });
    expect(config.accountId).toBe("account-id");
  });

  it("falls back to legacy global API key auth when no token is set", () => {
    const isolatedDir = mkdtempSync(join(tmpdir(), "cloudflare-toolkit-config-isolated-"));
    delete process.env.CLOUDFLARE_API_TOKEN;
    process.env.CLOUDFLARE_API_KEY = "legacy-key";
    process.env.CLOUDFLARE_API_EMAIL = "dev@example.com";

    try {
      process.chdir(isolatedDir);
      const config = resolveConfig();

      expect(config.auth).toEqual({
        type: "globalApiKey",
        apiKey: "legacy-key",
        email: "dev@example.com",
      });
    } finally {
      rmSync(isolatedDir, { recursive: true, force: true });
    }
  });

  it("prefers CLOUDFLARE_API_TOKEN over legacy key/email when both are set", () => {
    process.env.CLOUDFLARE_API_TOKEN = "preferred-token";
    process.env.CLOUDFLARE_API_KEY = "legacy-key";
    process.env.CLOUDFLARE_EMAIL = "dev@example.com";

    const config = resolveConfig();

    expect(config.auth).toEqual({
      type: "apiToken",
      token: "preferred-token",
    });
  });

  it("loads .env from parent directories of the current working directory", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "cloudflare-toolkit-config-"));
    const nestedDir = join(rootDir, "packages", "cli");
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(
      join(rootDir, ".env"),
      "CLOUDFLARE_API_TOKEN=dotenv-token\nCLOUDFLARE_ACCOUNT_ID=dotenv-account\n",
      "utf8"
    );

    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    process.chdir(nestedDir);

    try {
      const config = resolveConfig();

      expect(config.auth).toEqual({
        type: "apiToken",
        token: "dotenv-token",
      });
      expect(config.accountId).toBe("dotenv-account");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
