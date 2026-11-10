import { describe, expect, it } from "bun:test";
import { UserError } from "fastmcp";
import { CloudflareError } from "@cloudflare-ai-toolkit/sdk";
import { withExplanatoryErrors } from "./explain.js";

function wrap(execute: () => Promise<string>) {
  let registered: any;
  const server = withExplanatoryErrors({
    addTool: (tool: any) => {
      registered = tool;
    },
  } as unknown as Parameters<typeof withExplanatoryErrors>[0]);
  server.addTool({ name: "t", description: "d", execute } as never);
  return registered;
}

describe("withExplanatoryErrors", () => {
  it("turns a Cloudflare error into an explained UserError", async () => {
    const tool = wrap(async () => {
      throw new CloudflareError("Unauthorized to access requested resource", "10000", 403, {
        requestMethod: "POST",
        requestPath: "/client/v4/accounts/acc-9/registrar/registrations",
      });
    });
    const error = await tool.execute({}, {}).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(UserError);
    expect(error.message).toContain("Request: POST /client/v4/accounts/acc-9/registrar/registrations (HTTP 403)");
    expect(error.message).toContain("resources include account acc-9");
  });

  it("passes results through", async () => {
    const tool = wrap(async () => "ok");
    expect(await tool.execute({}, {})).toBe("ok");
  });
});
