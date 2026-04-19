import { buildCommand } from "@stricli/core";
import { CloudflareClient, resolveConfig } from "@cloudflare-ai-toolkit/sdk";

interface DnsListFlags {
  readonly type?: string;
  readonly name?: string;
  readonly content?: string;
  readonly proxied?: boolean;
  readonly search?: string;
  readonly order?: "type" | "name" | "content" | "ttl" | "proxied";
  readonly direction: "asc" | "desc";
  readonly match: "all" | "any";
  readonly page: number;
  readonly perPage: number;
  readonly json: boolean;
}

function parseDirection(value: string): "asc" | "desc" {
  if (value !== "asc" && value !== "desc") {
    throw new Error(`Direction must be 'asc' or 'desc', got '${value}'`);
  }
  return value;
}

function parseMatch(value: string): "all" | "any" {
  if (value !== "all" && value !== "any") {
    throw new Error(`Match must be 'all' or 'any', got '${value}'`);
  }
  return value;
}

function parseOrder(value: string): "type" | "name" | "content" | "ttl" | "proxied" {
  if (value === "type" || value === "name" || value === "content" || value === "ttl" || value === "proxied") {
    return value;
  }
  throw new Error(`Order must be one of type|name|content|ttl|proxied, got '${value}'`);
}

function parseOptionalBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean value 'true' or 'false', got '${value}'`);
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got '${value}'`);
  }
  return parsed;
}

export const listDnsRecordsCommand = buildCommand({
  docs: {
    brief: "List DNS records in a zone",
  },
  parameters: {
    flags: {
      type: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by record type",
      },
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by record name",
      },
      content: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Filter by record content",
      },
      proxied: {
        kind: "parsed",
        parse: parseOptionalBoolean,
        optional: true,
        brief: "Filter by proxy status (true|false)",
      },
      search: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Full-text search",
      },
      order: {
        kind: "parsed",
        parse: parseOrder,
        optional: true,
        brief: "Order by field (type|name|content|ttl|proxied)",
      },
      direction: {
        kind: "parsed",
        parse: parseDirection,
        brief: "Sort direction (asc|desc)",
        default: "asc",
      },
      match: {
        kind: "parsed",
        parse: parseMatch,
        brief: "Filter matching mode (all|any)",
        default: "all",
      },
      page: {
        kind: "parsed",
        parse: parsePositiveInt,
        brief: "Page number",
        default: "1",
      },
      perPage: {
        kind: "parsed",
        parse: parsePositiveInt,
        brief: "Items per page",
        default: "100",
      },
      json: {
        kind: "boolean",
        brief: "Output as JSON",
        default: false,
      },
    },
    positional: {
      kind: "tuple",
      parameters: [
        {
          brief: "Zone ID",
          parse: String,
        },
      ],
    },
  },
  async func(this: void, flags: DnsListFlags, zoneId: string) {
    const config = resolveConfig();
    const client = new CloudflareClient(config);

    try {
      const result = await client.listDnsRecords(zoneId, {
        type: flags.type,
        name: flags.name,
        content: flags.content,
        proxied: flags.proxied,
        search: flags.search,
        order: flags.order,
        direction: flags.direction,
        match: flags.match,
        page: flags.page,
        perPage: flags.perPage,
      });

      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const info = result.resultInfo;
      if (info?.page && info.total_pages) {
        console.log(`Showing ${result.records.length} records (page ${info.page} of ${info.total_pages})\n`);
      } else {
        console.log(`Showing ${result.records.length} records\n`);
      }

      for (const record of result.records) {
        const proxied = record.proxied === undefined ? "-" : String(record.proxied);
        const ttl = record.ttl ?? "-";
        console.log(`${record.id}  ${record.type}  ${record.name}  ${record.content}  proxied=${proxied} ttl=${ttl}`);
      }
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  },
});
