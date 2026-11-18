export interface CloudflareErrorOptions {
  readonly requiredPermissions?: readonly string[];
  readonly docsUrl?: string;
  readonly requestMethod?: string;
  readonly requestPath?: string;
  /** HTTP failure came from a structured Cloudflare API error envelope. */
  readonly apiResponse?: boolean;
}

export class CloudflareError extends Error {
  public readonly requiredPermissions?: readonly string[];
  public readonly docsUrl?: string;
  public readonly requestMethod?: string;
  public readonly requestPath?: string;
  public readonly apiResponse?: boolean;

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    options: CloudflareErrorOptions = {}
  ) {
    super(message);
    this.name = "CloudflareError";
    this.requiredPermissions = options.requiredPermissions;
    this.docsUrl = options.docsUrl;
    this.requestMethod = options.requestMethod;
    this.requestPath = options.requestPath;
    this.apiResponse = options.apiResponse;
  }
}

export class CloudflareAuthError extends CloudflareError {
  constructor(
    message = "Authentication failed. Check your API token or legacy API key credentials.",
    options: CloudflareErrorOptions = {}
  ) {
    super(message, "AUTH_ERROR", 401, options);
    this.name = "CloudflareAuthError";
  }
}

export class CloudflareNotFoundError extends CloudflareError {
  constructor(resource: string, id: string) {
    super(`${resource} with id "${id}" not found`, "NOT_FOUND", 404);
    this.name = "CloudflareNotFoundError";
  }
}

/**
 * Local configuration problem (for example the OS keychain is locked or
 * missing), not an API response. CLIs map it to exit code 3.
 */
export class CloudflareConfigError extends CloudflareError {
  public readonly hint?: string;
  public readonly detail?: string;

  constructor(
    message: string,
    options: { readonly hint?: string; readonly detail?: string; readonly cause?: unknown } = {}
  ) {
    super(message, "CONFIG_ERROR");
    this.name = "CloudflareConfigError";
    this.hint = options.hint;
    this.detail = options.detail;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

interface KnownErrorHint {
  readonly pattern: RegExp;
  readonly hint: (accountId: string) => string;
}

/**
 * Follow-up advice for error messages whose fix isn't obvious from the text.
 * Matched against the Cloudflare message, case-insensitively.
 */
const KNOWN_ERROR_HINTS: readonly KnownErrorHint[] = [
  {
    pattern: /no default address book entry/iu,
    hint: (accountId) =>
      "The account has no default registrant contact. Set one (and accept the registrar agreement) at " +
      `https://dash.cloudflare.com/${accountId}/domains/registrations, ` +
      "or pass a contact with the request (CLI: --contact file.json; MCP: contacts). " +
      "Cloudflare has no API for managing the address book.",
  },
  {
    pattern: /no workflow found/iu,
    hint: () =>
      "Only registrations started through the API have a workflow. For a domain bought in the dashboard, " +
      "read the registration itself instead (CLI: registrar get; MCP: get_domain_registration).",
  },
];

/** `resolveConfig()` throws a ZodError on `auth`/`baseUrl` when no credentials are set. */
function isMissingCredentialsError(err: unknown): boolean {
  if (!(err instanceof Error) || err.name !== "ZodError") return false;
  const issues = (err as Error & { issues?: { path?: unknown[] }[] }).issues;
  return Array.isArray(issues) && issues.some((issue) => issue.path?.[0] === "auth" || issue.path?.[0] === "baseUrl");
}

function accountIdFromPath(path: string | undefined): string {
  return path?.match(/\/accounts\/([^/]+)/u)?.[1] ?? "<account_id>";
}

function statusExplanation(err: CloudflareError): string | undefined {
  const status = err.statusCode;
  if (status === undefined) return undefined;
  if (status === 401) {
    return (
      "Cloudflare rejected the credentials. Check that CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_KEY with " +
      "CLOUDFLARE_EMAIL) is set, correct, and not expired or revoked."
    );
  }
  if (status === 403) {
    const accountId = accountIdFromPath(err.requestPath);
    const scope =
      accountId === "<account_id>"
        ? "the zone or account this request targets"
        : `account ${accountId}`;
    return err.requiredPermissions && err.requiredPermissions.length > 0
      ? `Cloudflare denied this request. Add the permission above if missing and make sure the token resources include ${scope}. A product entitlement or plan restriction can also cause HTTP 403; check the API message.`
      : `Cloudflare denied this request. Check that the token has a permission for this product and its resources include ${scope}. A product entitlement or plan restriction can also cause HTTP 403; check the API message.`;
  }
  if (status === 404) {
    return "Cloudflare could not find that resource. Check the ID or name, account or zone, and product entitlement; some unavailable managed resources also return HTTP 404.";
  }
  if (status === 410) {
    return "Cloudflare retired this API (HTTP 410). Use the supported replacement API; changing token permissions will not restore the retired endpoint.";
  }
  if (status === 429) {
    return "Cloudflare rate-limited the request. Wait a moment and retry.";
  }
  if (status >= 500) {
    return "Cloudflare returned a server error. These are usually transient, so retry before changing anything.";
  }
  return undefined;
}

/**
 * Turns any error into a multi-line explanation for a person or an agent:
 * the message, the Cloudflare code and request, the permission to add, what
 * the HTTP status means, known fixes, and a docs link. Non-Cloudflare errors
 * return their message unchanged.
 */
export function describeError(err: unknown): string {
  if (isMissingCredentialsError(err)) {
    return (
      "No Cloudflare credentials configured. Store a token in the OS keychain with " +
      "`cloudflare auth set api-token`, or set CLOUDFLARE_API_TOKEN (or both CLOUDFLARE_API_KEY and " +
      "CLOUDFLARE_EMAIL) in the environment or a .env file. Set CLOUDFLARE_ACCOUNT_ID too for " +
      "account-level commands."
    );
  }
  if (err instanceof CloudflareConfigError) {
    return [err.message, err.detail ? `Got: ${err.detail}` : "", err.hint ?? ""]
      .filter((line) => line.length > 0)
      .join("\n");
  }
  if (!(err instanceof CloudflareError)) {
    return err instanceof Error ? err.message : String(err);
  }

  const lines = [
    err instanceof CloudflareAuthError ? `Authentication failed: ${err.message}` : err.message,
  ];
  if (err.code && err.code !== "UNKNOWN" && err.code !== "AUTH_ERROR") {
    lines.push(`Cloudflare error code: ${err.code}`);
  }
  if (err.requestMethod && err.requestPath) {
    const status = err.statusCode === undefined ? "" : ` (HTTP ${err.statusCode})`;
    lines.push(`Request: ${err.requestMethod} ${err.requestPath}${status}`);
  }
  if (err.statusCode !== 410 && err.requiredPermissions && err.requiredPermissions.length > 0) {
    lines.push(`Required permission: ${err.requiredPermissions.map((p) => `'${p}'`).join(" or ")}`);
  }
  const explanation = statusExplanation(err);
  if (explanation) lines.push(explanation);
  for (const known of KNOWN_ERROR_HINTS) {
    if (known.pattern.test(err.message)) lines.push(known.hint(accountIdFromPath(err.requestPath)));
  }
  if (err.docsUrl) lines.push(`Docs: ${err.docsUrl}`);
  return lines.join("\n");
}
