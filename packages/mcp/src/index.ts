#!/usr/bin/env node
import { FastMCP } from "fastmcp";
import pkg from "../package.json" with { type: "json" };
import { registerResourceTools } from "./tools/resources.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerCacheTools } from "./tools/cache.js";
import { registerDnsTools } from "./tools/dns.js";

const server = new FastMCP({
  name: "cloudflare-ai-toolkit",
  version: pkg.version as `${number}.${number}.${number}`,
});

registerResourceTools(server);
registerAuditTools(server);
registerCacheTools(server);
registerDnsTools(server);

server.start({
  transportType: "stdio",
});
