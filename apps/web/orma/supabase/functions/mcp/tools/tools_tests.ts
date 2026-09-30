/**
 * T4.2 MCP tool pins.
 *
 * Doubles enforce owner-scoped reads and writes like T1.2 RLS.
 * Pin add_item source mcp, retire durable who and surface, restore,
 * A/B isolation, set_slot, get_last_call, get_patterns facts,
 * and registerOrmaTools names plus live registered handlers.
 *
 * deno test --allow-net --allow-env --allow-read \
 *   supabase/functions/mcp/tools/tools_tests.ts
 */

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js"
import {
  addItem,
  encodeRetiredReason,
  getLastCall,
  getPatterns,
  listItems,
  parseRetiredReason,
  registerOrmaTools,
  restoreRetiredItem,
  retireItem,
  setSlot,
  ITEM_SOURCE_MCP,
  ITEM_STATUS_OPEN,
  ITEM_STATUS_RETIRED,
  RETIRE_SURFACE_MCP,
  TOOL_NAMES,
  type CallRunRow,
  type ItemRow,
  type PatternReportRow,
  type SlotRow,
  type ToolContentResult,
  type ToolUser,
} from "./mod.ts"

import {
  A,
  B,
  createOwnerClient,
  createStore,
} from "./double.ts"

type RegisteredTool = {
  handler: (...args: unknown[]) => Promise<ToolContentResult>
}

function parseOk(result: { content: Array<{ text: string }>; isError?: boolean }) {
  if (result.isError) throw new Error(`expected ok, got ${result.content[0]?.text}`)
  return JSON.parse(result.content[0].text)
}

function assertError(
  result: { content: Array<{ text: string }>; isError?: boolean },
  needle: string,
) {
  if (!result.isError) throw new Error(`expected error containing ${needle}`)
  if (!result.content[0]?.text.includes(needle)) {
    throw new Error(`expected ${needle} in ${result.content[0]?.text}`)
  }
}

const testFn = (
  Deno as { test?: (n: string, f: () => void | Promise<void>) => void }
).test

if (typeof testFn === "function") {
  testFn("add_item writes source mcp for caller A", async () => {
    const store = createStore()
    const client = createOwnerClient(A, store)
    const user: ToolUser = { userId: A }
    const row = parseOk(await addItem(client, user, { text: " book flights " })) as ItemRow
    if (row.source !== ITEM_SOURCE_MCP) throw new Error("source must be mcp")
    if (row.user_id !== A) throw new Error("user_id must be caller A")
    if (row.text !== "book flights") throw new Error("text must be trimmed")
    if (row.status !== ITEM_STATUS_OPEN) throw new Error("status must be open")
  })

  testFn("list_items isolates user A from user B", async () => {
    const rows = parseOk(await listItems(createOwnerClient(A, createStore()), { userId: A })) as ItemRow[]
    if (rows.length !== 1 || rows[0].id !== "item-a1") throw new Error("caller A only")
    if (rows.some((row) => row.user_id === B)) throw new Error("cross-user leak")
  })

  testFn("retire_item records durable who and surface and restores via client", async () => {
    const store = createStore()
    const client = createOwnerClient(A, store)
    const user: ToolUser = { userId: A }
    const expectedReason = encodeRetiredReason(A)
    const row = parseOk(
      await retireItem(client, user, { item_id: "item-a1" }),
    ) as ItemRow & { retired_by: string; retired_surface: string; reversible: boolean }
    if (row.status !== ITEM_STATUS_RETIRED) throw new Error("status retired")
    if (!row.retired_at) throw new Error("retired_at required")
    if (row.retired_reason !== expectedReason) {
      throw new Error(`retired_reason must be ${expectedReason}`)
    }
    if (row.retired_by !== A || row.retired_surface !== RETIRE_SURFACE_MCP) {
      throw new Error("who and surface")
    }
    if (row.reversible !== true) throw new Error("must mark reversible")

    const stored = store.items.find((i) => i.id === "item-a1")!
    if (stored.retired_reason !== expectedReason) {
      throw new Error("durable who missing on item row")
    }
    const parsed = parseRetiredReason(stored.retired_reason)
    if (parsed.who !== A || parsed.surface !== RETIRE_SURFACE_MCP) {
      throw new Error("row retired_reason must parse to mcp who")
    }
    if ("retired_by" in (stored as Record<string, unknown>)) {
      throw new Error("row must not invent retired_by column")
    }

    const restored = parseOk(
      await restoreRetiredItem(client, user, { item_id: "item-a1" }),
    ) as ItemRow
    if (restored.status !== ITEM_STATUS_OPEN) throw new Error("restore status open")
    if (restored.retired_at !== null || restored.retired_reason !== null) {
      throw new Error("restore must clear retired fields")
    }
    if (stored.status !== ITEM_STATUS_OPEN || stored.retired_at !== null || stored.retired_reason !== null) {
      throw new Error("web restore via client must clear store row")
    }
    const listed = parseOk(await listItems(client, user)) as ItemRow[]
    if (!listed.some((item) => item.id === "item-a1")) {
      throw new Error("restored item must list as open")
    }
  })

  testFn("retire_item fails cleanly on user B item for caller A", async () => {
    assertError(
      await retireItem(createOwnerClient(A, createStore()), { userId: A }, { item_id: "item-b1" }),
      "not found",
    )
  })

  testFn("set_slot writes directly for caller and rejects B slot", async () => {
    const store = createStore()
    const client = createOwnerClient(A, store)
    const created = parseOk(
      await setSlot(client, { userId: A }, { local_time: "09:30", part_of_day: "morning" }),
    ) as SlotRow
    if (created.user_id !== A || created.local_time !== "09:30:00") throw new Error("insert slot")
    const updated = parseOk(
      await setSlot(client, { userId: A }, {
        slot_id: "slot-a1",
        local_time: "07:15:00",
        part_of_day: "morning",
        weekdays: [1, 2, 3],
      }),
    ) as SlotRow
    if (updated.local_time !== "07:15:00" || updated.weekdays.join(",") !== "1,2,3") {
      throw new Error("update slot")
    }
    assertError(
      await setSlot(client, { userId: A }, {
        slot_id: "slot-b1",
        local_time: "10:00",
        part_of_day: "midday",
      }),
      "not found",
    )
  })

  testFn("get_last_call returns latest owned run only", async () => {
    const row = parseOk(await getLastCall(createOwnerClient(A, createStore()), { userId: A })) as CallRunRow
    if (row.id !== "run-a-new" || row.user_id !== A) throw new Error("latest owned run")
  })

  testFn("get_patterns returns latest row including facts", async () => {
    const row = parseOk(
      await getPatterns(createOwnerClient(A, createStore()), { userId: A }),
    ) as PatternReportRow
    if (row.id !== "pat-a-new") throw new Error("latest pattern")
    const facts = row.facts as { mentions?: { dentist?: number } }
    if (facts.mentions?.dentist !== 3) throw new Error("facts must be present")
    if (!row.prose.includes("Dentist")) throw new Error("prose must ship")
  })

  testFn("user B cannot read user A patterns or last call", async () => {
    const client = createOwnerClient(B, createStore())
    const call = parseOk(await getLastCall(client, { userId: B })) as CallRunRow
    if (call.id !== "run-b1" || call.user_id === A) throw new Error("call isolation")
    const pattern = parseOk(await getPatterns(client, { userId: B })) as PatternReportRow
    if (pattern.id !== "pat-b1" || pattern.user_id === A) throw new Error("pattern isolation")
  })

  testFn("registerOrmaTools registers names and live handlers", async () => {
    const store = createStore()
    const client = createOwnerClient(A, store)
    const user: ToolUser = { userId: A }
    const server = new McpServer({ name: "orma-test", version: "0.0.0" })
    registerOrmaTools(server, client, user)
    const listed = (
      server as unknown as { _registeredTools: Record<string, RegisteredTool> }
    )._registeredTools
    const names = Object.keys(listed).sort()
    if (names.join(",") !== [...TOOL_NAMES].sort().join(",")) {
      throw new Error(`tool names mismatch: ${names.join(",")}`)
    }

    const added = parseOk(
      await listed.add_item.handler({ text: " via registered handler " }, {}),
    ) as ItemRow
    if (added.source !== ITEM_SOURCE_MCP || added.text !== "via registered handler") {
      throw new Error("registered add_item must write real mcp item")
    }

    const open = parseOk(await listed.list_items.handler({})) as ItemRow[]
    if (!open.some((item) => item.id === added.id)) {
      throw new Error("registered list_items must see added row")
    }

    const retired = parseOk(
      await listed.retire_item.handler({ item_id: added.id }, {}),
    ) as ItemRow & { retired_by: string; reversible: boolean }
    if (retired.status !== ITEM_STATUS_RETIRED || retired.retired_by !== A) {
      throw new Error("registered retire_item must retire with who")
    }
    const durable = store.items.find((i) => i.id === added.id)!
    if (parseRetiredReason(durable.retired_reason).who !== A) {
      throw new Error("registered retire must persist who on row")
    }

    const slot = parseOk(
      await listed.set_slot.handler({ local_time: "11:00", part_of_day: "midday" }, {}),
    ) as SlotRow
    if (slot.user_id !== A || slot.local_time !== "11:00:00") {
      throw new Error("registered set_slot must insert")
    }

    const last = parseOk(await listed.get_last_call.handler({})) as CallRunRow
    if (last.id !== "run-a-new") throw new Error("registered get_last_call")

    const pattern = parseOk(await listed.get_patterns.handler({})) as PatternReportRow
    if (pattern.id !== "pat-a-new") throw new Error("registered get_patterns")
  })
}
