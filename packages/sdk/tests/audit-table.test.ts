import { describe, expect, it } from "bun:test";
import type { AuditLog } from "../src/types.js";
import { mapAuditLogToTableRow } from "../src/audit-table.js";

describe("mapAuditLogToTableRow", () => {
  it("uses nested v2 fields for action time/type and resource details", () => {
    const row = mapAuditLogToTableRow({
      id: "log-1",
      action: {
        type: "update",
        description: "Certificate pack deployed",
        time: "2026-02-28T21:09:52Z",
      },
      resource: {
        product: "certificates",
        type: "certificate_pack",
      },
      actor: {
        context: "system",
      },
    } as AuditLog);

    expect(row["Action Time"]).toBe("2026-02-28T21:09:52Z");
    expect(row["Action Type"]).toBe("update Certificate pack deployed");
    expect(row.Resource).toBe("certificates certificate_pack");
    expect(row["Actor Email"]).toBe("-");
    expect(row["Actor Context"]).toBe("system");
    expect(row["Zone Name"]).toBe("-");
  });

  it("uses flattened fields and keeps actor context detail", () => {
    const row = mapAuditLogToTableRow({
      id: "log-2",
      ActionTimestamp: 1_740_761_553,
      ActionType: "create",
      ActionDescription: "Purge Cached Content",
      ResourceProduct: "purge_cache",
      ActorEmail: "spenser@pbhs.com",
      ActorType: "user",
      ActorContext: "api_key",
      ZoneName: "pbhshosting.com",
    } as AuditLog);

    expect(row["Action Time"]).toBe("2025-02-28T16:52:33.000Z");
    expect(row["Action Type"]).toBe("create Purge Cached Content");
    expect(row.Resource).toBe("purge_cache");
    expect(row["Actor Email"]).toBe("spenser@pbhs.com");
    expect(row["Actor Context"]).toBe("user api_key");
    expect(row["Zone Name"]).toBe("pbhshosting.com");
  });
});
