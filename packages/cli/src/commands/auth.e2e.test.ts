import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CLI_ENTRY = join(PACKAGE_ROOT, "src/bin.ts");
const BUN_BIN = process.env.BUN_BIN ?? "bun";
const WORK_DIR = mkdtempSync(join(tmpdir(), "cf-cli-auth-e2e-"));

afterAll(() => rmSync(WORK_DIR, { recursive: true, force: true }));

interface RunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the CLI with CLOUDFLARE_KEYCHAIN=0 and no CLOUDFLARE_* vars. None of
 * these cases reaches a keychain write: each fails validation first or is a
 * dry run. `stdin` undefined means no stdin at all (not a TTY).
 */
function runCli(args: readonly string[], stdin?: string): Promise<RunResult> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_"))
  );
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(BUN_BIN, [CLI_ENTRY, ...args], {
      cwd: WORK_DIR,
      env: { ...env, CLOUDFLARE_KEYCHAIN: "0" },
      stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

describe("cloudflare auth (e2e)", () => {
  it("exits 2 when there is no terminal and no --stdin", async () => {
    const result = await runCli(["auth", "set", "api-token"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--stdin");
  }, 30_000);

  it("exits 2 for --stdin on a two-key credential without --key", async () => {
    const result = await runCli(["auth", "set", "global-api-key", "--stdin"], "value\n");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--key CLOUDFLARE_API_KEY --stdin");
  }, 30_000);

  it("accepts --stdin --dry-run without echoing the secret", async () => {
    const secret = "e2e-dummy-secret-value";
    const result = await runCli(["auth", "set", "api-token", "--stdin", "--dry-run", "--json"], `${secret}\n`);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      resource: "api-token",
      dry_run: true,
      credentials: [{ key: "CLOUDFLARE_API_TOKEN", action: "would_store" }],
    });
    expect(result.stdout + result.stderr).not.toContain(secret);
  }, 30_000);

  it("exits 2 when delete lacks --yes", async () => {
    const result = await runCli(["auth", "delete", "api-token"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--yes");
  }, 30_000);

  it("exits 2 for an unknown credential", async () => {
    const result = await runCli(["auth", "set", "ssh-key", "--stdin", "--dry-run"], "x\n");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("api-token, global-api-key");
  }, 30_000);
});
