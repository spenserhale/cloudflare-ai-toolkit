export interface CloudflareErrorOptions {
  readonly requiredPermissions?: readonly string[];
  readonly docsUrl?: string;
  readonly requestMethod?: string;
  readonly requestPath?: string;
}

export class CloudflareError extends Error {
  public readonly requiredPermissions?: readonly string[];
  public readonly docsUrl?: string;
  public readonly requestMethod?: string;
  public readonly requestPath?: string;

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
      ? `The credentials are valid but not allowed to do this. Add the permission above to the token and make sure its resources include ${scope}.`
      : `The credentials are valid but not allowed to do this. Check that the token has a permission for this product and that its resources include ${scope}.`;
  }
  if (status === 404) {
    return "Cloudflare could not find that resource. Check the ID or name, and that it belongs to the account or zone the request used.";
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
      "No Cloudflare credentials configured. Set CLOUDFLARE_API_TOKEN, or set both " +
      "CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL. Set CLOUDFLARE_ACCOUNT_ID too for account-level commands."
    );
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
  if (err.requiredPermissions && err.requiredPermissions.length > 0) {
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
