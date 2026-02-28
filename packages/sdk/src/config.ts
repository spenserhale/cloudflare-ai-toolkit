import type { CloudflareAuth, CloudflareConfig } from "./types.js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DOTENV_CACHE = new Map<string, Record<string, string>>();

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

function loadDotEnvFromCwd(): Record<string, string> {
  const cwd = process.cwd();
  const cached = DOTENV_CACHE.get(cwd);
  if (cached) return cached;

  let currentDir = cwd;
  while (true) {
    const envPath = join(currentDir, ".env");
    if (existsSync(envPath)) {
      const parsed = parseDotEnv(readFileSync(envPath, "utf8"));
      DOTENV_CACHE.set(cwd, parsed);
      return parsed;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  const empty: Record<string, string> = {};
  DOTENV_CACHE.set(cwd, empty);
  return empty;
}

function resolveEnvVar(...names: string[]): string | undefined {
  for (const name of names) {
    const direct = process.env[name];
    if (direct && direct.length > 0) return direct;
  }

  const dotenv = loadDotEnvFromCwd();
  for (const name of names) {
    const fromFile = dotenv[name];
    if (fromFile && fromFile.length > 0) return fromFile;
  }

  return undefined;
}

/**
 * Resolve configuration from environment variables.
 * Useful for both CLI and MCP contexts.
 */
export function resolveConfig(
  overrides: Partial<CloudflareConfig> = {}
): CloudflareConfig {
  const resolvedAuth: CloudflareAuth =
    overrides.auth ??
    (() => {
      const token = resolveEnvVar("CLOUDFLARE_API_TOKEN");
      if (token) {
        return {
          type: "apiToken",
          token,
        };
      }

      const globalApiKey = resolveEnvVar("CLOUDFLARE_API_KEY");
      if (globalApiKey) {
        return {
          type: "globalApiKey",
          apiKey: globalApiKey,
          email:
            resolveEnvVar("CLOUDFLARE_EMAIL", "CLOUDFLARE_API_EMAIL") ?? "",
        };
      }

      return {
        type: "apiToken",
        token: "",
      };
    })();

  return {
    auth: resolvedAuth,
    baseUrl:
      overrides.baseUrl ??
      resolveEnvVar("CLOUDFLARE_BASE_URL") ??
      "https://api.cloudflare.com",
    accountId:
      overrides.accountId ??
      resolveEnvVar("CLOUDFLARE_ACCOUNT_ID"),
  };
}
