import type {
  AgentEvent,
  Asset,
  CalleStatus,
  ContractPreview,
  CorrespondenceDraft,
  Dashboard,
  DispatchRow,
  Eligibility,
  Escalation,
  HandoffPacket,
  Hazard,
  IncidentDetail,
  IncidentDocument,
  IncidentRow,
  Neighbour,
  NeighbourDetail,
  PendingDispatch,
  SweepAccepted,
  SweepSummary,
} from './types'

/** '' (default) = same origin, which the Vite dev proxy forwards to :8000. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, { headers: { Accept: 'application/json' }, ...init })
  if (!res.ok) {
    // The backend's `detail` is load-bearing on the release endpoint: it is the sentence explaining
    // why a name like "system" was refused. Surface it verbatim rather than an HTTP status.
    let detail = res.statusText
    try {
      const j = (await res.json()) as { detail?: string }
      if (j && typeof j.detail === 'string') detail = j.detail
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return req<T>(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const qs = (params: Record<string, string | boolean | undefined>): string => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

export const api = {
  // hazards + sweeps
  hazards: () => req<Hazard[]>('/api/hazards'),
  hazard: (id: string) => req<Hazard>(`/api/hazards/${id}`),
  startSweep: (id: string) => post<SweepAccepted>(`/api/hazards/${id}/sweep`),
  sweep: (id: string) => req<SweepSummary>(`/api/sweeps/${id}`),
  trace: (id: string) => req<Record<string, unknown>>(`/api/sweeps/${id}/trace`),
  traceUrl: (id: string) => `${API_BASE}/api/sweeps/${id}/trace`,

  // the board
  neighbours: (hazardId?: string) => req<Neighbour[]>(`/api/neighbours${qs({ hazard_id: hazardId })}`),
  neighbour: (id: string, hazardId?: string) => req<NeighbourDetail>(`/api/neighbours/${id}${qs({ hazard_id: hazardId })}`),

  // the ladder
  escalations: (hazardId?: string, openOnly = false) =>
    req<Escalation[]>(`/api/escalations${qs({ hazard_id: hazardId, open_only: openOnly })}`),
  resolveEscalation: (id: string, body: { resolved_by: string; note?: string }) =>
    post<Escalation>(`/api/escalations/${id}/resolve`, body),

  handoffs: (hazardId?: string, unreleasedOnly = false) =>
    req<HandoffPacket[]>(`/api/handoffs${qs({ hazard_id: hazardId, unreleased_only: unreleasedOnly })}`),
  handoff: (id: string) => req<HandoffPacket>(`/api/handoffs/${id}`),
  /** The only transition out of a prepared packet, and it needs a person's name. */
  releaseHandoff: (id: string, body: { released_by: string; note?: string }) =>
    post<HandoffPacket>(`/api/handoffs/${id}/release`, body),

  // preview + status
  contract: (hazardId: string, neighbourId?: string) =>
    req<ContractPreview>(`/api/hazards/${hazardId}/contract${qs({ neighbour_id: neighbourId })}`),
  dashboard: () => req<Dashboard>('/api/dashboard'),
  calleStatus: () => req<CalleStatus>('/api/calle/status'),

  // ---------------------------------------------------------------------------
  // The operator layer
  // ---------------------------------------------------------------------------
  /** The whole fleet, with each unit's live position and, if it is rolling, its route and ETA. */
  assets: () => req<Asset[]>('/api/assets'),
  asset: (id: string) => req<Asset>(`/api/assets/${id}`),

  incidents: (hazardId?: string, openOnly = false) =>
    req<IncidentRow[]>(`/api/incidents${qs({ hazard_id: hazardId, open_only: openOnly })}`),
  /** The full record: needs, situation, risk reasons, paperwork and every agent decision. */
  incident: (id: string) => req<IncidentDetail>(`/api/incidents/${id}`),
  /** Who could go — and a sentence for every unit that could not. */
  candidates: (id: string) => req<Eligibility>(`/api/incidents/${id}/candidates`),
  resolveIncident: (id: string, body: { resolved_by: string; resolution?: string }) =>
    post<IncidentRow>(`/api/incidents/${id}/resolve`, body),
  /** Reconcile escalations into incidents. Idempotent; the background loop runs the same function. */
  syncIncidents: (hazardId?: string) =>
    post<{ opened: string[]; incidents: number }>('/api/incidents/sync', hazardId ? { hazard_id: hazardId } : {}),

  dispatches: (params: { hazard_id?: string; incident_id?: string; status?: string } = {}) =>
    req<DispatchRow[]>(`/api/dispatch${qs(params)}`),
  /** Everything waiting on a named human. Worst incident first. */
  pendingDispatches: (hazardId?: string) => req<PendingDispatch[]>(`/api/dispatch/pending${qs({ hazard_id: hazardId })}`),
  /** Runs the operator agent — 20-100 s on the free tier. Never block a render on it. */
  proposeDispatch: (incidentId: string, auto = true) =>
    post<DispatchRow>('/api/dispatch/propose', { incident_id: incidentId, auto }),
  commitDispatch: (id: string) => post<DispatchRow>(`/api/dispatch/${id}/commit`),
  /** The ONLY path an EMS, fire or police unit can take, and it needs a person's name. */
  authoriseDispatch: (id: string, body: { name: string; note?: string }) =>
    post<DispatchRow>(`/api/dispatch/${id}/authorise`, body),
  /** Saying no is a decision and is recorded like one: who, and why. */
  declineDispatch: (id: string, body: { name: string; reason: string }) =>
    post<DispatchRow>(`/api/dispatch/${id}/decline`, body),
  completeDispatch: (id: string, note = '') =>
    post<DispatchRow>(`/api/dispatch/${id}/complete${qs({ note })}`),

  documents: (params: { hazard_id?: string; incident_id?: string } = {}) =>
    req<IncidentDocument[]>(`/api/documents${qs(params)}`),
  generateDocument: (body: { form: string; incident_id?: string; hazard_id?: string; prepared_by?: string }) =>
    post<IncidentDocument>('/api/documents/generate', body),
  approveDocument: (id: string, approvedBy: string) =>
    post<IncidentDocument>(`/api/documents/${id}/approve`, { approved_by: approvedBy }),

  correspondence: (params: { hazard_id?: string; incident_id?: string } = {}) =>
    req<CorrespondenceDraft[]>(`/api/correspondence${qs(params)}`),
  /** Drafts words for a human to send. There is no send endpoint, here or anywhere. */
  draftCorrespondence: (body: { kind: string; incident_id: string; agency?: string; to_name?: string }) =>
    post<CorrespondenceDraft>('/api/correspondence/draft', body),
  approveCorrespondence: (id: string, approvedBy: string) =>
    post<CorrespondenceDraft>(`/api/correspondence/${id}/approve`, { approved_by: approvedBy }),

  // demo
  reset: () => post<Record<string, unknown>>('/api/demo/reset'),
  declareOutage: () => post<Record<string, unknown>>('/api/demo/outage'),

  // stream
  history: (hazardId: string, since = 0) =>
    req<AgentEvent[]>(`/api/stream/hazards/${hazardId}/history?since_event_id=${since}`),
  streamUrl: (hazardId: string, since: number) => `${API_BASE}/api/stream/hazards/${hazardId}?since_event_id=${since}`,
}
