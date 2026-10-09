/**
 * Owner-scoped Supabase doubles for T4.2 MCP tool pins.
 */

import {
  ITEM_STATUS_OPEN,
  type CallRunRow,
  type ItemRow,
  type PatternReportRow,
  type SlotRow,
  type UserScopedClient,
} from "./mod.ts"

export const A = "00000000-0000-4000-8000-00000000000a"
export const B = "00000000-0000-4000-8000-00000000000b"

export type Store = {
  items: ItemRow[]
  slots: SlotRow[]
  call_runs: CallRunRow[]
  pattern_reports: PatternReportRow[]
}

function item(
  id: string,
  user_id: string,
  text: string,
  source: string,
): ItemRow {
  return {
    id,
    user_id,
    text,
    status: ITEM_STATUS_OPEN,
    since_date: null,
    source,
    seeded: false,
    audio_url: null,
    created_at: "2026-08-01T00:00:00.000Z",
    retired_at: null,
    retired_reason: null,
  }
}

function slot(id: string, user_id: string, local_time: string, part_of_day: string): SlotRow {
  return {
    id,
    user_id,
    local_time,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    part_of_day,
    active: true,
    created_at: "2026-08-01T00:00:00.000Z",
  }
}

function run(
  id: string,
  user_id: string,
  scheduled_for: string,
): CallRunRow {
  return {
    id,
    user_id,
    slot_id: null,
    local_date: scheduled_for.slice(0, 10),
    part_of_day: "morning",
    scheduled_for,
    state: "completed",
    disposition: "answered_extracted",
    mood: "ok",
    poll_after: null,
    idempotency_key: id,
    calle_call_id: null,
    calle_confidence: null,
    calle_failure: null,
    briefing: {},
    dry_run: false,
    billable: true,
    claimed_at: null,
    dispatched_at: null,
    completed_at: scheduled_for,
    created_at: scheduled_for,
    finalise_attempts: 0,
    finalise_after: null,
    finalise_error: null,
    terminal_writer: "poll", // a live terminal move names its writer, here the poll tick
  }
}

function report(
  id: string,
  user_id: string,
  created_at: string,
  facts: { mentions: Record<string, number> },
  prose: string,
): PatternReportRow {
  return {
    id,
    user_id,
    period_start: "2026-09-01",
    period_end: "2026-09-07",
    facts,
    prose,
    created_at,
  }
}

export function createStore(): Store {
  return {
    items: [item("item-a1", A, "dentist", "web"), item("item-b1", B, "visa", "telegram")],
    slots: [slot("slot-a1", A, "08:00:00", "morning"), slot("slot-b1", B, "19:00:00", "evening")],
    call_runs: [
      run("run-a-old", A, "2026-09-10T02:30:00.000Z"),
      run("run-a-new", A, "2026-09-12T02:30:00.000Z"),
      run("run-b1", B, "2026-09-12T13:30:00.000Z"),
    ],
    pattern_reports: [
      report("pat-a-old", A, "2026-08-08T00:00:00.000Z", { mentions: { dentist: 1 } }, "Quiet"),
      report("pat-a-new", A, "2026-09-08T00:00:00.000Z", { mentions: { dentist: 3 } }, "Dentist again"),
      report("pat-b1", B, "2026-09-09T00:00:00.000Z", { mentions: { visa: 2 } }, "Visa open"),
    ],
  }
}

type Filter = { column: string; value: unknown }

function owned<T extends { user_id: string }>(rows: T[], ownerId: string): T[] {
  return rows.filter((row) => row.user_id === ownerId)
}

function match(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => row[f.column] === f.value)
}

export function createOwnerClient(ownerId: string, store: Store): UserScopedClient {
  const from = (table: string) => {
    const filters: Filter[] = []
    let pendingInsert: Record<string, unknown> | null = null
    let pendingUpdate: Record<string, unknown> | null = null
    let orderColumn: string | null = null
    let orderAsc = true
    let limitN: number | null = null
    let wantSingle = false
    let wantMaybe = false

    const tableRows = (): Record<string, unknown>[] => {
      if (table === "items") return owned(store.items, ownerId) as unknown as Record<string, unknown>[]
      if (table === "slots") return owned(store.slots, ownerId) as unknown as Record<string, unknown>[]
      if (table === "call_runs") return owned(store.call_runs, ownerId) as unknown as Record<string, unknown>[]
      if (table === "pattern_reports") {
        return owned(store.pattern_reports, ownerId) as unknown as Record<string, unknown>[]
      }
      throw new Error(`unexpected table ${table}`)
    }

    const finish = () => {
      if (pendingInsert) {
        if (pendingInsert.user_id !== ownerId) {
          return { data: null, error: { message: "RLS blocked insert for other user" } }
        }
        if (table === "items") {
          const row = item(crypto.randomUUID(), ownerId, String(pendingInsert.text), String(pendingInsert.source))
          row.status = String(pendingInsert.status ?? ITEM_STATUS_OPEN)
          row.since_date = (pendingInsert.since_date as string | null) ?? null
          store.items.push(row)
          return { data: wantSingle || wantMaybe ? row : [row], error: null }
        }
        if (table === "slots") {
          const row = slot(
            crypto.randomUUID(),
            ownerId,
            String(pendingInsert.local_time),
            String(pendingInsert.part_of_day),
          )
          row.weekdays = (pendingInsert.weekdays as number[]) ?? row.weekdays
          row.active = Boolean(pendingInsert.active ?? true)
          store.slots.push(row)
          return { data: wantSingle || wantMaybe ? row : [row], error: null }
        }
        return { data: null, error: { message: `insert unsupported ${table}` } }
      }
      if (pendingUpdate) {
        const list = table === "items" ? store.items : table === "slots" ? store.slots : []
        const candidates = list.filter(
          (row) => row.user_id === ownerId && match(row as unknown as Record<string, unknown>, filters),
        )
        if (!candidates.length) {
          return wantMaybe ? { data: null, error: null } : { data: null, error: { message: "no rows" } }
        }
        Object.assign(candidates[0], pendingUpdate)
        return { data: wantSingle || wantMaybe ? candidates[0] : candidates, error: null }
      }
      let rows = tableRows().filter((row) => match(row, filters))
      if (orderColumn) {
        const col = orderColumn
        rows = [...rows].sort((l, r) => {
          const lv = String(l[col] ?? "")
          const rv = String(r[col] ?? "")
          return orderAsc ? lv.localeCompare(rv) : rv.localeCompare(lv)
        })
      }
      if (limitN !== null) rows = rows.slice(0, limitN)
      if (wantSingle || wantMaybe) {
        if (!rows.length) {
          return wantMaybe ? { data: null, error: null } : { data: null, error: { message: "no rows" } }
        }
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null }
    }

    const chain: Record<string, unknown> = {
      then(onfulfilled?: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) {
        return Promise.resolve(finish()).then(onfulfilled, onrejected)
      },
      eq(column: string, value: unknown) {
        filters.push({ column, value })
        return chain
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orderColumn = column
        orderAsc = opts?.ascending !== false
        return chain
      },
      limit(n: number) {
        limitN = n
        return chain
      },
      select(_c?: string) {
        return chain
      },
      single() {
        wantSingle = true
        return chain
      },
      maybeSingle() {
        wantMaybe = true
        return chain
      },
    }
    return {
      select: (_c?: string) => chain,
      insert: (row: Record<string, unknown>) => {
        pendingInsert = row
        return chain
      },
      update: (row: Record<string, unknown>) => {
        pendingUpdate = row
        return chain
      },
    }
  }
  return { from } as unknown as UserScopedClient
}
