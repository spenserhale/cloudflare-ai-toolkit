import type { CloudflareClient } from "./client.js";
import {
  TERMINAL_REGISTRATION_STATES,
  type DomainAvailability,
  type DomainPricing,
  type RegistrarTarget,
  type RegistrationWorkflowState,
  type RegistrationWorkflowStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Price handling
// ---------------------------------------------------------------------------

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/u;

/**
 * Parses a non-negative decimal price string (`"8.50"`, `"10"`) into integer
 * millionths so prices compare exactly, without float rounding surprises.
 * Returns `undefined` for anything that is not a plain decimal.
 */
export function parsePriceMicros(value: string): bigint | undefined {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return undefined;
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > 6) return undefined;
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

// ---------------------------------------------------------------------------
// Pre-registration check
// ---------------------------------------------------------------------------

export interface RegistrationPriceLimit {
  /** Refuse when the registration cost is above this decimal amount. */
  readonly maxRegistrationCost?: string;
  /** Refuse when the quoted currency differs (case-insensitive). */
  readonly currency?: string;
}

export type RegistrationAssessment =
  | {
      readonly ok: true;
      readonly domain: string;
      readonly pricing: DomainPricing;
      readonly check: DomainAvailability;
    }
  | {
      readonly ok: false;
      readonly domain: string;
      /** Machine-readable refusal: a Cloudflare `reason`, or one of ours. */
      readonly code: string;
      readonly message: string;
      readonly check?: DomainAvailability;
    };

const REASON_MESSAGES: Record<string, string> = {
  domain_unavailable: "is already registered or otherwise unavailable",
  domain_premium:
    "is a premium domain, which the Registrar API cannot register yet (use the dashboard)",
  extension_not_supported_via_api:
    "uses an extension Cloudflare supports only in the dashboard, not through the API",
  extension_not_supported: "uses an extension Cloudflare Registrar does not support",
  extension_disallows_registration:
    "uses an extension whose registry is not accepting new registrations",
};

/**
 * Decides from a fresh `checkDomains` result whether a registration may go
 * ahead: the domain must be registrable, standard tier, priced, and within the
 * optional price limit. Pure, so callers can show the reasoning before buying.
 */
export function assessRegistration(
  domain: string,
  check: DomainAvailability | undefined,
  limit: RegistrationPriceLimit = {}
): RegistrationAssessment {
  if (check === undefined) {
    return {
      ok: false,
      domain,
      code: "not_checked",
      message: `The availability check returned no result for ${domain}.`,
    };
  }

  if (!check.registrable) {
    const reason = check.reason ?? "not_registrable";
    const detail = REASON_MESSAGES[reason] ?? `is not registrable (${reason})`;
    return { ok: false, domain, code: reason, message: `${domain} ${detail}.`, check };
  }

  // Premium registration needs a fee acknowledgement the API does not accept yet.
  if (check.tier !== undefined && check.tier !== "standard") {
    return {
      ok: false,
      domain,
      code: "domain_premium",
      message: `${domain} ${REASON_MESSAGES.domain_premium}.`,
      check,
    };
  }

  const pricing = check.pricing;
  const cost = pricing ? parsePriceMicros(pricing.registration_cost) : undefined;
  if (pricing === undefined || cost === undefined) {
    return {
      ok: false,
      domain,
      code: "price_unknown",
      message: `Cloudflare did not return a usable price for ${domain}; refusing to register without one.`,
      check,
    };
  }

  if (
    limit.currency !== undefined &&
    limit.currency.toUpperCase() !== pricing.currency.toUpperCase()
  ) {
    return {
      ok: false,
      domain,
      code: "currency_mismatch",
      message: `${domain} is priced in ${pricing.currency}, not ${limit.currency}.`,
      check,
    };
  }

  if (limit.maxRegistrationCost !== undefined) {
    const max = parsePriceMicros(limit.maxRegistrationCost);
    if (max === undefined) {
      return {
        ok: false,
        domain,
        code: "invalid_price_limit",
        message: `Price limit '${limit.maxRegistrationCost}' is not a decimal amount like 10 or 10.50.`,
        check,
      };
    }
    if (cost > max) {
      return {
        ok: false,
        domain,
        code: "price_above_limit",
        message: `${domain} costs ${pricing.registration_cost} ${pricing.currency}, above the ${limit.maxRegistrationCost} limit.`,
        check,
      };
    }
  }

  return { ok: true, domain, pricing, check };
}

/** Runs a fresh registry check for one domain and assesses it. */
export async function prepareDomainRegistration(
  client: Pick<CloudflareClient, "checkDomains">,
  domain: string,
  options: RegistrarTarget & RegistrationPriceLimit = {}
): Promise<RegistrationAssessment> {
  const normalized = domain.trim().toLowerCase();
  const { domains } = await client.checkDomains({
    domains: [normalized],
    accountId: options.accountId,
    sandbox: options.sandbox,
  });
  const check =
    domains.find((entry) => entry.name.toLowerCase() === normalized) ?? domains[0];
  return assessRegistration(normalized, check, options);
}

// ---------------------------------------------------------------------------
// Workflow polling
// ---------------------------------------------------------------------------

export function isTerminalRegistrationState(state: string): boolean {
  return (TERMINAL_REGISTRATION_STATES as readonly string[]).includes(
    state as RegistrationWorkflowState
  );
}

export interface WaitForRegistrationOptions extends RegistrarTarget {
  /** Delay between polls. Default 3s. */
  readonly intervalMs?: number;
  /** Give up (without failing the registration) after this long. Default 120s. */
  readonly timeoutMs?: number;
  readonly onPoll?: (status: RegistrationWorkflowStatus) => void;
  /** Injectable for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface WaitForRegistrationResult {
  readonly status: RegistrationWorkflowStatus;
  /** True when polling stopped at the timeout with the workflow still running. */
  readonly timedOut: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls a registration workflow until it reaches a terminal state
 * (`succeeded`, `failed`, `action_required`, `blocked`) or the timeout passes.
 * It only reads status; it never re-submits the registration.
 */
export async function waitForRegistration(
  client: Pick<CloudflareClient, "getRegistrationStatus">,
  domainName: string,
  options: WaitForRegistrationOptions = {}
): Promise<WaitForRegistrationResult> {
  const intervalMs = options.intervalMs ?? 3_000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const target = { accountId: options.accountId, sandbox: options.sandbox };
  const deadline = now() + timeoutMs;

  while (true) {
    const status = await client.getRegistrationStatus(domainName, target);
    options.onPoll?.(status);
    if (status.completed || isTerminalRegistrationState(status.state)) {
      return { status, timedOut: false };
    }
    if (now() + intervalMs > deadline) {
      return { status, timedOut: true };
    }
    await sleep(intervalMs);
  }
}
