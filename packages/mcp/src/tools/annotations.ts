import type { FastMCP } from "fastmcp";

type ToolAnnotations = NonNullable<Parameters<FastMCP["addTool"]>[0]["annotations"]>;

/**
 * MCP clients use these hints to sort tools into permission groups. Claude's
 * connector settings, for example, list `readOnlyHint: true` tools under read
 * tools and everything else under write/delete tools, where an administrator
 * can set Always allow, Ask, or Block. Every tool must declare one of these
 * explicitly; `register.test.ts` enforces it.
 */

/** Reads only. Safe to auto-approve. */
export const READ_ONLY = {
  readOnlyHint: true,
  openWorldHint: true,
} as const satisfies ToolAnnotations;

/** Creates something new without changing or removing existing state. */
export const ADDITIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const satisfies ToolAnnotations;

/** Changes or removes existing state (update, delete, purge). */
export const DESTRUCTIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const satisfies ToolAnnotations;
