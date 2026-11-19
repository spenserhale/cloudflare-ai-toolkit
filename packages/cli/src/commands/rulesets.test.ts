import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type StricliProcess } from "@stricli/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../app.js";

const mocks = vi.hoisted(() => ({ readAllStdin: vi.fn<() => Promise<string>>() }));

vi.mock("../lib/prompt.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/prompt.js")>(),
  readAllStdin: mocks.readAllStdin,
}));

vi.mock("@cloudflare-ai-toolkit/sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@cloudflare-ai-toolkit/sdk")>(),
  loadConfig: async () => ({
    auth: { type: "apiToken", token: "test-token" },
    baseUrl: "https://mock.cloudflare.test",
    zoneId: "default-zone",
    accountId: "default-account",
  }),
}));

const fetchMock = vi.fn<typeof fetch>();
const zonePath = "/client/v4/zones/default-zone/rulesets/rs-1";
const accountPath = "/client/v4/accounts/default-account/rulesets/rs-1";
const command = ["rulesets", "rules", "update", "--ruleset-id", "rs-1"];
const patch = {
  action: "block",
  expression: 'http.request.uri.path eq "/private"',
  description: "New description",
  enabled: false,
  ref: "rule-reference",
};
const oldRule = {
  id: "rule-2",
  action: "block",
  version: "7",
  description: "Old description",
  last_updated: "2026-11-18T11:00:00Z",
};
const neighbor = { id: "rule-1", action: "challenge", action_parameters: null };
const current = { id: "rs-1", version: "319", rules: [neighbor, oldRule] };
const updatedRule = {
  ...oldRule,
  ...patch,
  version: "8",
  last_updated: "2026-11-19T11:00:00Z",
};
const updated = { ...current, version: "320", rules: [neighbor, updatedRule] };
let tempDir: string;
let bodyPath: string;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("Unexpected fetch"));
  vi.stubGlobal("fetch", fetchMock);
  mocks.readAllStdin.mockReset().mockResolvedValue(JSON.stringify(patch));
  tempDir = mkdtempSync(join(tmpdir(), "cf-rulesets-test-"));
  bodyPath = join(tempDir, "patch.json");
  writeFileSync(bodyPath, JSON.stringify(patch));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
});

async function invoke(args: readonly string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line) => { stdout.push(String(line)); });
  vi.spyOn(process.stderr, "write").mockImplementation((line, _encoding, onWritten) => {
    queueMicrotask(() => {
      stderr.push(String(line));
      onWritten?.();
    });
    return false;
  });
  let stderrAtExit: string | undefined;
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    stderrAtExit = stderr.join("\n");
    return undefined as never;
  });
  const processContext: StricliProcess = {
    stdout: { write: (line) => { stdout.push(line); } },
    stderr: { write: (line) => { stderr.push(line); } },
    env: { STRICLI_NO_COLOR: "1", STRICLI_SKIP_VERSION_CHECK: "1" },
    exitCode: 0,
  };
  await run(app, args, { process: processContext });
  return {
    stdout: stdout.join("\n"),
    stderr: stderrAtExit ?? stderr.join("\n"),
    code: Number(exit.mock.lastCall?.[0] ?? processContext.exitCode),
  };
}

function reply(result: unknown, cfRay: string) {
  return Response.json({ success: true, errors: null, messages: null, result }, {
    headers: { "cf-ray": cfRay },
  });
}

function requests() {
  return fetchMock.mock.calls.map(([input, init]) => new Request(input, init));
}

describe("rulesets rules update", () => {
  it("uses the explicit zone, checks both versions, and sends only the file body", async () => {
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray")).mockResolvedValueOnce(reply(updated, "patch-ray"));
    const result = await invoke([
      ...command, "--scope", "zone", "--zone-id", "explicit-zone", "--body", bodyPath,
      "--expect-ruleset-version", "319", "--expect-rule-version", "7", "--json", "rule-2",
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      scope: "zone",
      zoneId: "explicit-zone",
      rulesetId: "rs-1",
      ruleId: "rule-2",
      dryRun: false,
      before: {
        rulesetVersion: "319", ruleVersion: "7", position: 2, description: oldRule.description,
        last_updated: oldRule.last_updated, "cf-ray": "read-ray",
      },
      after: {
        rulesetVersion: "320", ruleVersion: "8", position: 2, description: patch.description,
        last_updated: updatedRule.last_updated,
      },
      "cf-ray": "patch-ray",
    });
    const path = zonePath.replace("default-zone", "explicit-zone");
    const calls = requests();
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ["GET", `https://mock.cloudflare.test${path}`],
      ["PATCH", `https://mock.cloudflare.test${path}/rules/rule-2`],
    ]);
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer test-token");
    expect(await calls[1]?.json()).toEqual(patch);
  });

  it("uses the default account and sends a dry-run PATCH from stdin with a null result", async () => {
    const native = { action: "execute", expression: "true", action_parameters: { id: "other-ruleset", version: "latest" } };
    mocks.readAllStdin.mockResolvedValueOnce(JSON.stringify(native));
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray")).mockResolvedValueOnce(reply(null, "dry-run-ray"));
    const result = await invoke([...command, "--scope", "account", "--stdin", "--dry-run", "--json", "rule-2"]);
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      scope: "account", accountId: "default-account", dryRun: true,
      before: { rulesetVersion: "319", ruleVersion: "7", position: 2 },
      after: null, "cf-ray": "dry-run-ray",
    });
    const calls = requests();
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ["GET", `https://mock.cloudflare.test${accountPath}`],
      ["PATCH", `https://mock.cloudflare.test${accountPath}/rules/rule-2?dry_run=true`],
    ]);
    expect(await calls[1]?.json()).toEqual(native);
  });

  it("prints before and after metadata and uses the ordered rule positions", async () => {
    const body = { ...patch, position: { before: "rule-1" } };
    mocks.readAllStdin.mockResolvedValueOnce(JSON.stringify(body));
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray"))
      .mockResolvedValueOnce(reply({ ...updated, rules: [updatedRule, neighbor] }, "patch-ray"));
    const result = await invoke([...command, "--scope", "zone", "--stdin", "rule-2"]);
    expect(result.code, result.stderr).toBe(0);
    for (const value of [
      "Before", "After", "319", "320", "Rule version: 7", "Rule version: 8",
      "Position: 2", "Position: 1", oldRule.description, patch.description,
      oldRule.last_updated, updatedRule.last_updated, "read-ray", "patch-ray",
    ]) expect(result.stdout).toContain(value);
    expect(requests()[0]?.url).toBe(`https://mock.cloudflare.test${zonePath}`);
    expect(await requests()[1]?.json()).toEqual(body);
  });

  it.each([
    ["--expect-ruleset-version", "318", /Ruleset version.*318.*319/iu],
    ["--expect-rule-version", "6", /Rule version.*6.*7/iu],
  ])("refuses a stale %s before PATCH", async (flag, version, message) => {
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray"));
    const result = await invoke([...command, "--scope", "zone", "--stdin", flag, version, "rule-2"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(message);
    expect(requests().map(({ method }) => method)).toEqual(["GET"]);
  });

  it("refuses a rule ID absent from the ruleset before PATCH", async () => {
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray"));
    const result = await invoke([...command, "--scope", "zone", "--body", bodyPath, "missing-rule"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/rule.*missing-rule.*not found.*rs-1/iu);
    expect(requests().map(({ method }) => method)).toEqual(["GET"]);
  });

  it.each([400, 200])("keeps every Cloudflare error for a refused move (HTTP %s)", async (status) => {
    const body = { ...patch, position: { after: "rule-1" } };
    const errors = [
      { code: 20011, message: "Rule is already in the requested position", source: { pointer: "/position/after" } },
      { code: 20002, message: "Position rejected" },
    ];
    mocks.readAllStdin.mockResolvedValueOnce(JSON.stringify(body));
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray")).mockResolvedValueOnce(Response.json(
      { success: false, errors, messages: [], result: null },
      { status, headers: { "cf-ray": "error-ray" } },
    ));
    const result = await invoke([...command, "--scope", "zone", "--stdin", "--json", "rule-2"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({ errors, "cf-ray": "error-ray", statusCode: status });
    expect(requests().map(({ method }) => method)).toEqual(["GET", "PATCH"]);
    expect(await requests()[1]?.json()).toEqual(body);
  });

  it("does not report success for a null result on a real update", async () => {
    fetchMock.mockResolvedValueOnce(reply(current, "read-ray")).mockResolvedValueOnce(reply(null, "patch-ray"));
    const result = await invoke([...command, "--scope", "zone", "--stdin", "rule-2"]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/response|result/iu);
    expect(requests().map(({ method }) => method)).toEqual(["GET", "PATCH"]);
  });

  it.each([
    ["[]", /JSON object/iu],
    ["null", /JSON object/iu],
    ['{"expression":4}', /expression.*string/iu],
    ['{"action":"bypass"}', /action.*bypass/iu],
    ['{"action":"allow","filter":{"expression":"true"}}', /Legacy Firewall Rules.*filter/iu],
    ['{"paused":true}', /Legacy Firewall Rules.*paused/iu],
    ['{"priority":10}', /Legacy Firewall Rules.*priority/iu],
    ['{"products":["waf"]}', /Legacy Firewall Rules.*products/iu],
    ["{", /valid JSON/iu],
  ])("rejects invalid body %s before any API request", async (body, diagnostic) => {
    mocks.readAllStdin.mockResolvedValueOnce(body);
    const result = await invoke([...command, "--scope", "zone", "--stdin", "rule-2"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(diagnostic);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { flags: ["--stdin"], diagnostic: /scope/iu },
    { flags: ["--scope", "zone"], diagnostic: /--body.*--stdin/iu },
    { flags: ["--scope", "zone", "--stdin", "--body", "ignored.json"], diagnostic: /--body.*--stdin/iu },
    { flags: ["--scope", "account", "--zone-id", "z", "--stdin"], diagnostic: /--zone-id.*--scope account/iu },
  ])("rejects invalid flags $flags before fetching", async ({ flags, diagnostic }) => {
    const result = await invoke([...command, ...flags, "rule-2"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(diagnostic);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
