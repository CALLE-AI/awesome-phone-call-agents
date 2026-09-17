/**
 * The console's notification feed: the thing that starts the flow.
 *
 * Two sources, one list.
 *
 *   * **HTTP** — `GET /api/notifications` is the authority. It derives every ping from the event
 *     log and, crucially, is the only place that knows what has been *read* (see
 *     `app/api/notifications.py::_mark`).
 *   * **SSE** — the backend taps the event bus and republishes each derived ping as a
 *     `notification` event on the hazard stream. That is what makes a toast appear without a poll.
 *
 * This hook does not open a connection of its own. `HazardLayout` owns exactly one SSE connection
 * for the hazard and every event it has seen is already sitting in `stream.events`; a second
 * EventSource would replay the hazard's whole history a second time and double every ping. So the
 * live path here is a *scan* of an array somebody else is already filling.
 *
 * **Read is a one-way latch, and that is load-bearing.** The pushed payload is built by `_note()`,
 * which hardcodes `read: false` because a freshly derived ping has by definition not been seen. The
 * same notification id therefore arrives repeatedly — once from the feed carrying its true read
 * state, and again from the stream carrying `false` on every reconnect replay. If the push were
 * allowed to win the merge, a ping somebody dismissed at nine o'clock would go unread again the
 * next time the laptop's wifi blinked, the badge would climb on its own, and the toast would come
 * back. So: a merge may set `read` true, never false.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../api'
import type { AgentEvent } from '../types'

// ---------------------------------------------------------------------------
// Wire shape — mirrors app/api/notifications.py::_note
// ---------------------------------------------------------------------------

/** Severity is what the UI colours by. Derived server-side from `priority`, never recomputed here. */
export type NotificationSeverity = 'critical' | 'warning' | 'info'

/**
 * The kinds the backend emits. Left open (`| string`) on purpose: a new derivation on the server
 * should show up in the console as an ordinary ping rather than crash it.
 */
export type NotificationKind =
  | 'hazard.declared'
  | 'case.flagged'
  | 'call.finished'
  | 'deployment.opened'
  | 'deployment.awaiting_authorisation'
  | 'asset.arrived'
  | (string & {})

export interface Notification {
  /** `ntf_<event_id>[_<neighbour_id>]`. Stable across GET, replay and push — safe to dedupe on. */
  id: string
  event_id: number
  kind: NotificationKind
  severity: NotificationSeverity
  /** 1 (life safety) to 5. Maps directly onto the p1..p5 tokens. */
  priority: number
  /** The backend's words. Rendered verbatim — see the note on `AWAITING_HUMAN_KINDS`. */
  headline: string
  detail: string
  hazard_id: string
  sweep_id: string | null
  neighbour_id: string | null
  incident_id: string | null
  call_id: string | null
  at: string
  read: boolean
  /** Where clicking lands, as a console path. Chosen by the backend; the UI never rewrites it. */
  route: string
}

interface FeedResponse {
  hazard_id: string
  notifications: Notification[]
  unread: number
  returned: number
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Pings that mean a person is being waited on. These never auto-dismiss.
 *
 * Keyed on `kind` and not on severity, deliberately. `dispatch.awaiting_authorisation` inherits the
 * *incident's* priority, so a priority-3 approval request derives `severity: "warning"` — and a
 * severity rule would quietly time out the one notification in the product that must not disappear
 * on its own, the prepared agency unit nobody has approved.
 */
export const AWAITING_HUMAN_KINDS: ReadonlySet<string> = new Set([
  'deployment.awaiting_authorisation',
  'deployment.opened',
])

export function awaitsHuman(n: Notification): boolean {
  return AWAITING_HUMAN_KINDS.has(n.kind)
}

/** A toast that stays until somebody deals with it. Life-safety pings included. */
export function isSticky(n: Notification): boolean {
  return awaitsHuman(n) || n.severity === 'critical'
}

/**
 * Two or three words for what kind of thing this is, above the headline.
 *
 * The headline itself is always the backend's sentence, rendered verbatim: the wording of
 * `deployment.awaiting_authorisation` — "prepared … Nobody has been asked and nothing has been
 * sent" — is a safety property of the product, not copy, and the console does not paraphrase it.
 * This is only the category above it.
 */
const KIND_LABEL: Record<string, string> = {
  'hazard.declared': 'Hazard',
  'case.flagged': 'Risk flagged',
  'call.finished': 'Call finished',
  'deployment.opened': 'Deployment case',
  'deployment.awaiting_authorisation': 'Awaiting approval',
  'asset.arrived': 'Arrived',
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/[._]/g, ' ')
}

/**
 * How long a routine toast stays on screen. Long enough to read a name and a sentence.
 *
 * The timer runs inside the toast that owns it (see `Toast.tsx`) rather than here. A single effect
 * over the whole stack would tear down and rebuild every timer each time one arrived or left, so a
 * steady trickle of pings would keep resetting the clock on the ones already up and none of them
 * would ever leave.
 */
export const TOAST_MS = 9_000

/**
 * How fresh a pushed ping has to be to interrupt somebody.
 *
 * The stream replays a hazard's whole history on every connect, so without an age gate every
 * reconnection would fire a toast for each notification of the evening. Anything older than this
 * is history: it belongs in the centre, not on top of the screen.
 */
const TOAST_MAX_AGE_MS = 60_000

/** Toasts visible at once. Beyond this they are counted, not stacked — a wall of cards is noise. */
export const MAX_TOASTS = 4

/** Page size for the feed. The badge is counted server-side over a wider window regardless. */
const FEED_LIMIT = 60

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

function parseAt(at: string): number {
  // The backend appends "Z"; a bare ISO string would be read as local time by the browser and could
  // land an hour in the future, which would make every ping look fresh. Belt and braces.
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(at) ? at : `${at}Z`
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function byNewest(a: Notification, b: Notification): number {
  if (b.event_id !== a.event_id) return b.event_id - a.event_id
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Fold new notifications into the list.
 *
 * Returns the merged list and the ids that were genuinely new, so the caller can decide what earned
 * a toast without diffing the array itself.
 */
function merge(
  current: Notification[],
  incoming: Notification[],
): { items: Notification[]; added: Notification[] } {
  if (incoming.length === 0) return { items: current, added: [] }
  const byId = new Map(current.map((n) => [n.id, n]))
  const added: Notification[] = []
  for (const next of incoming) {
    const prev = byId.get(next.id)
    if (!prev) {
      byId.set(next.id, next)
      added.push(next)
      continue
    }
    // The latch. See the module docstring: only a feed response can mark something read, and
    // nothing can mark it unread again.
    byId.set(next.id, { ...next, read: prev.read || next.read })
  }
  return { items: [...byId.values()].sort(byNewest), added }
}

function isNotification(value: unknown): value is Notification {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'string' && typeof v.headline === 'string' && typeof v.route === 'string'
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

export interface NotificationFeed {
  /** Newest first. Read and unread together; the centre groups them. */
  notifications: Notification[]
  /** The badge. Server-counted over a fixed window so it means the same thing on every screen. */
  unread: number
  loading: boolean
  error: string | null
  /** Currently on screen, newest last. Never longer than the stack renders. */
  toasts: Notification[]
  /** Take a toast off the screen. Does NOT mark it read — it stays in the centre. */
  dismissToast: (id: string) => void
  /** How many toasts are queued behind the visible ones. */
  overflow: number
  markRead: (ids: string[]) => Promise<void>
  markAllRead: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * @param hazardId  the hazard being watched. Changing it clears everything.
 * @param events    `stream.events` from the layout's single SSE connection.
 * @param readBy    who is on shift. Recorded on the read receipt, so the audit trail says who
 *                  stopped looking.
 */
export function useNotifications(
  hazardId: string | undefined,
  events: AgentEvent[],
  readBy = '',
): NotificationFeed {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toastIds, setToastIds] = useState<string[]>([])

  const hazardRef = useRef(hazardId)
  hazardRef.current = hazardId
  const readByRef = useRef(readBy)
  readByRef.current = readBy

  /**
   * Every notification id this hook has ever put in the list, for this hazard.
   *
   * A ref rather than a derivation from `items`, because "is this new" has to be answered *outside*
   * a state updater. React re-invokes updaters (StrictMode does it deliberately), so queueing a
   * toast from inside one would show the same ping twice and count it twice.
   */
  const knownIdsRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    const id = hazardRef.current
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/notifications?hazard_id=${encodeURIComponent(id)}&limit=${FEED_LIMIT}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) throw new Error(`notifications: ${res.status}`)
      const data = (await res.json()) as FeedResponse
      // The hazard changed while this was in flight. Its pings are about a different block.
      if (hazardRef.current !== id) return
      for (const n of data.notifications ?? []) knownIdsRef.current.add(n.id)
      setItems((prev) => merge(prev, data.notifications ?? []).items)
      setUnread(Number(data.unread ?? 0))
      setError(null)
    } catch (err) {
      if (hazardRef.current !== id) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  // Hazard change: nothing carries over. A ping about Rosa on the heat sweep must not sit under a
  // power-cut headline for the half second before the fetch lands.
  useEffect(() => {
    setItems([])
    setUnread(0)
    setToastIds([])
    setError(null)
    knownIdsRef.current = new Set()
    if (hazardId) void refresh()
  }, [hazardId, refresh])

  // -------------------------------------------------------------------------
  // The live path: scan what the layout's stream has already collected.
  // -------------------------------------------------------------------------
  const cursorRef = useRef(0)
  useEffect(() => {
    // `useEventStream` resets its array on a hazard change or a reconnect that starts from zero.
    // A shorter array than last time means "start again", not "events vanished".
    if (events.length < cursorRef.current) cursorRef.current = 0
    if (events.length === cursorRef.current) return
    const fresh = events.slice(cursorRef.current)
    cursorRef.current = events.length

    const pushed: Notification[] = []
    let sawReceipt = false
    for (const ev of fresh) {
      if (ev.type === 'notification') {
        if (isNotification(ev.payload)) pushed.push(ev.payload)
      } else if (ev.type === 'notification.read') {
        // Somebody cleared the feed — possibly on another device. The receipt says nothing about
        // *which* derived ids it covers (a watermark can cover pings not yet derived here), so the
        // only honest response is to re-ask the endpoint that owns read state.
        sawReceipt = true
      }
    }

    if (pushed.length) {
      const now = Date.now()
      const added = pushed.filter((n) => !knownIdsRef.current.has(n.id))
      for (const n of pushed) knownIdsRef.current.add(n.id)
      setItems((prev) => merge(prev, pushed).items)

      // A ping earns the top of the screen only if it is new to us, nobody has read it, and it
      // actually just happened. The last clause is what stops a reconnect's history replay from
      // firing a toast for every notification of the evening.
      const interrupting = added.filter((n) => !n.read && now - parseAt(n.at) < TOAST_MAX_AGE_MS)
      if (interrupting.length) {
        setToastIds((ids) => [...ids, ...interrupting.map((n) => n.id)])
        // Optimistic: the badge moves the instant the toast slides in. The next refresh reconciles
        // it against the server's fixed window.
        setUnread((u) => u + interrupting.length)
      }
    }
    if (sawReceipt) void refresh()
  }, [events, refresh])

  // -------------------------------------------------------------------------
  // Toasts
  // -------------------------------------------------------------------------
  const dismissToast = useCallback((id: string) => {
    setToastIds((ids) => ids.filter((x) => x !== id))
  }, [])

  const toastQueue = useMemo(() => {
    const byId = new Map(items.map((n) => [n.id, n]))
    return toastIds.map((id) => byId.get(id)).filter((n): n is Notification => !!n)
  }, [toastIds, items])

  /**
   * Which toasts get the screen when more have arrived than fit.
   *
   * Not simply the newest four. Anything sticky — an approval nobody has given, a life-safety
   * outcome — takes a slot ahead of routine pings, because the visible stack is what somebody
   * actually reacts to and burying a prepared agency request under three arrival notices is the
   * same failure as timing it out, just slower. Routine pings overflow into the counter, and the
   * ones that do keep their place in the centre either way.
   */
  const toasts = useMemo(() => {
    if (toastQueue.length <= MAX_TOASTS) return toastQueue
    const sticky = toastQueue.filter(isSticky).slice(-MAX_TOASTS)
    const room = MAX_TOASTS - sticky.length
    const routine = room > 0 ? toastQueue.filter((n) => !isSticky(n)).slice(-room) : []
    const keep = new Set([...sticky, ...routine].map((n) => n.id))
    // Filtered back out of the queue so arrival order — and therefore stack position — survives.
    return toastQueue.filter((n) => keep.has(n.id))
  }, [toastQueue])

  const overflow = Math.max(0, toastQueue.length - toasts.length)

  // -------------------------------------------------------------------------
  // Read state
  // -------------------------------------------------------------------------
  const post = useCallback(async (body: Record<string, unknown>) => {
    const id = hazardRef.current
    if (!id) return
    try {
      const res = await fetch(`${API_BASE}/api/notifications/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ hazard_id: id, read_by: readByRef.current, ...body }),
      })
      if (!res.ok) throw new Error(`mark read: ${res.status}`)
      const data = (await res.json()) as FeedResponse
      if (hazardRef.current !== id) return
      setItems((prev) => merge(prev, data.notifications ?? []).items)
      setUnread(Number(data.unread ?? 0))
    } catch (err) {
      if (hazardRef.current !== id) return
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const markRead = useCallback(
    async (ids: string[]) => {
      const wanted = new Set(ids)
      if (!wanted.size) return
      // The badge drops by however many of these were actually unread — clicking a row somebody
      // already read must not take a number off the count. Counted from `items` rather than inside
      // the updater: React re-invokes updaters, and a decrement in there would run twice.
      const newlyRead = items.filter((n) => wanted.has(n.id) && !n.read).length
      // Optimistic, and the latch means the server's answer can only agree with it.
      setItems((prev) => prev.map((n) => (wanted.has(n.id) && !n.read ? { ...n, read: true } : n)))
      if (newlyRead) setUnread((u) => Math.max(0, u - newlyRead))
      await post({ ids })
    },
    [items, post],
  )

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })))
    setUnread(0)
    setToastIds([])
    await post({ all: true })
  }, [post])

  return {
    notifications: items,
    unread,
    loading,
    error,
    toasts,
    dismissToast,
    overflow,
    markRead,
    markAllRead,
    refresh,
  }
}
