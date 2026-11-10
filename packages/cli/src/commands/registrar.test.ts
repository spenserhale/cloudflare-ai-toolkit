import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";
import {
  formatAvailabilityLine,
  parseContactFile,
  runRegistrarCheck,
  runRegistrarList,
  runRegistrarRegister,
  runRegistrarStatus,
  type RegistrarRegisterFlags,
} from "./registrar.js";

const AVAILABLE = {
  name: "acmecorp.com",
  registrable: true,
  tier: "standard",
  pricing: { currency: "USD", registration_cost: "10.46", renewal_cost: "10.46" },
};

const REGISTRATION = {
  domain_name: "acmecorp.com",
  status: "active",
  created_at: "2026-11-09T20:31:50Z",
  expires_at: "2027-11-09T20:31:50Z",
  auto_renew: false,
  privacy_mode: "redaction",
  locked: true,
};

function workflow(state: string) {
  return {
    domain_name: "acmecorp.com",
    state,
    completed: state === "succeeded" || state === "failed",
    created_at: "2026-11-09T20:31:50Z",
    updated_at: "2026-11-09T20:31:51Z",
    context: { domain_name: "acmecorp.com" },
    error: state === "failed" ? { code: "registry_error", message: "Registry rejected" } : null,
    links: { self: "/x" },
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const client = {
    searchDomains: vi.fn(async () => ({ domains: [AVAILABLE] })),
    checkDomains: vi.fn(async () => ({ domains: [AVAILABLE] })),
    registerDomain: vi.fn(async () => workflow("succeeded")),
    getRegistrationStatus: vi.fn(async () => workflow("succeeded")),
    getRegistration: vi.fn(async () => REGISTRATION),
    listRegistrations: vi.fn(async (): Promise<{ registrations: (typeof REGISTRATION)[]; nextCursor?: string }> => ({ registrations: [REGISTRATION] })),
  };
  return {
    resolveConfig: vi.fn(() => ({
      auth: { type: "apiToken" as const, token: "t" },
      baseUrl: "https://api.cloudflare.com",
      accountId: "acc-1",
    })),
    createClient: vi.fn(() => client),
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(() => undefined as never),
    isTTY: vi.fn(() => true),
    confirm: vi.fn(async () => true),
    sleep: vi.fn(async () => {}),
    client,
    ...overrides,
  };
}

function text(fn: { mock: { calls: unknown[][] } }): string {
  return fn.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
}

const REGISTER_FLAGS: RegistrarRegisterFlags = {
  sandbox: false,
  json: false,
  autoRenew: false,
  yes: false,
  noWait: false,
};

describe("formatAvailabilityLine", () => {
  it("shows promo pricing and the reason a domain is blocked", () => {
    expect(
      formatAvailabilityLine({
        ...AVAILABLE,
        pricing: { currency: "USD", registration_cost: "8.50", renewal_cost: "11.20" },
      })
    ).toBe("acmecorp.com  available  8.50 USD (renews 11.20)");
    expect(
      formatAvailabilityLine({ name: "foo.sh", registrable: false, reason: "extension_not_supported_via_api" })
    ).toBe("foo.sh  unavailable  extension_not_supported_via_api");
  });
});

describe("registrar check", () => {
  it("lowercases domains and refuses more than 20", async () => {
    const deps = makeDeps();
    await runRegistrarCheck(["AcmeCorp.com"], { sandbox: false, json: false }, deps);
    expect(deps.client.checkDomains).toHaveBeenCalledWith(
      expect.objectContaining({ domains: ["acmecorp.com"] })
    );

    const many = makeDeps();
    await runRegistrarCheck(Array.from({ length: 21 }, (_, i) => `d${i}.com`), { sandbox: false, json: false }, many);
    expect(many.exit).toHaveBeenCalledWith(1);
    expect(many.client.checkDomains).not.toHaveBeenCalled();
  });
});

describe("registrar register", () => {
  it("confirms the price, registers, and shows the fetched registration", async () => {
    const deps = makeDeps();
    await runRegistrarRegister("acmecorp.com", REGISTER_FLAGS, deps);

    expect(deps.confirm).toHaveBeenCalledWith(expect.stringContaining("10.46 USD"));
    expect(deps.client.registerDomain).toHaveBeenCalledWith(
      expect.objectContaining({ domainName: "acmecorp.com", sandbox: false })
    );
    const out = text(deps.log);
    expect(out).toContain("billable, non-refundable");
    expect(out).toContain("State:     succeeded");
    expect(out).toContain("Expires:    2027-11-09T20:31:50Z");
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it("does nothing when the user declines", async () => {
    const deps = makeDeps({ confirm: vi.fn(async () => false) });
    await runRegistrarRegister("acmecorp.com", REGISTER_FLAGS, deps);
    expect(deps.client.registerDomain).not.toHaveBeenCalled();
    expect(text(deps.log)).toContain("Nothing was registered");
  });

  it("refuses without --yes when not interactive", async () => {
    const deps = makeDeps({ isTTY: vi.fn(() => false) });
    await runRegistrarRegister("acmecorp.com", REGISTER_FLAGS, deps);
    expect(deps.client.registerDomain).not.toHaveBeenCalled();
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(text(deps.error)).toContain("--yes");
  });

  it("refuses above --maxPrice before prompting", async () => {
    const deps = makeDeps();
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, maxPrice: "10", yes: true }, deps);
    expect(deps.client.registerDomain).not.toHaveBeenCalled();
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(text(deps.error)).toContain("above the 10 limit");
  });

  it("refuses an unavailable domain", async () => {
    const deps = makeDeps();
    deps.client.checkDomains.mockResolvedValueOnce({
      domains: [{ name: "acmecorp.com", registrable: false, reason: "domain_unavailable" } as never],
    });
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true }, deps);
    expect(deps.client.registerDomain).not.toHaveBeenCalled();
    expect(text(deps.error)).toContain("already registered");
  });

  it("polls an in-progress registration without re-submitting it", async () => {
    const deps = makeDeps();
    deps.client.registerDomain.mockResolvedValueOnce(workflow("pending"));
    deps.client.getRegistrationStatus
      .mockResolvedValueOnce(workflow("in_progress"))
      .mockResolvedValueOnce(workflow("succeeded"));
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true }, deps);
    expect(deps.client.registerDomain).toHaveBeenCalledTimes(1);
    expect(deps.client.getRegistrationStatus).toHaveBeenCalledTimes(2);
    expect(text(deps.log)).toContain("State:     succeeded");
  });

  it("--noWait asks for an async response and skips polling", async () => {
    const deps = makeDeps();
    deps.client.registerDomain.mockResolvedValueOnce(workflow("pending"));
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true, noWait: true }, deps);
    expect(deps.client.registerDomain).toHaveBeenCalledWith(
      expect.objectContaining({ respondAsync: true })
    );
    expect(deps.client.getRegistrationStatus).not.toHaveBeenCalled();
    expect(text(deps.log)).toContain("Do not re-run register");
  });

  it("exits 1 on a failed workflow", async () => {
    const deps = makeDeps();
    deps.client.registerDomain.mockResolvedValueOnce(workflow("failed"));
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true }, deps);
    expect(text(deps.log)).toContain("registry_error: Registry rejected");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("keeps stdout pure JSON in --json mode", async () => {
    const deps = makeDeps();
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true, json: true }, deps);
    expect(deps.log).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(deps.log.mock.calls[0]![0]));
    expect(parsed).toMatchObject({ state: "succeeded", registration: { status: "active" } });
    expect(text(deps.error)).toContain("Price:      10.46 USD");
  });

  it("states that sandbox registrations are free", async () => {
    const deps = makeDeps();
    await runRegistrarRegister("acmecorp.com", { ...REGISTER_FLAGS, yes: true, sandbox: true }, deps);
    expect(text(deps.log)).toContain("SANDBOX: no charge");
    expect(deps.client.registerDomain).toHaveBeenCalledWith(expect.objectContaining({ sandbox: true }));
  });
});

describe("registrar status", () => {
  it("explains that dashboard-registered domains have no workflow", async () => {
    const deps = makeDeps();
    deps.client.getRegistrationStatus.mockRejectedValueOnce(
      new CloudflareError("No workflow found for acmecorp.com", "10000", 404)
    );
    await runRegistrarStatus("acmecorp.com", { sandbox: false, json: false, wait: false }, deps);
    expect(text(deps.error)).toContain("cloudflare registrar get acmecorp.com");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it("exits 1 on action_required", async () => {
    const deps = makeDeps();
    deps.client.getRegistrationStatus.mockResolvedValueOnce(workflow("action_required"));
    await runRegistrarStatus("acmecorp.com", { sandbox: false, json: false, wait: false }, deps);
    expect(text(deps.log)).toContain("needs action");
    expect(deps.exit).toHaveBeenCalledWith(1);
  });
});

describe("registrar list", () => {
  it("--all follows cursors until the last page", async () => {
    const deps = makeDeps();
    deps.client.listRegistrations
      .mockResolvedValueOnce({ registrations: [REGISTRATION], nextCursor: "c1" })
      .mockResolvedValueOnce({ registrations: [{ ...REGISTRATION, domain_name: "b.com" }], nextCursor: undefined });
    await runRegistrarList({ sandbox: false, json: false, desc: false, all: true }, deps);
    expect(deps.client.listRegistrations).toHaveBeenCalledTimes(2);
    expect(deps.client.listRegistrations).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "c1" }));
    const out = text(deps.log);
    expect(out).toContain("acmecorp.com  active");
    expect(out).toContain("b.com  active");
    expect(out).not.toContain("More registrations");
  });
});

describe("parseContactFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "registrar-contact-"));
  const contact = {
    email: "ada@example.com",
    phone: "+1.5555555555",
    postal_info: {
      name: "Ada Lovelace",
      address: { street: "1 Main", city: "Austin", state: "TX", postal_code: "78701", country_code: "US" },
    },
  };

  it("treats a single contact as the registrant", () => {
    const path = join(dir, "single.json");
    writeFileSync(path, JSON.stringify(contact));
    expect(parseContactFile(path)).toEqual({ registrant: contact });
  });

  it("accepts a role map", () => {
    const path = join(dir, "roles.json");
    writeFileSync(path, JSON.stringify({ registrant: contact, technical: contact }));
    expect(parseContactFile(path)).toEqual({ registrant: contact, technical: contact });
  });

  it("reports which fields are invalid", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ email: "nope" }));
    expect(() => parseContactFile(path)).toThrow(/email: Invalid email; phone: Required/u);
  });
});
