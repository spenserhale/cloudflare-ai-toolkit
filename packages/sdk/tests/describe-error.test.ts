import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { CloudflareAuthError, CloudflareError, describeError } from "../src/index.js";

describe("describeError", () => {
  it("explains a 403 without a known permission, naming the account", () => {
    const err = new CloudflareError("Unauthorized to access requested resource", "10000", 403, {
      requestMethod: "GET",
      requestPath: "/client/v4/accounts/acc-9/registrar/registrations",
    });
    const text = describeError(err);
    expect(text).toContain("Cloudflare error code: 10000");
    expect(text).toContain("Request: GET /client/v4/accounts/acc-9/registrar/registrations (HTTP 403)");
    expect(text).toContain("resources include account acc-9");
    expect(text).not.toContain("Required permission");
  });

  it("names the permission and docs when the route has a hint", () => {
    const err = new CloudflareError("Forbidden", "9109", 403, {
      requiredPermissions: ["DNS Write"],
      docsUrl: "https://developers.cloudflare.com/api/x/",
      requestMethod: "POST",
      requestPath: "/client/v4/zones/z1/dns_records",
    });
    const text = describeError(err);
    expect(text).toContain("Required permission: 'DNS Write'");
    expect(text).toContain("Add the permission above");
    expect(text).toContain("the zone or account this request targets");
    expect(text.endsWith("Docs: https://developers.cloudflare.com/api/x/")).toBe(true);
  });

  it("explains rejected credentials", () => {
    const text = describeError(new CloudflareAuthError("Invalid API Token"));
    expect(text).toContain("Authentication failed: Invalid API Token");
    expect(text).toContain("CLOUDFLARE_API_TOKEN");
    expect(text).not.toContain("error code");
  });

  it("points to the dashboard when the account has no default registrant", () => {
    const err = new CloudflareError(
      "No registrant contact provided and no default address book entry found for this account.",
      "10000",
      400,
      { requestMethod: "POST", requestPath: "/client/v4/accounts/acc-9/registrar/registrations" }
    );
    expect(describeError(err)).toContain("https://dash.cloudflare.com/acc-9/domains/registrations");
  });

  it("explains missing credentials from resolveConfig", () => {
    const result = z.object({ auth: z.string() }).safeParse({});
    expect(describeError(result.error)).toContain("No Cloudflare credentials configured");
  });

  it("passes other errors through", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
  });
});
