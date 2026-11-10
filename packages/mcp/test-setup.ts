// Loaded before every `bun test` file (see bunfig.toml). Tests must never
// read or write the developer's real OS keychain.
process.env.CLOUDFLARE_KEYCHAIN = "0";
