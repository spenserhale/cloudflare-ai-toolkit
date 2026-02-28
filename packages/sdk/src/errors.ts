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
