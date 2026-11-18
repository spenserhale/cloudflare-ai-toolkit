import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const guide = readFileSync(join(ROOT, "docs/guides/migration-inventory.md"), "utf8");
const capture = guide.match(/capture\(\) \{[\s\S]*?\n\}/u)![0];
const recipe = [...guide.matchAll(/```bash\n([\s\S]*?)```/gu)].map((match) => match[1]!).find((block) => block.includes("if capture account-lists"))!;
const phases = guide.match(/PHASES='([^']+)'/u)![1]!.trim().split(/\s+/u);
const accountId = "synthetic-account";
const listId = "1".repeat(32);
const listName = "2026_office_ips";
const definitionId = "a".repeat(32);
const nestedId = "b".repeat(32);
const customPhase = "account-phase-http_request_firewall_custom";
const redirectPhase = "account-phase-http_request_redirect";
const catalog = { scope: "account", accountId, lists: [{ id: listId, name: listName, kind: "ip", num_items: 0 }], truncated: false };

function json(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value)); }
function readJson(path: string) { return JSON.parse(readFileSync(path, "utf8")); }

function source(work: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "cf-inventory-guide-"));
  const manifest = ["exit\tread"];
  for (const owner of ["account", "pbhspreprod.com", "pbhsstaging.com", "pbhsnetwork.com"]) {
    for (const phase of phases) {
      const name = `${owner}-phase-${phase}`;
      const scope = owner === "account" ? { scope: "account", accountId } : { scope: "zone", zoneId: `synthetic-${owner}` };
      json(join(directory, `${name}.json`), { ...scope, phase, status: "absent", diagnostic: { statusCode: 404 } });
      manifest.push(`0\t${name}`);
    }
  }
  json(join(directory, `${customPhase}.json`), { scope: "account", accountId, phase: "http_request_firewall_custom", status: "present", ruleset: { id: "c".repeat(32), rules: [{ id: "rule", action: "block", expression: `ip.src in $${listName}` }] } });
  writeFileSync(join(directory, "manifest.tsv"), manifest.join("\n") + "\n");
  try { work(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function execute(directory: string, mode = "success") {
  const before = new Set(readdirSync(directory));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("CLOUDFLARE_")));
  const result = spawnSync("bash", ["-c", capture + String.raw`
cloudflare() {
  case " $* " in *" --scope account "*) ;; *) return 98 ;; esac
  case "$1 $2" in
    "lists list")
      if [ "$MOCK_MODE" = catalog-failure ]; then printf 'catalog failed\n' >&2; return 1; fi
      printf '%s\n' "$MOCK_CATALOG" ;;
    "lists items")
      if [ "$MOCK_MODE" = item-failure ]; then printf 'items failed\n' >&2; return 1; fi
      printf '%s\n' "$MOCK_ITEMS" ;;
    *) return 99 ;;
  esac
}
failed=0
` + recipe], {
    cwd: directory,
    encoding: "utf8",
    timeout: 20_000,
    env: { ...env, CLOUDFLARE_KEYCHAIN: "0", OUT: directory, ACCOUNT_ID: accountId, MOCK_MODE: mode, MOCK_CATALOG: JSON.stringify(mode === "empty" ? { ...catalog, lists: [] } : mode === "bad-id" ? { ...catalog, lists: [{ ...catalog.lists[0], id: "../../invalid" }] } : catalog), MOCK_ITEMS: JSON.stringify({ scope: "account", accountId, list: catalog.lists[0], items: [], resultInfo: {}, truncated: false }) },
  });
  if (result.error) throw result.error;
  expect(result.status).toBeTypeOf("number");
  const attempts = readdirSync(directory).filter((name) => name.startsWith("list-contents-") && !before.has(name));
  expect(attempts, result.stderr).toHaveLength(1);
  return { ...result, output: join(directory, attempts[0]!) };
}

function addDefinition(directory: string) {
  const phasePath = join(directory, `${customPhase}.json`);
  const phase = readJson(phasePath);
  phase.ruleset.rules.push({ id: "execute", action: "execute", action_parameters: { id: definitionId } });
  json(phasePath, phase);
  json(join(directory, `account-definition-${definitionId}-latest.json`), { scope: "account", accountId, ruleset: { id: definitionId, rules: [{ id: "nested-execute", action: "execute", action_parameters: { id: nestedId, version: "7" } }] } });
  writeFileSync(join(directory, "manifest.tsv"), readFileSync(join(directory, "manifest.tsv"), "utf8") + `0\taccount-definition-${definitionId}-latest\n`);
}

describe("copy-paste list inventory guide", { timeout: 25_000 }, () => {
  it("accepts recorded absent phases and indexes digit-leading names", () => source((directory) => {
    const result = execute(directory);
    expect(result.status, result.stderr).toBe(0);
    expect(readJson(join(result.output, "account-list-references.json"))).toMatchObject({ source_inventory_complete: true, references: [{ name: listName, matches: [{ id: listId, snapshot: `account-list-${listId}.json` }] }] });
  }));

  it("keeps failed refreshes separate from previous successful snapshots", () => source((directory) => {
    const first = execute(directory);
    const next = execute(directory, "item-failure");
    expect(next.status).toBe(1);
    expect(readJson(join(first.output, `account-list-${listId}.json`)).items).toEqual([]);
    expect(readdirSync(next.output)).not.toContain(`account-list-${listId}.json`);
    expect(readJson(join(next.output, "account-list-references.json")).references[0].matches[0].snapshot).toBeNull();
  }));

  it("never reuses a catalog or reference index after a failed catalog refresh", () => source((directory) => {
    execute(directory);
    const result = execute(directory, "catalog-failure");
    expect(result.status).toBe(1);
    expect(readdirSync(result.output)).not.toContain("account-lists.json");
    expect(readdirSync(result.output)).not.toContain("account-list-references.json");
  }));

  it.each(["failed", "missing-manifest", "missing-file"])("rejects a %s required phase despite other successful phases", (mode) => source((directory) => {
    const manifest = join(directory, "manifest.tsv");
    if (mode === "failed") writeFileSync(manifest, readFileSync(manifest, "utf8") + `1\t${redirectPhase}\n`);
    if (mode === "missing-manifest") writeFileSync(manifest, readFileSync(manifest, "utf8").split("\n").filter((line) => line !== `0\t${redirectPhase}`).join("\n"));
    if (mode === "missing-file") rmSync(join(directory, `${redirectPhase}.json`));
    const result = execute(directory);
    expect(result.status).toBe(1);
    expect(readJson(join(result.output, "account-list-references.json")).source_inventory_complete).toBe(false);
  }));

  it("restores prior failed state in a fresh shell", () => source((directory) => {
    const manifest = join(directory, "manifest.tsv");
    writeFileSync(manifest, readFileSync(manifest, "utf8") + "1\tsynthetic-other-read\n");
    const result = execute(directory);
    expect(result.status).toBe(1);
    expect(readJson(join(result.output, "account-list-references.json")).source_inventory_complete).toBe(false);
  }));

  it("rejects source snapshots for a different account", () => source((directory) => {
    const path = join(directory, `${customPhase}.json`);
    json(path, { ...readJson(path), accountId: "different-account" });
    expect(execute(directory).status).toBe(1);
  }));

  it("rejects a missing nested execute-definition read", () => source((directory) => {
    addDefinition(directory);
    const result = execute(directory);
    expect(result.status).toBe(1);
    expect(readJson(join(result.output, "account-list-references.json")).source_inventory_complete).toBe(false);
  }));

  it("follows and validates nested execute-definition reads", () => source((directory) => {
    addDefinition(directory);
    json(join(directory, `account-definition-${nestedId}-7.json`), { scope: "account", accountId, ruleset: { id: nestedId, rules: [] } });
    const manifest = join(directory, "manifest.tsv");
    writeFileSync(manifest, readFileSync(manifest, "utf8") + `0\taccount-definition-${nestedId}-7\n`);
    expect(execute(directory).status).toBe(0);
  }));

  it.each(["[REDACTED]", "ip.src in $cf.open_proxies"])("keeps unresolved reference evidence as failure: %s", (expression) => source((directory) => {
    const path = join(directory, `${customPhase}.json`);
    const phase = readJson(path);
    phase.ruleset.rules[0].expression = expression;
    json(path, phase);
    expect(execute(directory).status).toBe(1);
  }));

  it("accepts an explicitly empty account when no rule references a list", () => source((directory) => {
    const path = join(directory, `${customPhase}.json`);
    const phase = readJson(path);
    phase.ruleset.rules = [];
    json(path, phase);
    const result = execute(directory, "empty");
    expect(result.status, result.stderr).toBe(0);
    expect(readJson(join(result.output, "account-list-references.json")).references).toEqual([]);
  }));

  it("rejects unsafe item artifact names from metadata", () => source((directory) => {
    expect(execute(directory, "bad-id").status).toBe(1);
  }));
});
