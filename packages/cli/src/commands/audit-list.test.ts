import { describe, expect, it, vi } from "vitest";
import { CloudflareAuthError, CloudflareError } from "@cloudflare-ai-toolkit/sdk";
import { resolveDateRange, runAuditLogsList, type AuditListFlags } from "./audit-list.js";

function baseFlags(overrides: Partial<AuditListFlags> = {}): AuditListFlags {
  return {
    limit: 100,
    direction: "desc",
    json: false,
    ...overrides,
  };
}

describe("resolveDateRange", () => {
  it("defaults to a 30 day window ending at now", () => {
    const startedAt = Date.now();
    const { since, before } = resolveDateRange(baseFlags());
    const finishedAt = Date.now();

    const beforeMs = Date.parse(before);
    const sinceMs = Date.parse(since);

    expect(beforeMs).toBeGreaterThanOrEqual(startedAt);
    expect(beforeMs).toBeLessThanOrEqual(finishedAt);
    expect(beforeMs - sinceMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("rejects when --since is after --before", () => {
    expect(() =>
      resolveDateRange(
        baseFlags({
          since: "2026-02-20T00:00:00.000Z",
          before: "2026-02-10T00:00:00.000Z",
        })
      )
    ).toThrow("Invalid date range");
  });
});

describe("runAuditLogsList", () => {
  it("renders audit logs in a TOON table with the required columns", async () => {
    const listAuditLogs = vi.fn(async () => ({
      data: [
        {
          id: "log-1",
          action: {
            type: "update",
            description: "Certificate pack deployed",
            time: "2026-02-28T01:09:52Z",
            result: "success",
          },
          resource: { product: "certificates", type: "certificate_pack" },
          actor: { context: "system" },
        },
      ],
      pagination: { cursor: "next-cursor" },
    }));
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({ listAuditLogs, verifyToken, getAuthType })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(() => {
        throw new Error("EXIT");
      }),
    };

    await runAuditLogsList(baseFlags(), deps);

    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "columns[6]: Action Time,Action Type,Resource,Actor Email,Actor Context,Zone Name"
      )
    );
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("rows[1]"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("2026-02-28T01:09:52Z"));
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("update Certificate pack deployed")
    );
    expect(deps.log).toHaveBeenCalledWith(
      expect.stringContaining("certificates certificate_pack")
    );
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("nextCursor: next-cursor"));
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.error).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("forwards resourceType and filters output data without jq", async () => {
    const listAuditLogs = vi.fn(async () => ({
      data: [
        {
          id: "dns-delete-1",
          action: { type: "delete", time: "2026-02-28T12:42:33Z" },
          resource: { type: "dns_records" },
          actor: { email: "spenser@pbhs.com" },
          zone: { name: "pbhshosting.com" },
        },
        {
          id: "cert-update-1",
          action: { type: "update", time: "2026-02-28T01:09:52Z" },
          resource: { type: "certificate_pack" },
          actor: { context: "system" },
        },
      ],
      pagination: { cursor: "next-cursor" },
    }));
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({ listAuditLogs, verifyToken, getAuthType })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(() => {
        throw new Error("EXIT");
      }),
    };

    await runAuditLogsList(
      baseFlags({
        json: true,
        resourceType: "dns-records",
      }),
      deps
    );

    expect(listAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: "dns-records",
      }),
      undefined
    );

    const firstLogCall = deps.log.mock.calls[0]?.[0];
    const payload = typeof firstLogCall === "string" ? JSON.parse(firstLogCall) : firstLogCall;
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe("dns-delete-1");
    expect(payload.data[0].resource.type).toBe("dns_records");
  });

  it("uses default 30-day date range when since/before are omitted", async () => {
    const listAuditLogs = vi.fn(async () => ({ data: [], pagination: {} }));
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({ listAuditLogs, verifyToken, getAuthType })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(() => {
        throw new Error("EXIT");
      }),
    };

    await runAuditLogsList(baseFlags(), deps);

    const calls = (listAuditLogs as unknown as {
      mock: { calls: Array<[{ since: string; before: string }, string | undefined]> };
    }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0];
    if (!firstCall) {
      throw new Error("Expected listAuditLogs to be called at least once");
    }
    const firstCallParams = firstCall[0];
    const beforeMs = Date.parse(firstCallParams.before);
    const sinceMs = Date.parse(firstCallParams.since);
    expect(beforeMs - sinceMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(deps.error).not.toHaveBeenCalled();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("handles ZodError from client construction with a clear config message", async () => {
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => {
        throw { name: "ZodError", message: "apiKey required" };
      }),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid Cloudflare configuration. Set CLOUDFLARE_API_TOKEN, or set both CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL (or CLOUDFLARE_API_EMAIL)."
      )
    );
  });

  it("diagnoses auth failures by checking token verification status", async () => {
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({
        listAuditLogs: vi.fn(async () => {
          throw new CloudflareAuthError("Authentication error");
        }),
        verifyToken,
        getAuthType,
      })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Token verification succeeded via /client/v4/user/tokens/verify, so the token is valid."
      )
    );
  });

  it("diagnoses CloudflareError authentication failures (e.g. 403) with token verification", async () => {
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({
        listAuditLogs: vi.fn(async () => {
          throw new CloudflareError("Authentication error", "AUTH_ERROR", 403, {
            requiredPermissions: ["Account Settings Read", "Account Settings Write"],
            docsUrl:
              "https://developers.cloudflare.com/api/resources/accounts/subresources/logs/subresources/audit/methods/list/",
          });
        }),
        verifyToken,
        getAuthType,
      })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Token verification succeeded via /client/v4/user/tokens/verify, so the token is valid."
      )
    );
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("Required permission for this endpoint: 'Account Settings Read'")
    );
  });

  it("reports invalid token when verify endpoint also returns auth failure", async () => {
    const verifyToken = vi.fn(async () => {
      throw new CloudflareAuthError("Authentication error");
    });
    const getAuthType = vi.fn(() => "apiToken" as const);
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({
        listAuditLogs: vi.fn(async () => {
          throw new CloudflareAuthError("Authentication error");
        }),
        verifyToken,
        getAuthType,
      })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(verifyToken).toHaveBeenCalledTimes(1);
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Token verification via /client/v4/user/tokens/verify also failed with authentication."
      )
    );
  });

  it("skips token verification for legacy global API key auth failures", async () => {
    const verifyToken = vi.fn(async () => ({ status: "active" }));
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "globalApiKey" as const, apiKey: "legacy-key", email: "dev@example.com" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({
        listAuditLogs: vi.fn(async () => {
          throw new CloudflareError("Authentication error", "AUTH_ERROR", 403);
        }),
        verifyToken,
        getAuthType: vi.fn(() => "globalApiKey" as const),
      })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(verifyToken).not.toHaveBeenCalled();
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("Token verification was skipped because this request used legacy Global API Key auth")
    );
  });

  it("shows response-validation errors as response shape issues, not config issues", async () => {
    const deps = {
      resolveConfig: vi.fn(() => ({
        auth: { type: "apiToken" as const, token: "token" },
        baseUrl: "https://api.cloudflare.com",
      })),
      createClient: vi.fn(() => ({
        listAuditLogs: vi.fn(async () => {
          throw {
            name: "ZodError",
            issues: [{ path: ["data", 0, "id"], message: "Required" }],
          };
        }),
        verifyToken: vi.fn(async () => ({ status: "active" })),
        getAuthType: vi.fn(() => "apiToken" as const),
      })),
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`EXIT:${code}`);
      }),
    };

    await expect(runAuditLogsList(baseFlags(), deps)).rejects.toThrow("EXIT:1");
    expect(deps.error).toHaveBeenCalledWith(
      "Error: Unexpected Cloudflare API response shape (data.0.id): Required"
    );
  });
});
