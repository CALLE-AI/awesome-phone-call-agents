/**
 * Pure helpers for Today. No network and no framework imports.
 * Every count comes from the rows passed in. Every time renders in the profile's zone.
 */

export const LIVE_STATES = ["claimed", "dispatched", "awaiting_result"] as const
export const TERMINAL_STATES = ["completed", "no_result", "failed", "canceled"] as const

export type RunRow = {
  id: string
  state: string
  disposition: string | null
  mood: string | null
  scheduled_for: string
  claimed_at: string | null
  dispatched_at: string | null
  completed_at: string | null
  poll_after: string | null
  slot_id: string | null
}

export type SlotRow = {
  id?: string
  local_time: string
  weekdays: number[]
  active: boolean
}

export type ItemRow = {
  id: string
  text: string
  status: string
  since_date: string | null
  created_at: string
  source: string
}

export type MentionRow = {
  item_id: string
  call_run_id: string | null
  offset_seconds: number | null
}

export type RunMentionRow = MentionRow & {
  items: {
    text: string
    status: string
    source: string
    created_at: string
    retired_at: string | null
  } | null
}

export type CommitmentRow = {
  item_id: string
  call_run_id: string | null
  due: string | null
  evidence_offset_seconds: number
  items: { text: string } | null
}

export type ConsentRow = {
  kind: string
  revoked_at: string | null
}

export type DispatchProfile = {
  phone_e164: string | null
  phone_confirmed_at: string | null
}

export type CallBlock = {
  reason: "phone" | "consent" | "slot"
  title: string
  detail: string
}

const DAY_MS = 86_400_000

function isLive(state: string): boolean {
  return (LIVE_STATES as readonly string[]).includes(state)
}

function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state)
}

function ms(iso: string | null | undefined): number {
  if (!iso) return Number.NaN
  return Date.parse(iso)
}

/** The earliest run still `scheduled` whose time lies after now. Canceled and terminal runs never count. */
export function pickNextRun<T extends RunRow>(runs: readonly T[], now: Date): T | null {
  let best: T | null = null
  for (const run of runs) {
    if (run.state !== "scheduled") continue
    const at = ms(run.scheduled_for)
    if (!(at > now.getTime())) continue
    if (!best || at < ms(best.scheduled_for)) best = run
  }
  return best
}

/** The most recent run that is claimed, dispatched or awaiting a result. */
export function pickLiveRun<T extends RunRow>(runs: readonly T[]): T | null {
  let best: T | null = null
  for (const run of runs) {
    if (!isLive(run.state)) continue
    if (!best || ms(run.scheduled_for) > ms(best.scheduled_for)) best = run
  }
  return best
}

/** The most recent call that reached a terminal state. A canceled run was never a call. */
export function pickLastCall<T extends RunRow>(runs: readonly T[]): T | null {
  let best: T | null = null
  const key = (run: T) => {
    const done = ms(run.completed_at)
    return Number.isNaN(done) ? ms(run.scheduled_for) : done
  }
  for (const run of runs) {
    if (!isTerminal(run.state) || run.state === "canceled") continue
    if (!best || key(run) > key(best)) best = run
  }
  return best
}

/** True while the account has never had a call placed or attempted. */
export function isFirstRun(runs: readonly RunRow[]): boolean {
  return !runs.some((run) => isLive(run.state) || (isTerminal(run.state) && run.state !== "canceled"))
}

/**
 * Why the dispatcher would refuse a call, or null when it would place one.
 * It mirrors dispatchOne in supabase/functions/_shared/calle.ts, in the same order.
 * A confirmed number comes first, then a live outbound_calls consent, then the run's own slot.
 * Pass no run for a slot fallback, because that time comes from an existing slot.
 */
export function callBlock(
  profile: DispatchProfile | null,
  consents: readonly ConsentRow[],
  run: Pick<RunRow, "slot_id"> | null,
  slots: readonly SlotRow[],
): CallBlock | null {
  if (!profile?.phone_e164 || !profile.phone_confirmed_at) {
    return {
      reason: "phone",
      title: "No confirmed number",
      detail: "Orma has no confirmed phone number for you, so no call will ring. Confirm your number in Settings.",
    }
  }
  if (!consents.some((row) => row.kind === "outbound_calls" && row.revoked_at === null)) {
    return {
      reason: "consent",
      title: "Calls are off",
      detail: "You have not given Orma permission to call you, so no call will ring. Turn calls on in Settings.",
    }
  }
  if (run && (!run.slot_id || !slots.some((slot) => slot.id === run.slot_id))) {
    return {
      reason: "slot",
      title: "No call time",
      detail: "This call has lost the call time it came from, so Orma will not place it. Choose a time in Settings.",
    }
  }
  return null
}

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** ISO weekday, 1 is Monday and 7 is Sunday. */
  weekday: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const WEEKDAY_INDEX: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
    formatters.set(timeZone, fmt)
  }
  return fmt
}

/** Wall-clock parts of an instant in a named zone. The process zone plays no part. */
export function zonedParts(instant: Date | string, timeZone: string): ZonedParts {
  const date = typeof instant === "string" ? new Date(instant) : instant
  const out: Record<string, string> = {}
  for (const part of formatterFor(timeZone).formatToParts(date)) out[part.type] = part.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAY_INDEX[out.weekday] ?? 0,
  }
}

function dayNumber(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

function localDay(instant: Date | string, timeZone: string): number {
  const p = zonedParts(instant, timeZone)
  return dayNumber(p.year, p.month, p.day)
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export function formatClock(instant: Date | string, timeZone: string, withSeconds = false): string {
  const p = zonedParts(instant, timeZone)
  return withSeconds ? `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` : `${pad(p.hour)}:${pad(p.minute)}`
}

/** "Monday 14 September", in the profile's zone. */
export function formatDayLabel(instant: Date | string, timeZone: string): string {
  const p = zonedParts(instant, timeZone)
  return `${WEEKDAY_NAMES[p.weekday - 1]} ${p.day} ${MONTH_NAMES[p.month - 1]}`
}

/** Whole local days from now to the instant, both read in the profile's zone. */
export function daysFromNow(instant: Date | string, timeZone: string, now: Date): number {
  return localDay(instant, timeZone) - localDay(now, timeZone)
}

/** "Today, 08:00", "Tomorrow, 08:00", "Wednesday, 08:00" or "Wednesday 23 September, 08:00". */
export function formatNextCall(instant: Date | string, timeZone: string, now: Date): string {
  const diff = daysFromNow(instant, timeZone, now)
  const clock = formatClock(instant, timeZone)
  if (diff === 0) return `Today, ${clock}`
  if (diff === 1) return `Tomorrow, ${clock}`
  const p = zonedParts(instant, timeZone)
  if (diff > 1 && diff < 7) return `${WEEKDAY_NAMES[p.weekday - 1]}, ${clock}`
  return `${formatDayLabel(instant, timeZone)}, ${clock}`
}

/** "Today at 08:00", "Yesterday at 08:00" or "Saturday 12 September at 08:00". */
export function formatWhen(instant: Date | string, timeZone: string, now: Date): string {
  const diff = daysFromNow(instant, timeZone, now)
  const clock = formatClock(instant, timeZone)
  if (diff === 0) return `Today at ${clock}`
  if (diff === -1) return `Yesterday at ${clock}`
  if (diff === 1) return `Tomorrow at ${clock}`
  return `${formatDayLabel(instant, timeZone)} at ${clock}`
}

/** The instant a wall-clock time in a named zone refers to. */
export function zonedTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute)
  let guess = wanted
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), timeZone)
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const next = guess + (wanted - seen)
    if (next === guess) break
    guess = next
  }
  return new Date(guess)
}

/** The next time an active slot would ring, for an account with no materialised run yet. */
export function nextSlotInstant(slots: readonly SlotRow[], timeZone: string, now: Date): Date | null {
  const today = zonedParts(now, timeZone)
  let best: Date | null = null
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + offset))
    const isoWeekday = ((date.getUTCDay() + 6) % 7) + 1
    for (const slot of slots) {
      if (!slot.active || !slot.weekdays.includes(isoWeekday)) continue
      const [h, m] = slot.local_time.split(":").map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) continue
      const at = zonedTimeToInstant(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), h, m, timeZone)
      if (at.getTime() <= now.getTime()) continue
      if (!best || at.getTime() < best.getTime()) best = at
    }
    if (best) return best
  }
  return best
}

/** One count per item, and each count is the number of mention rows given for that item. */
export function mentionCounts(mentions: readonly MentionRow[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of mentions) counts.set(row.item_id, (counts.get(row.item_id) ?? 0) + 1)
  return counts
}

/** Days an item has been open. A user-stated since_date wins over created_at. */
export function itemAgeDays(item: Pick<ItemRow, "since_date" | "created_at">, timeZone: string, now: Date): number {
  let start: number
  const since = item.since_date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.since_date) : null
  if (since) {
    start = dayNumber(Number(since[1]), Number(since[2]), Number(since[3]))
  } else {
    start = localDay(item.created_at, timeZone)
  }
  return Math.max(0, localDay(now, timeZone) - start)
}

export function mentionLabel(count: number): string {
  if (count === 0) return "not mentioned yet"
  return count === 1 ? "1 mention" : `${count} mentions`
}

export function ageLabel(days: number): string {
  if (days <= 0) return "added today"
  return days === 1 ? "1 day" : `${days} days`
}

export type OpenItemView = {
  id: string
  text: string
  mentions: number
  ageDays: number
  meta: string
}

/** Open items with counts from item_mentions rows, most mentioned first, then oldest. */
export function openItemsView(
  items: readonly ItemRow[],
  mentions: readonly MentionRow[],
  timeZone: string,
  now: Date,
): OpenItemView[] {
  const counts = mentionCounts(mentions)
  return items
    .filter((item) => item.status === "open")
    .map((item) => {
      const count = counts.get(item.id) ?? 0
      const ageDays = itemAgeDays(item, timeZone, now)
      return {
        id: item.id,
        text: item.text,
        mentions: count,
        ageDays,
        meta: `${mentionLabel(count)} · ${ageLabel(ageDays)}`,
      }
    })
    .sort((a, b) => b.mentions - a.mentions || b.ageDays - a.ageDays || a.text.localeCompare(b.text))
}

const SOURCE_LABELS: Record<string, string> = {
  telegram: "on Telegram",
  web: "on the web",
  mcp: "by an agent",
  call: "on a call",
}

/** "added on Telegram yesterday", for the first-run list. */
export function addedLabel(item: Pick<ItemRow, "source" | "created_at">, timeZone: string, now: Date): string {
  const days = -daysFromNow(item.created_at, timeZone, now)
  const when = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`
  const where = SOURCE_LABELS[item.source] ?? ""
  return where ? `added ${where} ${when}` : `added ${when}`
}

export function formatOffset(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ""
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}`
}

export type SummaryLine = {
  kind: "retired" | "committed" | "captured"
  label: "Retired" | "Committed" | "Captured"
  text: string
  offsetSeconds: number | null
  offset: string
}

export type LastCallSummary = {
  lines: SummaryLine[]
  mentionCount: number
  retired: number
  committed: number
  captured: number
}

/**
 * The retirements a call's own result recorded, as item@offset keys.
 * Ingest applies every retired_items entry and writes a mention at its offset in the same transaction.
 * A later retire on the web, by MCP or on Telegram writes neither, so it never appears here.
 */
export function callRetirementKeys(structured: unknown): Set<string> {
  const keys = new Set<string>()
  if (!structured || typeof structured !== "object") return keys
  const entries = (structured as Record<string, unknown>).retired_items
  if (!Array.isArray(entries)) return keys
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const offset = Number(record.evidence_offset_seconds)
    if (typeof record.item_id !== "string" || !Number.isInteger(offset)) continue
    keys.add(`${record.item_id}@${offset}`)
  }
  return keys
}

/**
 * What the last call retired, committed and captured, read from rows on that run.
 * Ingest writes one mention per commitment, so those mentions are not read twice.
 * A Retired line needs the run's own result to name the retirement. An item's later retired_at never counts.
 */
export function lastCallSummary(
  run: Pick<RunRow, "id" | "scheduled_for">,
  mentions: readonly RunMentionRow[],
  commitments: readonly CommitmentRow[],
  resultStructured: unknown,
  timeZone: string,
  now: Date,
): LastCallSummary {
  const scoped = mentions.filter((row) => row.call_run_id === run.id)
  const runCommitments = commitments.filter((row) => row.call_run_id === run.id)
  const lines: SummaryLine[] = []
  const commitmentKeys = new Set<string>()
  for (const row of runCommitments) {
    commitmentKeys.add(`${row.item_id}@${row.evidence_offset_seconds}`)
    const text = row.items?.text ?? "An item"
    const due = row.due ? `, by ${dueLabel(row.due, timeZone, now)}` : ""
    lines.push({
      kind: "committed",
      label: "Committed",
      text: `${text}${due}`,
      offsetSeconds: row.evidence_offset_seconds,
      offset: formatOffset(row.evidence_offset_seconds),
    })
  }
  const runStart = ms(run.scheduled_for)
  const pendingCommitMentions = new Set(commitmentKeys)
  const pendingRetirements = callRetirementKeys(resultStructured)
  for (const row of scoped) {
    const key = `${row.item_id}@${row.offset_seconds}`
    if (pendingCommitMentions.has(key)) {
      pendingCommitMentions.delete(key)
      continue
    }
    const item = row.items
    if (!item) continue
    if (pendingRetirements.has(key)) {
      pendingRetirements.delete(key)
      lines.push({
        kind: "retired",
        label: "Retired",
        text: item.text,
        offsetSeconds: row.offset_seconds,
        offset: formatOffset(row.offset_seconds),
      })
    } else if (item.source === "call" && ms(item.created_at) >= runStart) {
      lines.push({
        kind: "captured",
        label: "Captured",
        text: item.text,
        offsetSeconds: row.offset_seconds,
        offset: formatOffset(row.offset_seconds),
      })
    }
  }
  lines.sort((a, b) => (a.offsetSeconds ?? Infinity) - (b.offsetSeconds ?? Infinity))
  return {
    lines,
    mentionCount: scoped.length,
    retired: lines.filter((line) => line.kind === "retired").length,
    committed: lines.filter((line) => line.kind === "committed").length,
    captured: lines.filter((line) => line.kind === "captured").length,
  }
}

function dueLabel(due: string, timeZone: string, now: Date): string {
  const diff = daysFromNow(due, timeZone, now)
  const clock = formatClock(due, timeZone)
  if (diff === 0) return `today ${clock}`
  if (diff === 1) return `tomorrow ${clock}`
  return `${formatDayLabel(due, timeZone)} ${clock}`
}

/** Call length from CALL-E's own started_at and completed_at in transcripts.raw. Null when either is missing. */
export function durationSeconds(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const started = typeof record.started_at === "string" ? Date.parse(record.started_at) : Number.NaN
  const completed = typeof record.completed_at === "string" ? Date.parse(record.completed_at) : Number.NaN
  if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) return null
  return Math.round((completed - started) / 1000)
}

export function durationLabel(seconds: number | null): string {
  if (seconds === null) return ""
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const head = minutes === 1 ? "1 minute" : `${minutes} minutes`
  return rest === 0 ? head : `${head} ${rest} ${rest === 1 ? "second" : "seconds"}`
}

/** "Yesterday at 08:00, 45 seconds." The duration appears only when a row carries it. */
export function lastCallHeadline(
  run: Pick<RunRow, "scheduled_for" | "dispatched_at">,
  timeZone: string,
  now: Date,
  duration: number | null,
): string {
  const when = formatWhen(run.dispatched_at ?? run.scheduled_for, timeZone, now)
  const length = durationLabel(duration)
  return length ? `${when}, ${length}.` : `${when}.`
}

/** The spec keeps a failed extraction out of sight, so both answered dispositions read the same. */
export function dispositionLabel(disposition: string | null): string {
  switch (disposition) {
    case "answered_extracted":
    case "answered_no_result":
      return "Answered"
    case "not_answered":
      return "Not answered"
    case "canceled":
      return "Canceled"
    default:
      return ""
  }
}

export type MoodView = { label: string; none: boolean }

export function moodView(run: Pick<RunRow, "mood" | "disposition">): MoodView {
  if (run.mood) return { label: run.mood, none: false }
  if (run.disposition === "not_answered") return { label: "no call", none: true }
  return { label: "not heard", none: true }
}

export type LiveStep = {
  label: string
  at: string
  status: "done" | "now" | "todo"
}

/** The steps of a run in progress, from its own timestamps. */
export function liveSteps(run: RunRow, timeZone: string): LiveStep[] {
  const clock = (iso: string | null) => (iso ? formatClock(iso, timeZone, true) : "")
  const onCall = run.state === "awaiting_result"
  const steps: Array<{ label: string; at: string; done: boolean }> = [
    { label: "Picked up", at: clock(run.claimed_at), done: Boolean(run.claimed_at) },
    { label: "Call placed", at: clock(run.dispatched_at), done: Boolean(run.dispatched_at) && run.state !== "claimed" },
    {
      label: onCall && run.poll_after ? `On the call. Checking again at ${clock(run.poll_after)}` : "On the call",
      at: "",
      done: false,
    },
    { label: "Turning the call into rows", at: "", done: false },
    { label: "Receipt on Telegram", at: "", done: false },
  ]
  const current = steps.findIndex((step) => !step.done)
  return steps.map((step, index) => ({
    label: index === 1 && !step.done && index === current ? "Placing the call" : step.label,
    at: step.at,
    status: step.done ? "done" : index === current ? "now" : "todo",
  }))
}

export type TodaysCallView = {
  /** True when the order comes from call_runs.briefing. False means the page falls back to the open list. */
  fromBriefing: boolean
  items: OpenItemView[]
}

/**
 * Item ids in the order the briefing leads with them, read from its open_items lines.
 * Null when the run carries no briefing yet, or the briefing has no open_items text.
 */
export function briefingOrder(briefing: unknown): Array<{ id: string; text: string }> | null {
  if (!briefing || typeof briefing !== "object") return null
  const text = (briefing as Record<string, unknown>).open_items
  if (typeof text !== "string") return null
  const order: Array<{ id: string; text: string }> = []
  for (const line of text.split("\n")) {
    const match = /^- (.*) \(id: ([^()\s]+)\)$/.exec(line.trim())
    if (match) order.push({ id: match[2], text: match[1] })
  }
  return order
}

/**
 * "On today's call" for the live state, in briefing order with counts from rows.
 * Without a briefing it falls back to the open list and says so through fromBriefing.
 */
export function todaysCallView(briefing: unknown, open: readonly OpenItemView[]): TodaysCallView {
  const order = briefingOrder(briefing)
  if (order === null) return { fromBriefing: false, items: [...open] }
  const byId = new Map(open.map((item) => [item.id, item]))
  return {
    fromBriefing: true,
    items: order.map(
      (entry) => byId.get(entry.id) ?? { id: entry.id, text: entry.text, mentions: 0, ageDays: 0, meta: "no longer open" },
    ),
  }
}
