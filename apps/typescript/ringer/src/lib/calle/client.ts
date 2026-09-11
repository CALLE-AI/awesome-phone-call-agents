import type { CallTask, CreateCallBody, EventList } from './types'
import {
  demoCreate,
  demoDecide,
  demoEvents,
  demoGet,
  isDemoId,
  type DemoDecision,
  type DemoPlanRecipient,
} from './demoEngine'

export type RunMode = 'demo' | 'live'

export interface CalleSettings {
  mode: RunMode
  /** BYOK API key (live mode only). Never persisted server-side. */
  apiKey?: string
  /** Optional base URL override, e.g. a self-hosted proxy. */
  baseUrl?: string
  /** Access secret for a deployment whose shared server key is gated. */
  appSecret?: string
}

export interface CreatePayload {
  body: CreateCallBody
  templateId: string
  demoPlan: DemoPlanRecipient[]
  /** ISO 4217 currency amounts are quoted in (from the recipient region(s)). */
  currency: string
}

export class CalleError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'error', status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

async function liveFetch<T>(
  path: string,
  settings: CalleSettings,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (settings.apiKey) headers['x-calle-key'] = settings.apiKey
  if (settings.baseUrl) headers['x-calle-base-url'] = settings.baseUrl
  if (settings.appSecret) headers['x-ringer-app-secret'] = settings.appSecret

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new CalleError('Could not reach the Ringer server. Is the API running?', 'connection', 0)
  }

  const text = await res.text()
  const json = text ? safeJson(text) : {}
  if (!res.ok) {
    const err = (json?.error ?? {}) as { code?: string; message?: string }
    throw new CalleError(
      err.message || `Request failed (${res.status}).`,
      err.code || 'error',
      res.status,
    )
  }
  return json as T
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function createCall(
  payload: CreatePayload,
  settings: CalleSettings,
): Promise<{ id: string }> {
  if (settings.mode === 'demo') {
    return demoCreate(payload.body, payload.templateId, payload.demoPlan)
  }
  // No automatic retry on the create: a create that times out (504) may have
  // already placed the call upstream, so silently re-sending it risks a
  // DUPLICATE real phone call if CALL-E doesn't dedup the idempotency key fast
  // enough. Surfacing the error and letting the user re-submit (which reuses the
  // same content-idempotency key, under their control) is the safe reconciliation.
  return liveFetch<{ id: string }>('/api/calls', settings, {
    method: 'POST',
    body: JSON.stringify(payload.body),
  })
}

export async function getCall(id: string, settings: CalleSettings): Promise<CallTask> {
  if (settings.mode === 'demo' || isDemoId(id)) {
    const call = demoGet(id)
    if (!call) throw new CalleError('Demo call not found (it may have expired).', 'not_found', 404)
    return call
  }
  return liveFetch<CallTask>(`/api/call?id=${encodeURIComponent(id)}`, settings)
}

export async function getEvents(id: string, settings: CalleSettings): Promise<EventList> {
  if (settings.mode === 'demo' || isDemoId(id)) {
    return demoEvents(id)
  }
  return liveFetch<EventList>(`/api/call-events?id=${encodeURIComponent(id)}`, settings)
}

/**
 * Resolve a mid-call approval checkpoint. Interactive approval is a Demo Mode
 * capability; in Live mode the same intent is enforced up-front via task
 * guardrails (the agent never commits without approval).
 */
export async function decideCall(id: string, choice: DemoDecision): Promise<boolean> {
  if (isDemoId(id)) return demoDecide(id, choice)
  return false
}
