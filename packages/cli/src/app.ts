import { buildApplication, buildRouteMap } from "@stricli/core";
import { listCommand } from "./commands/list.js";
import { getCommand } from "./commands/get.js";
import { createCommand } from "./commands/create.js";
import { deleteCommand } from "./commands/delete.js";
import { listAuditLogsCommand } from "./commands/audit-list.js";
import { listDnsRecordsCommand } from "./commands/dns-list.js";
import { updateDnsRecordCommand } from "./commands/dns-update.js";

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
    dns: dnsRoutes,
  },
  docs: {
    brief: "Cloudflare integration tools",
  },
});

export const app = buildApplication(routes, {
  name: "cloudflare",
  versionInfo: {
    currentVersion: "0.1.0",
  },
});
