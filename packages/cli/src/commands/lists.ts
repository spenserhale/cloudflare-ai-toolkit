import { buildCommand, buildRouteMap } from "@stricli/core";
import { CloudflareClient, describeError, loadConfig } from "@cloudflare-ai-toolkit/sdk";

interface AccountFlags {
  readonly scope: "account";
  readonly accountId?: string;
  readonly json: boolean;
}

interface ListFlags extends AccountFlags {
  readonly name?: string;
  readonly kind?: "ip" | "redirect" | "hostname" | "asn";
  readonly page?: number;
  readonly perPage?: number;
  readonly all: boolean;
}

interface ItemFlags extends AccountFlags {
  readonly search?: string;
  readonly cursor?: string;
  readonly perPage?: number;
  readonly all: boolean;
}

function accountScope(value: string): "account" {
  if (value !== "account") throw new Error("Scope must be account; Lists are account-scoped.");
  return value;
}

function listKind(value: string): NonNullable<ListFlags["kind"]> {
  if (value === "ip" || value === "redirect" || value === "hostname" || value === "asn") return value;
  throw new Error("List kind must be one of: ip, redirect, hostname, asn.");
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("--page must be a positive safe integer.");
  }
  return parsed;
}

function pageSize(value: string): number {
  const parsed = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("--per-page must be an integer in 1-500.");
  }
  return parsed;
}

function nonempty(value: string): string {
  if (!value.trim()) throw new Error("Value must not be empty.");
  return value;
}

const accountFlags = {
  scope: { kind: "parsed", parse: accountScope, brief: "Required scope: account" },
  accountId: { kind: "parsed", parse: nonempty, optional: true, brief: "Account ID (defaults to CLOUDFLARE_ACCOUNT_ID)" },
  json: { kind: "boolean", default: false, brief: "Output as JSON" },
} as const;

const perPageFlag = { kind: "parsed", parse: pageSize, optional: true, brief: "Results per page (1-500; default 100)" } as const;
const listId = { kind: "tuple", parameters: [{ brief: "Account list ID", parse: nonempty, placeholder: "list-id" }] } as const;

function target(flags: AccountFlags) {
  return { scope: flags.scope, accountId: flags.accountId };
}

async function read<T>(
  flags: AccountFlags,
  label: string,
  operation: (inventory: CloudflareClient["inventory"]) => Promise<T>,
  validate?: () => void,
): Promise<void> {
  try {
    validate?.();
    const config = await loadConfig();
    const result = await operation(new CloudflareClient(config).inventory);
    if (!flags.json) console.log(label);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Error: ${describeError(error)}`);
    process.exit(1);
  }
}

const listListsCommand = buildCommand({
  docs: { brief: "Read-only account list metadata; filters and numeric paging are local" },
  parameters: {
    flags: {
      ...accountFlags,
      name: { kind: "parsed", parse: nonempty, optional: true, brief: "Exact list name filter (local)" },
      kind: { kind: "parsed", parse: listKind, optional: true, brief: "List kind: ip|redirect|hostname|asn (local filter)" },
      page: { kind: "parsed", parse: positiveInteger, optional: true, brief: "Local metadata page (default 1)" },
      perPage: perPageFlag,
      all: { kind: "boolean", default: false, brief: "Return every matching list; conflicts with --page greater than 1" },
    },
  },
  async func(this: void, flags: ListFlags) {
    await read(flags, "Account Lists inventory", async (inventory) => {
      const result = await inventory.listLists(target(flags), {
        name: flags.name, kind: flags.kind, page: flags.page, perPage: flags.perPage, all: flags.all,
      });
      if (result.truncated) console.error("More lists are available. Continue with --page or use --all; see resultInfo for local pagination.");
      return result;
    }, () => {
      if (flags.all && (flags.page ?? 1) > 1) throw new Error("--all conflicts with --page greater than 1.");
    });
  },
});

const getListCommand = buildCommand({
  docs: { brief: "Read-only account list detail, including its name, kind and item count" },
  parameters: { flags: accountFlags, positional: listId },
  async func(this: void, flags: AccountFlags, id: string) {
    await read(flags, "Account List detail", (inventory) => inventory.getList(id, target(flags)));
  },
});

const listListItemsCommand = buildCommand({
  docs: { brief: "Read-only list contents with list identity, comments and native item parameters" },
  parameters: {
    flags: {
      ...accountFlags,
      search: { kind: "parsed", parse: nonempty, optional: true, brief: "API filter: IP prefix; redirect/hostname substring; ASN exact match" },
      cursor: { kind: "parsed", parse: nonempty, optional: true, brief: "Opaque continuation from resultInfo.cursors.after" },
      perPage: perPageFlag,
      all: { kind: "boolean", default: false, brief: "Follow cursors through all remaining items; with --cursor collects only that suffix" },
    },
    positional: listId,
  },
  async func(this: void, flags: ItemFlags, id: string) {
    await read(flags, "Account List contents", async (inventory) => {
      const result = await inventory.listListItems(id, target(flags), {
        search: flags.search, cursor: flags.cursor, perPage: flags.perPage, all: flags.all,
      });
      if (result.truncated) console.error("More list items are available. Continue with --cursor from resultInfo.cursors.after or use --all.");
      return result;
    });
  },
});

export const listsRoutes = buildRouteMap({
  routes: {
    list: listListsCommand,
    get: getListCommand,
    items: buildRouteMap({
      routes: { list: listListItemsCommand },
      docs: { brief: "Read account list items; no list or item mutations" },
    }),
  },
  docs: { brief: "Read-only account Lists inventory for Bulk Redirect and custom lists" },
});
