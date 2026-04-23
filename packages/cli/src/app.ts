import { buildApplication, buildRouteMap } from "@stricli/core";
import pkg from "../package.json" with { type: "json" };
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { createCommand } from "./commands/create.js";
import { deleteCommand } from "./commands/delete.js";
import { listAuditLogsCommand } from "./commands/audit-list.js";
import {
  purgeCacheEverythingCommand,
  purgeCacheByUrlsCommand,
  purgeCacheByTagsCommand,
  purgeCacheByPrefixesCommand,
  purgeCacheByHostsCommand,
} from "./commands/cache-purge.js";
import { listDnsRecordsCommand } from "./commands/dns-list.js";
import { updateDnsRecordCommand } from "./commands/dns-update.js";
import { upgradeCommand } from "./commands/upgrade.js";

const resourceRoutes = buildRouteMap({
  routes: {
    list: listCommand,
    get: getCommand,
    create: createCommand,
    delete: deleteCommand,
  },
  docs: {
    brief: "Manage Cloudflare resources",
  },
});

const auditLogRoutes = buildRouteMap({
  routes: {
    list: listAuditLogsCommand,
  },
  docs: {
    brief: "Manage audit logs",
  },
});

const auditRoutes = buildRouteMap({
  routes: {
    logs: auditLogRoutes,
  },
  docs: {
    brief: "Audit log operations",
  },
});

const cachePurgeRoutes = buildRouteMap({
  routes: {
    everything: purgeCacheEverythingCommand,
    urls: purgeCacheByUrlsCommand,
    tags: purgeCacheByTagsCommand,
    prefixes: purgeCacheByPrefixesCommand,
    hosts: purgeCacheByHostsCommand,
  },
  docs: {
    brief: "Purge cached content",
  },
});

const cacheRoutes = buildRouteMap({
  routes: {
    purge: cachePurgeRoutes,
  },
  docs: {
    brief: "Cache operations",
  },
});

const dnsRecordRoutes = buildRouteMap({
  routes: {
    list: listDnsRecordsCommand,
    update: updateDnsRecordCommand,
  },
  docs: {
    brief: "Manage DNS records",
  },
});

const dnsRoutes = buildRouteMap({
  routes: {
    records: dnsRecordRoutes,
  },
  docs: {
    brief: "DNS operations",
  },
});

const routes = buildRouteMap({
  routes: {
    resources: resourceRoutes,
    audit: auditRoutes,
    cache: cacheRoutes,
    dns: dnsRoutes,
    upgrade: upgradeCommand,
  },
  docs: {
    brief: "Cloudflare integration tools",
  },
});

export const app = buildApplication(routes, {
  name: "cloudflare",
  versionInfo: {
    currentVersion: pkg.version,
  },
});
