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
import {
  createCustomHostnameCommand,
  deleteCustomHostnameCommand,
  getCustomHostnameCommand,
  listCustomHostnamesCommand,
  updateCustomHostnameCommand,
} from "./commands/custom-hostnames.js";
import { listDnsRecordsCommand } from "./commands/dns-list.js";
import { updateDnsRecordCommand } from "./commands/dns-update.js";
import { logExplorerQueryCommand } from "./commands/log-explorer-query.js";
import { enableLogExplorerDatasetCommand } from "./commands/log-explorer-datasets-enable.js";
import {
  createRedirectRuleCommand,
  deleteRedirectRuleCommand,
  getRedirectRuleCommand,
  listRedirectRulesCommand,
  updateRedirectRuleCommand,
} from "./commands/redirects.js";
import {
  deleteLogExplorerDatasetCommand,
  getLogExplorerDatasetCommand,
  listAvailableLogExplorerDatasetsCommand,
  listLogExplorerDatasetsCommand,
  updateLogExplorerDatasetCommand,
} from "./commands/log-explorer-datasets.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { getZoneCommand, listZonesCommand } from "./commands/zones.js";
import {
  createFirewallRuleCommand,
  deleteFirewallRuleCommand,
  getFirewallRuleCommand,
  listFirewallRulesCommand,
  updateFirewallRuleCommand,
} from "./commands/waf-rules.js";

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

const zoneRoutes = buildRouteMap({
  routes: {
    list: listZonesCommand,
    get: getZoneCommand,
  },
  docs: {
    brief: "Zone lookups",
  },
});

const customHostnameRoutes = buildRouteMap({
  routes: {
    list: listCustomHostnamesCommand,
    get: getCustomHostnameCommand,
    create: createCustomHostnameCommand,
    update: updateCustomHostnameCommand,
    delete: deleteCustomHostnameCommand,
  },
  docs: {
    brief: "Custom hostname (SSL for SaaS) operations",
  },
});

const firewallRuleRoutes = buildRouteMap({
  routes: {
    list: listFirewallRulesCommand,
    get: getFirewallRuleCommand,
    create: createFirewallRuleCommand,
    update: updateFirewallRuleCommand,
    delete: deleteFirewallRuleCommand,
  },
  docs: {
    brief: "Manage firewall (WAF custom) rules",
  },
});

const wafRoutes = buildRouteMap({
  routes: {
    rules: firewallRuleRoutes,
  },
  docs: {
    brief: "WAF operations",
  },
});

const redirectsRoutes = buildRouteMap({
  routes: {
    list: listRedirectRulesCommand,
    get: getRedirectRuleCommand,
    create: createRedirectRuleCommand,
    update: updateRedirectRuleCommand,
    delete: deleteRedirectRuleCommand,
  },
  docs: {
    brief: "Manage redirect rules",
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

const logExplorerDatasetsRoutes = buildRouteMap({
  routes: {
    list: listLogExplorerDatasetsCommand,
    available: listAvailableLogExplorerDatasetsCommand,
    get: getLogExplorerDatasetCommand,
    enable: enableLogExplorerDatasetCommand,
    update: updateLogExplorerDatasetCommand,
    delete: deleteLogExplorerDatasetCommand,
  },
  docs: {
    brief: "Manage Log Explorer datasets",
  },
});

const logExplorerRoutes = buildRouteMap({
  routes: {
    query: logExplorerQueryCommand,
    datasets: logExplorerDatasetsRoutes,
  },
  docs: {
    brief: "Run Log Explorer SQL queries and manage datasets",
  },
});

const routes = buildRouteMap({
  routes: {
    resources: resourceRoutes,
    audit: auditRoutes,
    cache: cacheRoutes,
    zones: zoneRoutes,
    "custom-hostnames": customHostnameRoutes,
    dns: dnsRoutes,
    waf: wafRoutes,
    redirects: redirectsRoutes,
    "log-explorer": logExplorerRoutes,
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
