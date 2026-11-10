import { UserError, type FastMCP } from "fastmcp";
import { describeError } from "@cloudflare-ai-toolkit/sdk";

/**
 * Wraps `server.addTool` so every tool's failures reach the client as a full
 * explanation (Cloudflare code, request, missing permission, what the HTTP
 * status means, known fixes, docs link) instead of a bare message. Call once,
 * before registering tools.
 */
export function withExplanatoryErrors(server: FastMCP): FastMCP {
  const addTool = server.addTool.bind(server);
  server.addTool = ((tool) =>
    addTool({
      ...tool,
      execute: async (args, context) => {
        try {
          return await tool.execute(args, context);
        } catch (err) {
          if (err instanceof UserError) throw err;
          throw new UserError(describeError(err));
        }
      },
    })) as FastMCP["addTool"];
  return server;
}
