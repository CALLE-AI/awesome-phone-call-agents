import { useCallback, useEffect, useReducer, useRef } from 'react'
import { api } from '../api'
import { consumeSse } from '../sse'
import type {
  AgentEvent,
  CallCompletedPayload,
  CallStartedPayload,
  CallView,
  CheckDecidedPayload,
  LatLon,
  ProviderEventPayload,
  StreamState,
  SweepState,
  TranscriptTurn,
  TriagedPayload,
  UnaccountedRow,
} from '../types'

// ---------------------------------------------------------------------------
// State + reducer
//
// The topic is the hazard, not the sweep — see app/events/bus.py. One connection carries triage,
// every call, the ladder, and a second sweep of the same block if the captain runs one.
// ---------------------------------------------------------------------------

export const initialStreamState: StreamState = {
  sweepId: null,
  sweepState: null,
  sweepStateExtra: null,
  provider: null,
  hazardStatus: null,
  events: [],
  triage: {},
  queued: 0,
  callIndex: null,
  calls: {},
  callOrder: [],
  activeCallId: null,
  decisions: {},
  skipped: {},
  unaccounted: null,
  liveEscalations: {},
  livePackets: {},
  providerError: null,
  sweepError: null,
  assetPositions: {},
  routes: {},
  noAssetFor: {},
  lastEventId: 0,
  connection: 'connecting',
  error: null,
}

type Action =
  | { type: 'event'; event: AgentEvent }
  | { type: 'events'; events: AgentEvent[] }
  | { type: 'connection'; connection: StreamState['connection'] }
  | { type: 'error'; error: string | null }
  | { type: 'reset' }

const TERMINAL_PHASES = new Set(['completed', 'no_answer', 'failed', 'skipped'])

function newCallView(p: CallStartedPayload, created_at: string): CallView {
  return {
    call_id: p.call_id,
    neighbour_id: p.neighbour_id,
    callee: p.callee ?? 'neighbour',
    to_name: p.name,
    phone_masked: p.phone_masked,
    provider: p.provider,
    started_at: created_at,
    phase: 'queued',
    providerStatus: null,
    provider_call_id: null,
    liveTurns: [],
    transcript: null,
    status: null,
    structured_result: null,
    validation_errors: [],
    summary: null,
    duration_s: null,
    completed_at: null,
    failure_code: null,
    failure_message: null,
    task_completed: null,
    completion_confidence: null,
    evidence: [],
    reconcile: null,
    decision: null,
    contract: p.contract ?? null,
    risk: p.risk ?? null,
  }
}

function patchCall(state: StreamState, callId: string, patch: (c: CallView) => CallView): StreamState {
  const existing = state.calls[callId]
  if (!existing) return state
  return { ...state, calls: { ...state.calls, [callId]: patch(existing) } }
}

function asTurn(details: Record<string, unknown> | null | undefined): TranscriptTurn | null {
  if (!details || typeof details !== 'object') return null
  const text = details.text
  if (typeof text !== 'string' || !text) return null
  const speaker = typeof details.speaker === 'string' ? details.speaker : 'unknown'
  const offset = typeof details.offset_seconds === 'number' ? details.offset_seconds : null
  return { speaker, text, offset_seconds: offset }
}

export function applyEvent(prev: StreamState, ev: AgentEvent): StreamState {
  if (ev.type === 'ping') return prev
  if (typeof ev.id === 'number' && ev.id <= prev.lastEventId) return prev // duplicate / replayed

  let state: StreamState = {
    ...prev,
    events: [...prev.events, ev],
    lastEventId: typeof ev.id === 'number' ? Math.max(prev.lastEventId, ev.id) : prev.lastEventId,
  }
  const p = (ev.payload ?? {}) as Record<string, unknown>

  if (ev.type.startsWith('provider.')) {
    const pp = p as unknown as ProviderEventPayload
    if (!pp.call_id) return state
    const sub = ev.type.slice('provider.'.length) // call.transcript_turn, call.status.in_progress, …
    const turn = asTurn(pp.details)
    return patchCall(state, pp.call_id, (c) => {
      let phase = c.phase
      if (!TERMINAL_PHASES.has(c.phase)) {
        const st = String(pp.status ?? '').toLowerCase()
        if (sub.endsWith('no_answer') || st === 'no_answer') phase = 'no_answer'
        else if (sub.endsWith('dialing') || sub.endsWith('ringing')) phase = 'dialing'
        else if (sub.endsWith('in_progress') || st === 'in_progress' || turn) phase = 'in_progress'
        else if (sub.endsWith('completed') || st === 'completed') phase = 'evaluating'
        else if (sub.endsWith('queued') || sub.endsWith('created') || st === 'queued') phase = 'queued'
        else if (st === 'failed') phase = 'failed'
      }
      return {
        ...c,
        phase,
        providerStatus: pp.status ?? c.providerStatus,
        provider_call_id: pp.provider_call_id ?? c.provider_call_id,
        liveTurns: turn ? [...c.liveTurns, turn] : c.liveTurns,
      }
    })
  }

  switch (ev.type) {
    case 'hazard.declared':
      return state

    case 'hazard.status': {
      if (typeof p.status === 'string') state.hazardStatus = p.status as StreamState['hazardStatus']
      return state
    }

    case 'sweep.created': {
      // A second sweep over the same hazard starts from a clean board rather than inheriting the
      // first one's calls. Triage and outcomes are re-derived; nothing is carried across.
      //
      // Except the fleet. A van halfway to Rosa's house does not teleport back to base because a
      // second sweep started — assets and their routes belong to the hazard, not to one sweep, and
      // clearing them here would blank the map for the whole of the next sweep's triage.
      return {
        ...initialStreamState,
        events: state.events,
        lastEventId: state.lastEventId,
        connection: state.connection,
        error: state.error,
        hazardStatus: state.hazardStatus,
        assetPositions: state.assetPositions,
        routes: state.routes,
        sweepId: ev.sweep_id,
        sweepState: 'CREATED',
        provider: typeof p.provider === 'string' ? p.provider : null,
      }
    }

    case 'sweep.state': {
      if (typeof p.to === 'string') state.sweepState = p.to as SweepState
      state.sweepStateExtra = p
      if (ev.sweep_id) state.sweepId = ev.sweep_id
      if (typeof p.index === 'number') state.callIndex = p.index
      if (typeof p.error === 'string') state.sweepError = p.error
      return state
    }

    case 'sweep.resumed': {
      if (typeof p.state === 'string') state.sweepState = p.state as SweepState
      if (ev.sweep_id) state.sweepId = ev.sweep_id
      return state
    }

    case 'sweep.triaged': {
      const tp = p as unknown as TriagedPayload
      const triage: StreamState['triage'] = {}
      for (const row of tp.order ?? []) triage[row.neighbour_id] = row
      state.triage = triage
      state.queued = typeof tp.queued === 'number' ? tp.queued : 0
      state.callIndex = 0
      return state
    }

    case 'neighbour.skipped': {
      // Not dialled at all — consent, most often. Distinct from UNREACHABLE and it must stay so.
      const id = String(p.neighbour_id ?? '')
      if (!id) return state
      state.skipped = { ...state.skipped, [id]: String(p.reason ?? 'not called') }
      return state
    }

    case 'sweep.advanced': {
      if (typeof p.next_index === 'number') state.callIndex = p.next_index
      return state
    }

    case 'sweep.unaccounted': {
      state.unaccounted = Array.isArray(p.people) ? (p.people as UnaccountedRow[]) : []
      return state
    }

    case 'sweep.provider_error': {
      state.providerError = {
        code: typeof p.code === 'string' ? p.code : undefined,
        message: typeof p.message === 'string' ? p.message : undefined,
        call_id: typeof p.call_id === 'string' ? p.call_id : undefined,
      }
      if (typeof p.call_id === 'string') {
        state = patchCall(state, p.call_id, (c) => ({
          ...c,
          phase: 'failed',
          status: 'FAILED',
          failure_code: state.providerError?.code ?? null,
          failure_message: state.providerError?.message ?? null,
          completed_at: ev.created_at,
        }))
      }
      return state
    }

    case 'call.started': {
      const cp = p as unknown as CallStartedPayload
      const view = newCallView(cp, ev.created_at)
      state.calls = { ...state.calls, [cp.call_id]: view }
      state.callOrder = state.callOrder.includes(cp.call_id) ? state.callOrder : [...state.callOrder, cp.call_id]
      state.activeCallId = cp.call_id
      return state
    }

    case 'call.resuming': {
      const cid = typeof p.call_id === 'string' ? p.call_id : null
      if (cid && state.calls[cid]) state.activeCallId = cid
      return state
    }

    case 'call.skipped': {
      // An operator gate stopped the dial (allowlist / budget). The phone never rang, so this is
      // never an outcome — it lands in `skipped` and the sweep's unaccounted list picks it up.
      const id = String(p.neighbour_id ?? '')
      if (!id) return state
      state.skipped = { ...state.skipped, [id]: String(p.reason ?? 'not dialled') }
      return state
    }

    case 'call.failed': {
      const cid = typeof p.call_id === 'string' ? p.call_id : null
      if (!cid) return state
      return patchCall(state, cid, (c) => ({
        ...c,
        phase: 'failed',
        status: 'FAILED',
        failure_code: typeof p.code === 'string' ? p.code : null,
        failure_message: typeof p.message === 'string' ? p.message : null,
        completed_at: ev.created_at,
      }))
    }

    case 'call.completed': {
      const cp = p as unknown as CallCompletedPayload
      const status = String(cp.status ?? 'COMPLETED')
      const phase: CallView['phase'] = status === 'NO_ANSWER' ? 'no_answer' : status === 'FAILED' ? 'failed' : 'completed'
      return patchCall(state, cp.call_id, (c) => ({
        ...c,
        phase,
        status,
        structured_result: cp.structured_result ?? null,
        validation_errors: Array.isArray(cp.validation_errors) ? cp.validation_errors : [],
        summary: cp.summary ?? null,
        duration_s: typeof cp.duration_s === 'number' ? cp.duration_s : null,
        transcript: Array.isArray(cp.transcript) ? cp.transcript : c.liveTurns,
        completed_at: ev.created_at,
        failure_code: cp.failure_code ?? null,
        failure_message: cp.failure_message ?? null,
        task_completed: cp.task_completed ?? null,
        completion_confidence: cp.completion_confidence ?? null,
        evidence: Array.isArray(cp.evidence) ? cp.evidence : [],
      }))
    }

    case 'reconcile.started': {
      const cid = String(p.call_id ?? '')
      return patchCall(state, cid, (c) => ({
        ...c,
        reconcile: { fields: (p.fields as string[]) ?? [], reconciler: p.reconciler as string | undefined },
      }))
    }

    case 'reconcile.finished': {
      const cid = String(p.call_id ?? '')
      return patchCall(state, cid, (c) => ({
        ...c,
        structured_result: (p.structured_result as CallView['structured_result']) ?? c.structured_result,
        validation_errors: Array.isArray(p.validation_errors) ? (p.validation_errors as string[]) : c.validation_errors,
        reconcile: { ...(c.reconcile ?? { fields: [] }), patched: (p.patched_fields as string[]) ?? [] },
      }))
    }

    case 'reconcile.skipped': {
      const cid = String(p.call_id ?? '')
      return patchCall(state, cid, (c) => ({
        ...c,
        reconcile: { fields: (p.fields as string[]) ?? [], skipped: String(p.reason ?? 'skipped') },
      }))
    }

    case 'check.decided': {
      const dp = p as unknown as CheckDecidedPayload
      state = patchCall(state, dp.call_id, (c) => ({ ...c, decision: dp }))
      // Only the neighbour's own call decides their outcome. The runner never routes a contact call
      // through decide(), so nothing else can land here — but keying by neighbour_id without the
      // guard would be a silent trap the first time that changes.
      const call = state.calls[dp.call_id]
      if (call && call.callee !== 'neighbour') return state
      state.decisions = { ...state.decisions, [dp.neighbour_id]: dp }
      return state
    }

    case 'escalation.opened': {
      const id = String(p.escalation_id ?? '')
      if (!id) return state
      state.liveEscalations = {
        ...state.liveEscalations,
        [id]: {
          escalation_id: id,
          neighbour_id: String(p.neighbour_id ?? ''),
          name: String(p.name ?? ''),
          level: p.level as StreamState['liveEscalations'][string]['level'],
          outcome: p.outcome as StreamState['liveEscalations'][string]['outcome'],
        },
      }
      return state
    }

    case 'escalation.notified':
    case 'escalation.rung':
    case 'escalation.exists':
    case 'escalation.resolved':
      return state

    case 'handoff.prepared': {
      const id = String(p.packet_id ?? '')
      if (!id) return state
      state.livePackets = {
        ...state.livePackets,
        [id]: {
          packet_id: id,
          neighbour_id: String(p.neighbour_id ?? ''),
          name: String(p.name ?? ''),
          recommended_action: String(p.recommended_action ?? ''),
        },
      }
      return state
    }

    // -----------------------------------------------------------------------
    // The operator layer.
    //
    // `asset.moved` is the only high-frequency event on this stream (one per moving unit every two
    // seconds) and it is deliberately the only one NOT in REFETCH_ON: it updates the map straight
    // out of the reducer and never triggers a round of REST fetches.
    // -----------------------------------------------------------------------
    case 'asset.moved':
    case 'asset.arrived': {
      const assetId = String(p.asset_id ?? '')
      if (!assetId || typeof p.lat !== 'number' || typeof p.lon !== 'number') return state
      const arrived = ev.type === 'asset.arrived' || p.arrived === true
      const dispatchId = typeof p.dispatch_id === 'string' ? p.dispatch_id : null
      state.assetPositions = {
        ...state.assetPositions,
        [assetId]: {
          lat: p.lat,
          lon: p.lon,
          heading_deg: typeof p.heading_deg === 'number' ? p.heading_deg : 0,
          progress: typeof p.progress === 'number' ? p.progress : null,
          remaining_miles: typeof p.remaining_miles === 'number' ? p.remaining_miles : null,
          eta_minutes: typeof p.eta_minutes === 'number' ? p.eta_minutes : null,
          arrived,
          dispatch_id: dispatchId,
          incident_id: typeof p.incident_id === 'string' ? p.incident_id : null,
          received_at: Date.now(),
        },
      }
      // Arrival ends the journey. Dropping the polyline is what makes a finished run stop being
      // drawn as if somebody were still on it.
      if (arrived && dispatchId && state.routes[dispatchId]) {
        const { [dispatchId]: _done, ...rest } = state.routes
        state.routes = rest
      }
      return state
    }

    case 'incident.opened': {
      // The address itself arrives over REST (REFETCH_ON); this only clears any stale "nothing
      // could be sent" note so a re-opened incident does not inherit the last pass's excuse.
      const id = String(p.incident_id ?? '')
      if (id && state.noAssetFor[id]) {
        const { [id]: _gone, ...rest } = state.noAssetFor
        state.noAssetFor = rest
      }
      return state
    }

    case 'dispatch.none_available': {
      const id = String(p.incident_id ?? '')
      if (!id) return state
      // `note` is the sentence the dispatcher writes for this case; `error` is set only when the
      // incident itself made the question unanswerable (no coordinates, say). Field names taken
      // from the publish site in app/orchestrator/dispatch.py, not guessed.
      const why = String(p.note ?? '') || String(p.error ?? '') || 'no unit could be sent'
      state.noAssetFor = { ...state.noAssetFor, [id]: why }
      return state
    }

    case 'dispatch.proposed':
    case 'dispatch.awaiting_authorisation':
    case 'dispatch.committed':
    case 'dispatch.authorised':
    case 'dispatch.en_route':
    case 'dispatch.declined':
    case 'dispatch.completed': {
      const dispatchId = String(p.id ?? p.dispatch_id ?? '')
      const incidentId = String(p.incident_id ?? '')
      if (incidentId && state.noAssetFor[incidentId]) {
        const { [incidentId]: _gone, ...rest } = state.noAssetFor
        state.noAssetFor = rest
      }
      if (!dispatchId) return state
      const finished = ev.type === 'dispatch.completed' || ev.type === 'dispatch.declined'
      if (finished) {
        if (!state.routes[dispatchId]) return state
        const { [dispatchId]: _done, ...rest } = state.routes
        state.routes = rest
        return state
      }
      // The polyline only ever reaches the browser on a dispatch payload — the movement events
      // carry a position and nothing else — so it is captured here and held until the unit arrives.
      const route = Array.isArray(p.route) ? (p.route as LatLon[]) : []
      if (route.length < 2) return state
      state.routes = {
        ...state.routes,
        [dispatchId]: {
          dispatch_id: dispatchId,
          asset_id: String(p.asset_id ?? ''),
          call_sign: String(p.call_sign ?? ''),
          incident_id: incidentId,
          route,
          requires_authorisation: p.requires_authorisation === true,
          status: String(p.status ?? ''),
        },
      }
      return state
    }

    default:
      return state
  }
}

function reducer(state: StreamState, action: Action): StreamState {
  switch (action.type) {
    case 'reset':
      return initialStreamState
    case 'event':
      return applyEvent(state, action.event)
    case 'events':
      return action.events.reduce(applyEvent, state)
    case 'connection':
      return state.connection === action.connection ? state : { ...state, connection: action.connection }
    case 'error':
      return { ...state, error: action.error }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const RECONNECT_MS = 1000

/** Events after which the REST board is stale and worth refetching. */
const REFETCH_ON = new Set([
  'sweep.triaged',
  'check.decided',
  'sweep.state',
  'sweep.unaccounted',
  'escalation.opened',
  'escalation.notified',
  'escalation.rung',
  'escalation.resolved',
  'handoff.prepared',
  'handoff.released',
  'hazard.status',
  // The operator layer. `asset.moved` is deliberately absent: it fires every two seconds per
  // moving unit and the reducer already has everything it changes. `asset.arrived` is present
  // because arrival flips server-side state — the asset to ON_SCENE, the incident to ON_SCENE —
  // that only the REST payloads can tell us about.
  'incident.opened',
  'dispatch.proposed',
  'dispatch.awaiting_authorisation',
  'dispatch.committed',
  'dispatch.authorised',
  'dispatch.declined',
  'dispatch.en_route',
  'dispatch.completed',
  'dispatch.none_available',
  'asset.arrived',
])

/**
 * Subscribe to one hazard.
 *
 * `onRefetch` is how the live stream and the REST board stay honest with each other: events drive
 * what moves on screen this second, and the endpoints — which know about sweeps that finished
 * before this browser tab existed — supply the authoritative rows. Debounced, because a sweep of
 * fourteen people emits a burst.
 */
export function useEventStream(hazardId: string | undefined, onRefetch?: () => void) {
  const [state, dispatch] = useReducer(reducer, initialStreamState)
  const lastIdRef = useRef(0)
  const refetchRef = useRef(onRefetch)
  refetchRef.current = onRefetch

  const scheduleRefetch = useCallback(() => {
    const fn = refetchRef.current
    if (fn) fn()
  }, [])

  useEffect(() => {
    if (!hazardId) return
    const ac = new AbortController()
    lastIdRef.current = 0
    dispatch({ type: 'reset' })

    let pending: ReturnType<typeof setTimeout> | null = null
    const debouncedRefetch = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        if (!ac.signal.aborted) scheduleRefetch()
      }, 250)
    }

    const run = async () => {
      // 1. Replay everything this hazard has already done, so a board opened late is not empty.
      try {
        const history = await api.history(hazardId, 0)
        if (ac.signal.aborted) return
        const sorted = [...history].sort((a, b) => a.id - b.id)
        dispatch({ type: 'events', events: sorted })
        for (const e of sorted) if (typeof e.id === 'number' && e.id > lastIdRef.current) lastIdRef.current = e.id
      } catch (err) {
        if (ac.signal.aborted) return
        dispatch({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      }

      // 2. Live, with reconnect and replay from the last id we actually saw.
      let first = true
      while (!ac.signal.aborted) {
        dispatch({ type: 'connection', connection: first ? 'connecting' : 'reconnecting' })
        first = false
        await consumeSse(api.streamUrl(hazardId, lastIdRef.current), {
          signal: ac.signal,
          onOpen: () => dispatch({ type: 'connection', connection: 'open' }),
          onMessage: (msg) => {
            if (msg.event === 'ping') return
            let ev: AgentEvent
            try {
              ev = JSON.parse(msg.data) as AgentEvent
            } catch {
              return
            }
            if (typeof ev.id !== 'number') {
              const n = Number(msg.id)
              ev.id = Number.isFinite(n) ? n : 0
            }
            if (!ev.type) ev.type = msg.event
            if (ev.id && ev.id <= lastIdRef.current) return // duplicate
            if (ev.id > lastIdRef.current) lastIdRef.current = ev.id
            dispatch({ type: 'event', event: ev })
            if (REFETCH_ON.has(ev.type)) debouncedRefetch()
          },
          onClose: () => dispatch({ type: 'connection', connection: 'reconnecting' }),
        })
        if (ac.signal.aborted) break
        await new Promise((r) => setTimeout(r, RECONNECT_MS))
      }
    }

    void run()
    return () => {
      ac.abort()
      if (pending) clearTimeout(pending)
      dispatch({ type: 'connection', connection: 'closed' })
    }
  }, [hazardId, scheduleRefetch])

  return state
}

export type EventStream = ReturnType<typeof useEventStream>
