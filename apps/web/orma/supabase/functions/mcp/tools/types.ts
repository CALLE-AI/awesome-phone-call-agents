/**
 * Shared MCP tool constants and result helpers for T4.2.
 *
 * Item source for this surface is always `mcp`.
 * Retirement stores durable who and surface in `retired_reason`
 * as `mcp:<userId>` or `mcp:<userId>:<note>`.
 * Web restore clears status and retired fields via the user client.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import type { Database } from "../../_shared/database.types.ts"

export const ITEM_SOURCE_MCP = "mcp" as const
export const RETIRE_SURFACE_MCP = "mcp" as const
export const ITEM_STATUS_OPEN = "open" as const
export const ITEM_STATUS_RETIRED = "retired" as const

export const PARTS_OF_DAY = ["morning", "midday", "evening"] as const
export type PartOfDay = (typeof PARTS_OF_DAY)[number]

export const TOOL_NAMES = [
  "add_item",
  "list_items",
  "retire_item",
  "set_slot",
  "get_last_call",
  "get_patterns",
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

export type UserScopedClient = SupabaseClient<Database>

export type ToolUser = {
  userId: string
}

export type ToolContentResult = {
  content: Array<{ type: "text"; text: string }>
  isError?: boolean
}

export function toolOk(payload: unknown): ToolContentResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  }
}

export function toolErr(message: string): ToolContentResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  }
}

/** Durable attribution: mcp:<userId> or mcp:<userId>:<note>. */
export function encodeRetiredReason(userId: string, note?: string): string {
  const who = userId.trim()
  const base = `${RETIRE_SURFACE_MCP}:${who}`
  const trimmed = note?.trim() ?? ""
  return trimmed === "" ? base : `${base}:${trimmed}`
}

export function parseRetiredReason(value: string | null | undefined): {
  surface: string | null
  who: string | null
  note: string | null
} {
  if (!value) return { surface: null, who: null, note: null }
  const parts = value.split(":")
  if (parts[0] !== RETIRE_SURFACE_MCP) {
    return { surface: parts[0] ?? null, who: null, note: null }
  }
  if (parts.length < 2 || parts[1] === "") {
    return { surface: RETIRE_SURFACE_MCP, who: null, note: null }
  }
  return {
    surface: RETIRE_SURFACE_MCP,
    who: parts[1],
    note: parts.length > 2 ? parts.slice(2).join(":") : null,
  }
}

export type ItemRow = Database["public"]["Tables"]["items"]["Row"]
export type SlotRow = Database["public"]["Tables"]["slots"]["Row"]
export type CallRunRow = Database["public"]["Tables"]["call_runs"]["Row"]
export type PatternReportRow = Database["public"]["Tables"]["pattern_reports"]["Row"]
