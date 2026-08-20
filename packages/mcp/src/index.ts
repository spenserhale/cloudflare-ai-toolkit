#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import pkg from "../package.json" with { type: "json" };
import { registerResourceTools } from "./tools/resources.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerCacheTools } from "./tools/cache.js";
import { registerCustomHostnameTools } from "./tools/custom-hostnames.js";
import { registerDnsTools } from "./tools/dns.js";
import { registerLogExplorerTools } from "./tools/log-explorer.js";
import { registerRedirectTools } from "./tools/redirects.js";
import { registerTokenTools } from "./tools/tokens.js";
import { registerWafTools } from "./tools/waf.js";
import { registerZoneTools } from "./tools/zones.js";

const server = new FastMCP({
  name: "cloudflare-ai-toolkit",
  version: pkg.version as `${number}.${number}.${number}`,
});

registerResourceTools(server);
registerAuditTools(server);
registerCacheTools(server);
registerDnsTools(server);
registerLogExplorerTools(server);
registerRedirectTools(server);
registerTokenTools(server);
registerWafTools(server);
registerZoneTools(server);
registerCustomHostnameTools(server);

server.start({
  transportType: "stdio",
});
