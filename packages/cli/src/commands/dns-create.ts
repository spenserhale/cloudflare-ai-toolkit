import { buildCommand } from "@stricli/core";
import {
  CloudflareClient,
  CloudflareError,
  loadConfig,
  type CreateDnsRecordParams,
} from "@cloudflare-ai-toolkit/sdk";

interface DnsCreateFlags {
  readonly type: string;
  readonly name: string;
  readonly content: string;
  readonly ttl?: number;
  readonly proxied?: boolean;
  readonly comment?: string;
  readonly json: boolean;
}

function parseOptionalBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean value 'true' or 'false', got '${value}'`);
}

function parseNonNegativeInt(value: string): number {
  const parsed = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got '${value}'`);
  }
  return parsed;
}

export const createDnsRecordCommand = buildCommand({
  docs: {
    brief: "Create a DNS record in a zone",
  },
  parameters: {
    flags: {
      type: {
        kind: "parsed",
        parse: String,
        brief: "Record type",
      },
      name: {
        kind: "parsed",
        parse: String,
        brief: "Record name",
      },
      content: {
        kind: "parsed",
        parse: String,
        brief: "Record content",
      },
      ttl: {
        kind: "parsed",
        parse: parseNonNegativeInt,
        optional: true,
        brief: "TTL value",
      },
      proxied: {
        kind: "parsed",
        parse: parseOptionalBoolean,
        optional: true,
        brief: "Proxy status (true|false)",
      },
      comment: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Record comment",
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
  async func(this: void, flags: DnsCreateFlags, zoneId: string) {
    const config = await loadConfig();
    const client = new CloudflareClient(config);

    const record: CreateDnsRecordParams = {
      type: flags.type,
      name: flags.name,
      content: flags.content,
      ttl: flags.ttl,
      proxied: flags.proxied,
      comment: flags.comment,
    };

    try {
      const created = await client.createDnsRecord(zoneId, record);

      if (flags.json) {
        console.log(JSON.stringify(created, null, 2));
        return;
      }

      console.log(`Created DNS record ${created.id}`);
      console.log(`Type:    ${created.type}`);
      console.log(`Name:    ${created.name}`);
      console.log(`Content: ${created.content}`);
      console.log(`TTL:     ${created.ttl ?? "-"}`);
      console.log(`Proxied: ${created.proxied === undefined ? "-" : String(created.proxied)}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      if (err instanceof CloudflareError) {
        console.error(`Cloudflare error code: ${err.code}`);
        if (err.requiredPermissions?.length) {
          console.error(`Required permission: ${err.requiredPermissions.join(" or ")}`);
        }
        if (err.docsUrl) console.error(`Docs: ${err.docsUrl}`);
      }
      process.exit(1);
    }
  },
});
