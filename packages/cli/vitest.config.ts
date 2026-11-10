import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests must never read or write the developer's real OS keychain.
    env: { CLOUDFLARE_KEYCHAIN: "0" },
  },
});
