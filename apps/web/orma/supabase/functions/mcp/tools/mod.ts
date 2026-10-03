/**
 * T4.2 MCP tool registration.
 *
 * Export `registerOrmaTools(server, client, user)` for the T4.1 index to call.
 * This module owns tool bodies only. It does not own transport or JWT auth.
 *
 * Index wiring (one-line contract, see t4.2-contract-change.md):
 * replace stub registration with `registerOrmaTools(server, client, user)`.
 */

import { z } from "npm:zod@3.25.76"
import type { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js"

import {
  addItem,
  getLastCall,
  getPatterns,
  listItems,
  retireItem,
  setSlot,
} from "./handlers.ts"
import {
  PARTS_OF_DAY,
  TOOL_NAMES,
  type ToolUser,
  type UserScopedClient,
} from "./types.ts"

export {
  encodeRetiredReason,
  ITEM_SOURCE_MCP,
  ITEM_STATUS_OPEN,
  ITEM_STATUS_RETIRED,
  parseRetiredReason,
  RETIRE_SURFACE_MCP,
  TOOL_NAMES,
  toolErr,
  toolOk,
} from "./types.ts"
export type {
  CallRunRow,
  ItemRow,
  PartOfDay,
  PatternReportRow,
  SlotRow,
  ToolContentResult,
  ToolName,
  ToolUser,
  UserScopedClient,
} from "./types.ts"
export {
  addItem,
  getLastCall,
  getPatterns,
  listItems,
  restoreRetiredItem,
  retireItem,
  setSlot,
} from "./handlers.ts"

const partOfDaySchema = z.enum(PARTS_OF_DAY)

/**
 * Register all six Orma MCP tools on an McpServer.
 * Every handler uses the caller-scoped client under RLS.
 */
export function registerOrmaTools(
  server: McpServer,
  client: UserScopedClient,
  user: ToolUser,
): void {
  server.registerTool(
    "add_item",
    {
      description:
        "Add an open item for the caller. Always writes source mcp.",
      inputSchema: {
        text: z.string().describe("Item text to track"),
        since_date: z
          .string()
          .optional()
          .describe("Optional user-stated since date YYYY-MM-DD"),
      },
    },
    async (args: { text: string; since_date?: string }) => addItem(client, user, args),
  )

  server.registerTool(
    "list_items",
    {
      description: "List the caller's open items under row-level security.",
    },
    async () => listItems(client, user),
  )

  server.registerTool(
    "retire_item",
    {
      description:
        "Retire an open item. Records surface mcp and who. Reversible from the web.",
      inputSchema: {
        item_id: z.string().describe("UUID of the item to retire"),
        reason: z
          .string()
          .optional()
          .describe("Optional note stored after the mcp surface marker"),
      },
    },
    async (args: { item_id: string; reason?: string }) => retireItem(client, user, args),
  )

  server.registerTool(
    "set_slot",
    {
      description:
        "Write a call slot directly for the authenticated caller.",
      inputSchema: {
        local_time: z
          .string()
          .describe("Local time as HH:MM or HH:MM:SS"),
        part_of_day: partOfDaySchema.describe("morning, midday, or evening"),
        weekdays: z
          .array(z.number().int().min(1).max(7))
          .optional()
          .describe("Weekdays 1-7, defaults to every day"),
        active: z
          .boolean()
          .optional()
          .describe("Whether the slot is active, defaults true"),
        slot_id: z
          .string()
          .optional()
          .describe("Existing slot id to update. Omit to insert."),
      },
    },
    async (args: {
      local_time: string
      part_of_day: (typeof PARTS_OF_DAY)[number]
      weekdays?: number[]
      active?: boolean
      slot_id?: string
    }) =>
      setSlot(client, user, {
        local_time: args.local_time,
        part_of_day: args.part_of_day,
        weekdays: args.weekdays,
        active: args.active,
        slot_id: args.slot_id,
      }),
  )

  server.registerTool(
    "get_last_call",
    {
      description: "Return the caller's latest call_runs row by scheduled_for.",
    },
    async () => getLastCall(client, user),
  )

  server.registerTool(
    "get_patterns",
    {
      description:
        "Return the latest pattern_reports row including facts.",
    },
    async () => getPatterns(client, user),
  )

  void TOOL_NAMES
}
