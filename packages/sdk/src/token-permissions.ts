import type {
  ApiToken,
  TokenPermission,
  TokenPermissionCheck,
  TokenPermissionGroup,
  TokenPermissionScope,
  TokenPolicyResources,
} from "./types.js";

/**
 * Cloudflare scope URNs, longest first so `com.cloudflare.api.account.zone`
 * wins over its `com.cloudflare.api.account` prefix.
 */
const SCOPE_URNS: readonly (readonly [string, TokenPermissionScope])[] = [
  ["com.cloudflare.api.account.zone", "zone"],
  ["com.cloudflare.api.account", "account"],
  ["com.cloudflare.api.user", "user"],
];

/**
 * A permission group's scope arrives in one of two shapes: the catalog
 * endpoint returns `scopes: string[]`, while groups embedded in a token policy
 * carry a single `meta.scopes` string.
 */
export function readPermissionGroupScopes(
  group: TokenPermissionGroup
): string[] {
  if (group.scopes && group.scopes.length > 0) return [...group.scopes];
  const metaScopes = group.meta?.scopes;
  if (typeof metaScopes === "string" && metaScopes.length > 0) {
    return [metaScopes];
  }
  return [];
}

export function deriveTokenPermissionScope(
  scopes: readonly string[]
): TokenPermissionScope {
  for (const scope of scopes) {
    for (const [urn, name] of SCOPE_URNS) {
      if (scope === urn) return name;
    }
  }
  return "unknown";
}

/**
 * Flatten a policy's `resources` map into the resource identifiers it covers.
 * Nested values (an account containing a zone wildcard) contribute their inner
 * keys, since those are what the policy actually applies to.
 */
export function flattenPolicyResources(
  resources: TokenPolicyResources
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(resources)) {
    if (typeof value === "string") {
      out.push(key);
      continue;
    }
    const nested = Object.keys(value);
    if (nested.length === 0) {
      out.push(key);
      continue;
    }
    for (const inner of nested) out.push(`${key}/${inner}`);
  }
  return out;
}

/**
 * Expand a token's policies into one entry per permission group, carrying the
 * enclosing policy's effect and resources down onto each group.
 */
export function flattenTokenPolicies(token: ApiToken): TokenPermission[] {
  const permissions: TokenPermission[] = [];

  for (const policy of token.policies ?? []) {
    const resources = flattenPolicyResources(policy.resources);
    for (const group of policy.permission_groups) {
      const scopes = readPermissionGroupScopes(group);
      permissions.push({
        policyId: policy.id,
        effect: policy.effect,
        id: group.id,
        name: group.name,
        scope: deriveTokenPermissionScope(scopes),
        scopes,
        resources,
      });
    }
  }

  return permissions;
}

/**
 * Lowercase, treat `:` and `/` as word separators, and collapse whitespace, so
 * the dashboard's "Zone / Config Rules / Edit" rendering and the API's
 * "Config Rules Write" name normalise toward each other.
 */
export function normalizePermissionQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/[:/]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The dashboard labels write-level permissions "Edit" where the API names them
 * "Write". Treat the two as interchangeable in the trailing position.
 */
function levelVariants(value: string): string[] {
  if (value.endsWith(" edit")) {
    return [value, `${value.slice(0, -" edit".length)} write`];
  }
  if (value.endsWith(" write")) {
    return [value, `${value.slice(0, -" write".length)} edit`];
  }
  return [value];
}

function queryForms(query: string, scope: TokenPermissionScope): Set<string> {
  const normalized = normalizePermissionQuery(query);
  const bases = new Set([normalized]);

  // The dashboard renders a permission as "<Scope> / <Group> / <Level>". Drop a
  // leading scope word when it agrees with the group's own scope, so
  // "Zone:Config Rules:Edit" can match a zone-scoped "Config Rules Write".
  const prefix = `${scope} `;
  if (scope !== "unknown" && normalized.startsWith(prefix)) {
    bases.add(normalized.slice(prefix.length));
  }

  const forms = new Set<string>();
  for (const base of bases) {
    for (const variant of levelVariants(base)) forms.add(variant);
  }
  return forms;
}

/**
 * Match a query against one permission group, by permission-group ID (exact,
 * case-insensitive) or by name.
 *
 * Cloudflare documents the group `id` as the stable key and the `name` as
 * "cosmetic and subject to change", so ID matching is the reliable form and
 * name matching is the convenience.
 */
export function permissionMatchesQuery(
  permission: TokenPermission,
  query: string
): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return false;

  if (permission.id.toLowerCase() === trimmed.toLowerCase()) return true;
  if (permission.name === undefined) return false;

  const nameForms = new Set(
    levelVariants(normalizePermissionQuery(permission.name))
  );
  for (const form of queryForms(trimmed, permission.scope)) {
    if (nameForms.has(form)) return true;
  }
  return false;
}

/**
 * Resolve each query against the token's permissions.
 *
 * A query is granted when it matches at least one `allow` permission and no
 * `deny` permission. Cloudflare only applies a deny to the resources its own
 * policy names, which is not modelled here — a matching deny anywhere makes
 * the check report "not granted". That is deliberate: as a gate, a false
 * negative costs a needless retry while a false positive costs a failed write.
 */
export function checkTokenPermissions(
  permissions: readonly TokenPermission[],
  queries: readonly string[]
): TokenPermissionCheck[] {
  return queries.map((query) => {
    const matched = permissions.filter((permission) =>
      permissionMatchesQuery(permission, query)
    );
    const granted =
      matched.some((permission) => permission.effect === "allow") &&
      !matched.some((permission) => permission.effect === "deny");
    return { query, granted, matched };
  });
}

/**
 * Permission-group names on the token that share a word with a failed query,
 * so a near-miss can be corrected without listing every permission.
 */
export function suggestPermissionNames(
  permissions: readonly TokenPermission[],
  query: string,
  limit = 5
): string[] {
  const words = new Set(
    normalizePermissionQuery(query)
      .split(" ")
      .filter((word) => word.length > 2)
  );
  if (words.size === 0) return [];

  const scored = new Map<string, number>();
  for (const permission of permissions) {
    if (permission.name === undefined) continue;
    const nameWords = normalizePermissionQuery(permission.name).split(" ");
    const overlap = nameWords.filter((word) => words.has(word)).length;
    if (overlap === 0) continue;
    const best = scored.get(permission.name) ?? 0;
    if (overlap > best) scored.set(permission.name, overlap);
  }

  // Keep only the closest matches. A query like "Config Rules Read" overlaps
  // every name ending in "Read", and listing those as suggestions buries the
  // one that actually differs by a single word.
  const best = Math.max(...scored.values());
  return [...scored.entries()]
    .filter(([, overlap]) => overlap === best)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}
