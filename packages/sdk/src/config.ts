import type { CloudflareConfig } from "./types.js";

/**
 * Resolve configuration from environment variables.
 * Useful for both CLI and MCP contexts.
 */
export function resolveConfig(
  overrides: Partial<CloudflareConfig> = {}
): CloudflareConfig {
  return {
    apiKey: overrides.apiKey ?? process.env.CLOUDFLARE_API_KEY ?? "",
    baseUrl:
      overrides.baseUrl ??
      process.env.CLOUDFLARE_BASE_URL ??
      "https://api.cloudflare.com",
    accountId: overrides.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
  };
}
