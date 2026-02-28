export class CloudflareError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "CloudflareError";
  }
}

export class CloudflareAuthError extends CloudflareError {
  constructor(message = "Authentication failed. Check your API key.") {
    super(message, "AUTH_ERROR", 401);
    this.name = "CloudflareAuthError";
  }
}

export class CloudflareNotFoundError extends CloudflareError {
  constructor(resource: string, id: string) {
    super(`${resource} with id "${id}" not found`, "NOT_FOUND", 404);
    this.name = "CloudflareNotFoundError";
  }
}
