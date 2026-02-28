import type { AuditLog } from "./types.js";

export const AUDIT_LOG_TABLE_COLUMNS = [
  "Action Time",
  "Action Type",
  "Resource",
  "Actor Email",
  "Actor Context",
  "Zone Name",
] as const;

export type AuditLogTableColumn = (typeof AUDIT_LOG_TABLE_COLUMNS)[number];

export type AuditLogTableRow = {
  [K in AuditLogTableColumn]: string;
};

export interface AuditLogTable {
  readonly columns: readonly AuditLogTableColumn[];
  readonly rows: readonly AuditLogTableRow[];
}

type UnknownRecord = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRecord(value: unknown): UnknownRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as UnknownRecord;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function readTimestamp(value: unknown): string | undefined {
  const asString = readString(value);
  if (asString) {
    if (/^\d+(\.\d+)?$/u.test(asString)) {
      const numeric = Number(asString);
      if (Number.isFinite(numeric)) {
        const milliseconds = numeric > 1_000_000_000_000 ? numeric : numeric * 1_000;
        const parsed = new Date(milliseconds);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
      }
    }
    return asString;
  }

  const asNumber = readNumber(value);
  if (asNumber === undefined) return undefined;

  const milliseconds = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1_000;
  const parsed = new Date(milliseconds);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function readFirstString(record: UnknownRecord | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }

  return undefined;
}

function readFirstRecord(record: UnknownRecord | undefined, keys: readonly string[]): UnknownRecord | undefined {
  if (!record) return undefined;

  for (const key of keys) {
    const nested = readRecord(record[key]);
    if (nested) return nested;
  }

  return undefined;
}

function joinParts(...parts: Array<string | undefined>): string | undefined {
  const values = parts.filter((part): part is string => Boolean(part));
  if (values.length === 0) return undefined;
  return values.join(" ");
}

function dedupeJoin(...parts: Array<string | undefined>): string | undefined {
  const values = parts.filter((part): part is string => Boolean(part));
  if (values.length === 0) return undefined;

  const deduped = values.filter((value, index) => values.indexOf(value) === index);
  return deduped.join(" ");
}

function formatActionTime(log: AuditLog): string {
  const root = readRecord(log);
  const action = readRecord(log.action) ?? readFirstRecord(root, ["action"]);

  return (
    readTimestamp(log.when) ??
    readTimestamp(action?.time) ??
    readTimestamp(action?.timestamp) ??
    readTimestamp(root?.action_time) ??
    readTimestamp(root?.action_timestamp) ??
    readTimestamp(root?.actionTime) ??
    readTimestamp(root?.ActionTimestamp) ??
    "-"
  );
}

function formatActionType(log: AuditLog): string {
  const root = readRecord(log);
  const action = readRecord(log.action) ?? readFirstRecord(root, ["action"]);

  const actionType =
    readFirstString(action, ["type"]) ??
    readFirstString(root, ["action_type", "actionType", "ActionType"]);
  const description =
    readFirstString(action, ["description"]) ??
    readFirstString(root, [
      "action_description",
      "actionDescription",
      "ActionDescription",
    ]);

  return joinParts(actionType, description) ?? "-";
}

function formatResource(log: AuditLog): string {
  const root = readRecord(log);
  const resource = readRecord(log.resource) ?? readFirstRecord(root, ["resource"]);
  const resourceValue =
    readFirstRecord(resource, ["value"]) ??
    readFirstRecord(root, ["resource_value", "resourceValue", "ResourceValue"]);

  const product =
    readFirstString(resource, ["product"]) ??
    readFirstString(root, ["resource_product", "resourceProduct", "ResourceProduct"]);
  const type =
    readFirstString(resource, ["type"]) ??
    readFirstString(root, ["resource_type", "resourceType", "ResourceType"]);
  const name = readFirstString(resource, ["name"]) ?? readFirstString(resourceValue, ["name"]);
  const description =
    readFirstString(resource, ["description"]) ??
    readFirstString(resourceValue, ["description"]);
  const id =
    readFirstString(resource, ["id"]) ??
    readFirstString(root, ["resource_id", "resourceId", "ResourceID"]);
  const scope =
    readFirstString(resource, ["scope"]) ??
    readFirstString(root, ["resource_scope", "resourceScope", "ResourceScope"]);

  const base =
    joinParts(product, type) ??
    joinParts(name, type) ??
    joinParts(product, name) ??
    (type && id ? `${type}:${id}` : undefined) ??
    type ??
    product ??
    name ??
    scope ??
    id;

  return dedupeJoin(base, description) ?? "-";
}

function formatActorEmail(log: AuditLog): string {
  const root = readRecord(log);
  const actor = readRecord(log.actor) ?? readFirstRecord(root, ["actor"]);
  const actorUser =
    readFirstRecord(actor, ["user"]) ??
    readFirstRecord(root, ["actor_user", "actorUser", "ActorUser"]);

  return (
    readFirstString(actor, ["email"]) ??
    readFirstString(actorUser, ["email"]) ??
    readFirstString(root, ["actor_email", "actorEmail", "ActorEmail"]) ??
    "-"
  );
}

function formatActorContext(log: AuditLog): string {
  const root = readRecord(log);
  const actor = readRecord(log.actor) ?? readFirstRecord(root, ["actor"]);

  const actorType =
    readFirstString(actor, ["type"]) ??
    readFirstString(root, ["actor_type", "actorType", "ActorType"]);
  const context =
    readFirstString(actor, ["context"]) ??
    readFirstString(root, ["actor_context", "actorContext", "ActorContext"]);
  const tokenDetails =
    readFirstRecord(actor, ["token", "token_details", "tokenDetails"]) ??
    readFirstRecord(root, [
      "actor_token_details",
      "actorTokenDetails",
      "ActorTokenDetails",
    ]);
  const authMethod =
    readFirstString(tokenDetails, ["type", "name"]) ??
    readFirstString(actor, ["token_type", "tokenType"]) ??
    readFirstString(root, ["actor_token_type", "actorTokenType", "ActorTokenType"]);
  const fallback =
    readFirstString(actor, ["id", "ip", "ip_address"]) ??
    readFirstString(root, ["actor_id", "actorId", "ActorID", "actor_ip", "actorIPAddress"]);

  return (
    dedupeJoin(actorType, context, authMethod) ??
    dedupeJoin(context, authMethod) ??
    context ??
    actorType ??
    authMethod ??
    fallback ??
    "-"
  );
}

function formatZoneName(log: AuditLog): string {
  const root = readRecord(log);
  const zone = readRecord(log.zone) ?? readFirstRecord(root, ["zone"]);

  return (
    readFirstString(zone, ["name"]) ??
    readFirstString(root, ["zone_name", "zoneName", "ZoneName"]) ??
    "-"
  );
}

export function mapAuditLogToTableRow(log: AuditLog): AuditLogTableRow {
  return {
    "Action Time": formatActionTime(log),
    "Action Type": formatActionType(log),
    Resource: formatResource(log),
    "Actor Email": formatActorEmail(log),
    "Actor Context": formatActorContext(log),
    "Zone Name": formatZoneName(log),
  };
}

export function toAuditLogTable(logs: readonly AuditLog[]): AuditLogTable {
  return {
    columns: AUDIT_LOG_TABLE_COLUMNS,
    rows: logs.map(mapAuditLogToTableRow),
  };
}
