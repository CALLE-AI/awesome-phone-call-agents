import type {
  CallAttempt,
  CallRecipient,
  CallStatus,
  CallTask,
  CreateCallBody,
  DeveloperEvent,
  EventList,
  JsonObject,
} from './types'
import {
  buildDemoScript,
  type DemoScenario,
  type DemoScript,
  type DemoEvent,
  type DemoTurn,
} from './demoScripts'
import type { TaskValues } from '@/lib/tasks/types'
import { currencyForPhone, isEnglishLocale, languageLabel, regionCurrency } from '@/lib/regions'
import { formatMoney } from '@/lib/format'

export type DemoDecision = 'accept' | 'push'

interface DemoRecipient {
  id: string
  label: string
  phone: string
  region: string | null
  locale: string | null
  /** ISO 4217 currency this recipient quotes in (from number, then region). */
  currency: string
  offsetMs: number
  script: DemoScript
}

interface DemoCall {
  id: string
  createdAtMs: number
  createdAtIso: string
  body: CreateCallBody
  templateId: string
  recipients: DemoRecipient[]
  /** Human-in-the-loop decision, once made (single-recipient calls only). */
  decision?: { choice: DemoDecision; atMs: number }
}

const store = new Map<string, DemoCall>()

const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`

export interface DemoPlanRecipient {
  label: string
  phone: string
  region?: string | null
  locale?: string | null
  /** Personalized values used to script the conversation. */
  values: TaskValues
  businessName?: string
}

/** Pick the demo scenario for a recipient. Numbers ending in 99 hit voicemail. */
function scenarioFor(p: DemoPlanRecipient): DemoScenario {
  if (p.values.__escalated === 'yes') return 'escalated'
  if (p.phone.replace(/\D/g, '').endsWith('99')) return 'voicemail'
  return 'default'
}

/** Create a simulated call and return its id. */
export function demoCreate(
  body: CreateCallBody,
  templateId: string,
  plan: DemoPlanRecipient[],
): { id: string } {
  const now = Date.now()
  const id = rid('call_demo')
  const recipients: DemoRecipient[] = plan.map((p, i) => {
    const currency = currencyForPhone(p.phone) ?? regionCurrency(p.region)
    return {
      id: rid('rcpt'),
      label: p.label,
      phone: p.phone,
      region: p.region ?? null,
      locale: p.locale ?? null,
      currency,
      offsetMs: plan.length > 1 ? i * 1400 : 0,
      script: buildDemoScript(templateId, p.values, {
        businessName: p.businessName,
        variant: i,
        scenario: scenarioFor(p),
        currency,
      }),
    }
  })
  // Checkpoints are only supported on single-recipient calls.
  if (recipients.length > 1) {
    for (const r of recipients) delete r.script.checkpoint
  }
  store.set(id, {
    id,
    createdAtMs: now,
    createdAtIso: new Date(now).toISOString(),
    body,
    templateId,
    recipients,
  })
  return { id }
}

export function isDemoId(id: string): boolean {
  return id.startsWith('call_demo_')
}

/** Record the user's mid-call decision; the script continues on next poll. */
export function demoDecide(id: string, choice: DemoDecision): boolean {
  const call = store.get(id)
  if (!call || call.decision) return false
  const r = call.recipients[0]
  if (!r?.script.checkpoint) return false
  const elapsed = Date.now() - call.createdAtMs
  call.decision = { choice, atMs: Math.max(elapsed, r.script.checkpoint.atMs) }
  return true
}

/* ------------------------------------------------------------------ */
/*  Timeline resolution (handles checkpoint pause + branch)            */
/* ------------------------------------------------------------------ */

interface ResolvedScript {
  turns: DemoTurn[] // absolute atMs from this recipient's start
  events: DemoEvent[] // absolute atMs from this recipient's start
  totalMs: number // Infinity while holding for a decision
  holding: boolean
  approval: { prompt: string; offer: string } | null
  result: JsonObject
  summary: string
  taskCompleted: boolean
  confidence: DemoScript['confidence']
  evidence: string[]
}

function resolveScript(call: DemoCall, r: DemoRecipient, recipientElapsed: number): ResolvedScript {
  const s = r.script
  const cp = s.checkpoint

  if (!cp) {
    return {
      turns: s.turns,
      events: [...s.events],
      totalMs: s.totalMs,
      holding: false,
      approval: null,
      result: s.result,
      summary: s.summary,
      taskCompleted: s.taskCompleted,
      confidence: s.confidence,
      evidence: s.evidence,
    }
  }

  const decision = call.decision
  if (!decision) {
    const holding = recipientElapsed >= cp.atMs
    return {
      turns: s.turns,
      events: holding
        ? [
            ...s.events,
            { atMs: cp.atMs, type: 'call.approval_required', level: 'warning', message: `Offer on the table: ${cp.offer}. Waiting for your decision — the agent is holding.` },
          ]
        : [...s.events],
      totalMs: Number.POSITIVE_INFINITY,
      holding,
      approval: holding ? { prompt: cp.prompt, offer: cp.offer } : null,
      result: {},
      summary: '',
      taskCompleted: false,
      confidence: s.confidence,
      evidence: [],
    }
  }

  const branch = cp.branches[decision.choice]
  const d = decision.atMs
  return {
    turns: [...s.turns, ...branch.turns.map((t) => ({ ...t, atMs: t.atMs + d }))],
    events: [
      ...s.events,
      { atMs: cp.atMs, type: 'call.approval_required', level: 'warning', message: `Offer on the table: ${cp.offer}. Waiting for your decision.` },
      { atMs: d, type: 'call.approval_received', level: 'info', message: decision.choice === 'accept' ? 'You approved the offer — closing the deal.' : 'You asked Ringer to push for a better rate.' },
      ...branch.events.map((e) => ({ ...e, atMs: e.atMs + d })),
    ],
    totalMs: d + branch.totalMs,
    holding: false,
    approval: null,
    result: branch.result,
    summary: branch.summary,
    taskCompleted: branch.taskCompleted,
    confidence: branch.confidence,
    evidence: branch.evidence,
  }
}

function attemptFor(
  r: DemoRecipient,
  resolved: ResolvedScript,
  elapsed: number,
  createdAtMs: number,
): CallAttempt {
  const e = elapsed - r.offsetMs
  const { connectMs } = r.script
  const { totalMs } = resolved
  let status: CallAttempt['status'] = 'queued'
  if (e >= totalMs) status = 'completed'
  else if (e >= connectMs) status = 'in_progress'
  else if (e >= 500) status = 'dialing'

  const startedAtMs = createdAtMs + r.offsetMs + 500
  return {
    id: rid('att'),
    phone: r.phone,
    status,
    started_at: e >= 500 ? new Date(startedAtMs).toISOString() : null,
    completed_at: e >= totalMs ? new Date(createdAtMs + r.offsetMs + totalMs).toISOString() : null,
    summary: e >= totalMs ? resolved.summary : null,
    transcript_turns: resolved.turns
      .filter((t) => e >= t.atMs)
      .map((t) => ({ offset_seconds: Math.round((t.atMs - connectMs) / 1000), speaker: t.speaker, text: t.text })),
    provider_call_id: e >= 500 ? rid('prov') : null,
    failure_code: null,
    failure_message: null,
  }
}

function recipientState(
  call: DemoCall,
  r: DemoRecipient,
  elapsed: number,
): { recipient: CallRecipient; resolved: ResolvedScript } {
  const e = elapsed - r.offsetMs
  const resolved = resolveScript(call, r, e)
  const { totalMs } = resolved
  let status: CallRecipient['status'] = 'pending'
  if (e >= totalMs) status = 'completed'
  else if (e >= 0) status = 'in_progress'

  return {
    resolved,
    recipient: {
      id: r.id,
      phones: [r.phone],
      locale: r.locale,
      region: r.region,
      status,
      structured_result: e >= totalMs ? resolved.result : null,
      summary: e >= totalMs ? resolved.summary : null,
      attempts: [attemptFor(r, resolved, elapsed, call.createdAtMs)],
    },
  }
}

/** Aggregate multiple recipient results into a call-level structured result. */
function aggregate(call: DemoCall): {
  structured_result: JsonObject
  summary: string
  evidence: string[]
  confidence: { score: number; label: string }
} {
  const rs = call.recipients
  // "Reached" = a live person actually spoke (voicemail/no-answer leave no user
  // turn). This is the denominator we refuse to overstate.
  const reachedCount = rs.filter((r) => r.script.turns.some((t) => t.speaker === 'user')).length
  const notReached = rs.length - reachedCount

  if (call.templateId === 'get-quote') {
    // Best = lowest price_low, among businesses that actually quoted.
    const priced = rs
      .map((r) => ({ label: r.label, low: Number(r.script.result.price_low) }))
      .filter((x) => Number.isFinite(x.low))
      .sort((a, b) => a.low - b.low)
    const best = priced[0]
    const worst = priced[priced.length - 1]
    const savings = best && worst ? worst.low - best.low : 0
    const declined = Math.max(0, reachedCount - priced.length)
    const note = honestNote(notReached, declined, rs.length)
    const currency = rs[0]?.currency ?? 'USD'
    const m = (n: number) => formatMoney(n, currency) ?? String(n)
    return {
      structured_result: {
        businesses_called: rs.length,
        reached: reachedCount,
        quotes_received: priced.length,
        cheapest_business: best?.label ?? null,
        cheapest_price: best?.low ?? null,
        potential_savings: savings,
        note,
      },
      summary:
        (best
          ? `${priced.length} of ${rs.length} quoted; cheapest is ${best.label} at ${m(best.low)}${savings > 0 ? ` — up to ${m(savings)} below the priciest quote` : ''}.`
          : `Called ${rs.length} businesses; none provided a quote.`) + (note ? ` ${note}` : ''),
      evidence: priced.map((p) => `${p.label}: ${m(p.low)}`),
      confidence: { score: 0.9, label: 'high' },
    }
  }

  const completed = rs.filter((r) => r.script.result.outcome === 'success')
  const note = honestNote(notReached, 0, rs.length)
  return {
    structured_result: {
      recipients_called: rs.length,
      reached: reachedCount,
      completed_count: completed.length,
      note,
    },
    summary: `Completed ${completed.length} of ${rs.length} calls${notReached > 0 ? `; ${notReached} not reached` : ''}.`,
    evidence: rs.map((r) => `${r.label}: ${r.script.summary}`),
    confidence: { score: 0.88, label: 'high' },
  }
}

/** Build the caveat naming who is not counted, or null when everyone answered. */
function honestNote(notReached: number, declined: number, total: number): string | null {
  const parts: string[] = []
  if (notReached > 0) parts.push(`${notReached} not reached`)
  if (declined > 0) parts.push(`${declined} gave no answer`)
  if (parts.length === 0) return null
  return `${parts.join(', ')} (of ${total} called) — not counted.`
}

export function demoGet(id: string): CallTask | null {
  const call = store.get(id)
  if (!call) return null
  const elapsed = Date.now() - call.createdAtMs
  const states = call.recipients.map((r) => recipientState(call, r, elapsed))
  const recipients = states.map((s) => s.recipient)
  const maxTotal = Math.max(
    ...call.recipients.map((r, i) => r.offsetMs + states[i].resolved.totalMs),
  )
  const allDone = Number.isFinite(maxTotal) && elapsed >= maxTotal
  const holding = states.some((s) => s.resolved.holding)

  let status: CallStatus = 'in_progress'
  if (elapsed < 800) status = 'queued'
  else if (allDone) status = 'completed'

  const isBatch = call.recipients.length > 1
  let structured_result: JsonObject | null = null
  let summary: string | null = null
  let task_completed: boolean | null = null
  let completion_confidence: CallTask['completion_confidence'] = null
  let evidence: string[] = []

  if (allDone) {
    if (isBatch) {
      const agg = aggregate(call)
      structured_result = agg.structured_result
      summary = agg.summary
      evidence = agg.evidence
      task_completed = true
      completion_confidence = agg.confidence
    } else {
      const only = states[0].resolved
      structured_result = only.result
      summary = only.summary
      evidence = only.evidence
      task_completed = only.taskCompleted
      completion_confidence = only.confidence
    }
  }

  const metadata: JsonObject = { ...(call.body.metadata ?? {}) }
  if (holding && !isBatch) {
    const approval = states[0].resolved.approval
    if (approval) {
      metadata.approval_request = {
        prompt: approval.prompt,
        offer: approval.offer,
        options: ['accept', 'push'],
      }
    }
  }

  return {
    id: call.id,
    object: 'call_task',
    status,
    task: call.body.task,
    recipients,
    structured_result,
    summary,
    task_completed,
    completion_confidence,
    evidence,
    metadata,
    failure_code: null,
    failure_message: null,
    created_at: call.createdAtIso,
    completed_at: allDone ? new Date(call.createdAtMs + maxTotal).toISOString() : null,
  }
}

export function demoEvents(id: string): EventList {
  const call = store.get(id)
  if (!call) return { object: 'list', data: [] }
  const elapsed = Date.now() - call.createdAtMs
  const events: DeveloperEvent[] = []

  call.recipients.forEach((r) => {
    const prefix = call.recipients.length > 1 ? `[${r.label}] ` : ''
    // Reflect localization in the timeline when the recipient isn't English.
    if (!isEnglishLocale(r.locale)) {
      const at = 300 + r.offsetMs
      if (elapsed >= at) {
        events.push({
          id: rid('evt'),
          type: 'call.localized',
          call_id: call.id,
          created_at: new Date(call.createdAtMs + at).toISOString(),
          level: 'info',
          status: 'in_progress',
          message: `${prefix}Conducting the call in ${languageLabel(r.locale)}.`,
          details: {},
        })
      }
    }
    const resolved = resolveScript(call, r, elapsed - r.offsetMs)
    resolved.events.forEach((ev) => {
      const at = ev.atMs + r.offsetMs
      if (elapsed >= at) {
        events.push({
          id: rid('evt'),
          type: ev.type,
          call_id: call.id,
          created_at: new Date(call.createdAtMs + at).toISOString(),
          level: ev.level,
          status: ev.type === 'call.completed' ? 'completed' : ev.type === 'call.queued' ? 'queued' : 'in_progress',
          message: prefix + ev.message,
          details: {},
        })
      }
    })
  })

  events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  return { object: 'list', data: events }
}
