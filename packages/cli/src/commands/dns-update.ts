import { buildCommand } from "@stricli/core";
import {
  CloudflareClient,
  resolveConfig,
  type UpdateDnsRecordParams,
} from "@cloudflare-toolkit/sdk";

interface DnsUpdateFlags {
  readonly type?: string;
  readonly name?: string;
  readonly content?: string;
  readonly ttl?: number;
  readonly proxied?: boolean;
  readonly comment?: string;
  readonly tags?: string;
  readonly json: boolean;
}

function parseOptionalBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected boolean value 'true' or 'false', got '${value}'`);
}

function parseNonNegativeInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got '${value}'`);
  }
  return parsed;
}

export const updateDnsRecordCommand = buildCommand({
  docs: {
    brief: "Update a DNS record in a zone",
  },
  parameters: {
    flags: {
      type: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New record type",
      },
      name: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New record name",
      },
      content: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "New record content",
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
      tags: {
        kind: "parsed",
        parse: String,
        optional: true,
        brief: "Comma-separated tags",
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
        {
          brief: "DNS record ID",
          parse: String,
        },
      ],
    },
  },
  async func(this: void, flags: DnsUpdateFlags, zoneId: string, recordId: string) {
    const config = resolveConfig();
    const client = new CloudflareClient(config);

    const update: UpdateDnsRecordParams = {
      type: flags.type,
      name: flags.name,
      content: flags.content,
      ttl: flags.ttl,
      proxied: flags.proxied,
      comment: flags.comment,
      tags: flags.tags
        ?.split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    };

    const hasAnyUpdate = Object.values(update).some((value) => value !== undefined);
    if (!hasAnyUpdate) {
      console.error("Error: specify at least one field to update.");
      process.exit(1);
    }

    try {
      const updated = await client.updateDnsRecord(zoneId, recordId, update);

      if (flags.json) {
        console.log(JSON.stringify(updated, null, 2));
        return;
      }

      console.log(`Updated DNS record ${updated.id}`);
      console.log(`Type:    ${updated.type}`);
      console.log(`Name:    ${updated.name}`);
      console.log(`Content: ${updated.content}`);
      console.log(`TTL:     ${updated.ttl ?? "-"}`);
      console.log(`Proxied: ${updated.proxied === undefined ? "-" : String(updated.proxied)}`);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  },
});
