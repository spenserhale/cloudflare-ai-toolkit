import { FastMCP } from "fastmcp";
import { registerResourceTools } from "./tools/resources.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerDnsTools } from "./tools/dns.js";

const server = new FastMCP({
  name: "cloudflare-toolkit",
  version: "0.1.0",
});

// Register tool groups
registerResourceTools(server);
registerAuditTools(server);
registerDnsTools(server);

// Start the server in stdio mode (for Claude Desktop, Cursor, etc.)
server.start({
  transportType: "stdio",
});
