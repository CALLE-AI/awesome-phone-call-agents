import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ListTree,
  PhoneOff,
  Plus,
  RotateCw,
  FlaskConical,
  Radio,
  Share2,
  Check,
  Code2,
  ChevronDown,
  ClipboardCopy,
  Languages,
} from 'lucide-react'
import type { CallRunner } from '@/hooks/useCallRunner'
import type { TaskTemplate } from '@/lib/tasks/types'
import type { CreatePayload, RunMode } from '@/lib/calle/client'
import type { JsonObject } from '@/lib/calle/types'
import type { LaunchMeta } from '@/components/compose/Composer'
import { buildShareUrl } from '@/lib/share'
import { guidanceForError } from '@/lib/calleErrors'
import { nonEnglishLanguages } from '@/lib/regions'
import { outcomeToText } from '@/lib/outcomeText'
import { ApprovalCard, type ApprovalRequest } from './ApprovalCard'
import { AddToCalendar, RateWatchCard, RetryPlanner } from './FollowUpCards'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Waveform } from '@/components/ui/Waveform'
import { TranscriptView } from './TranscriptView'
import { EventTimeline } from './EventTimeline'
import { OutcomeCard, RawResult } from './OutcomeCard'
import { ShootoutResults } from './ShootoutResults'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/cn'

export function CallView({
  runner,
  template,
  meta,
  payload,
  mode,
  onNewCall,
  onRetry,
  onEscalateNow,
  onScheduleRetry,
  watching = false,
  onWatchRate,
}: {
  runner: CallRunner
  template: TaskTemplate
  meta: LaunchMeta
  payload: CreatePayload
  mode: RunMode
  onNewCall: () => void
  onRetry: () => void
  /** Re-run immediately with an escalation-hardened prompt. */
  onEscalateNow?: () => void
  /** Queue a follow-up attempt for later. */
  onScheduleRetry?: (dueAt: Date) => void
  watching?: boolean
  onWatchRate?: (result: JsonObject) => void
}) {
  const { state, call, events, error } = runner
  const running = state === 'creating' || state === 'running'
  const callLangs = nonEnglishLanguages((payload.body.recipients ?? []).map((r) => r.locale))
  const currency = payload.currency ?? 'USD'
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [running])

  const startedMs = call ? new Date(call.created_at).getTime() : now
  const endedMs = call?.completed_at ? new Date(call.completed_at).getTime() : now
  const elapsed = Math.max(0, (running ? now : endedMs) - startedMs)

  const failed = state === 'error' || call?.status === 'failed'

  // Human-in-the-loop: the demo agent is holding for a decision.
  const approval = ((call?.metadata as JsonObject | undefined)?.approval_request ?? null) as ApprovalRequest | null

  // Follow-up context for terminal calls.
  const result = (call?.structured_result ?? {}) as JsonObject
  const outcomeVal = String(result[template.outcomeKey] ?? '')
  const needsFollowUp =
    state === 'done' && !meta.batch && (outcomeVal === 'callback_required' || outcomeVal === 'failed')
  const bookedOk = state === 'done' && template.id === 'book-appointment' && outcomeVal === 'success'
  const negotiatedOk = state === 'done' && template.id === 'negotiate-bill' && outcomeVal === 'success'

  return (
    <div className="mx-auto max-w-3xl">
      {/* Status header */}
      <div className="card soft-shadow mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
          <StatusPill state={state} status={call?.status} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold text-ink">{meta.title}</h1>
            <p className="text-xs text-muted">{template.label}</p>
          </div>
          <div className="flex items-center gap-2">
            {callLangs.length > 0 && (
              <Badge tone="brand" icon={<Languages className="size-3" />}>
                {callLangs.length === 1 ? callLangs[0] : 'Multilingual'}
              </Badge>
            )}
            <Badge tone={mode === 'demo' ? 'info' : 'success'} icon={mode === 'demo' ? <FlaskConical className="size-3" /> : <Radio className="size-3" />}>
              {mode === 'demo' ? 'Demo' : 'Live'}
            </Badge>
            <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-sm font-semibold text-ink tabular-nums">
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>
        {running && (
          <div className="flex items-center gap-2 border-t border-border bg-primary-soft/40 px-4 py-2 text-xs font-semibold text-primary-strong dark:text-primary sm:px-5">
            <Waveform bars={5} className="text-primary" barClassName="h-3" />
            {mode === 'demo' ? 'Simulating a live call' : 'On the phone — this can take a minute'}
          </div>
        )}
      </div>

      {/* Error */}
      {failed && (
        <div className="card mb-5 border-danger/30 bg-rose-500/5 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div className="flex-1">
              <p className="font-bold text-ink">{state === 'error' ? 'Couldn’t place the call' : 'The call failed'}</p>
              <p className="mt-0.5 text-sm text-muted">
                {error || call?.failure_message || 'Something went wrong on the provider side.'}
              </p>
              {(() => {
                const guide = guidanceForError(runner.errorCode || call?.failure_code)
                if (!guide) return null
                return (
                  <div className="mt-2.5 rounded-xl border border-border bg-surface-2 p-3 text-sm text-ink">
                    <p className="leading-relaxed">{guide.hint}</p>
                    {guide.action && (
                      <a
                        href={guide.action.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        {guide.action.label} →
                      </a>
                    )}
                  </div>
                )
              })()}
              {(runner.errorCode || call?.failure_code) && (
                <p className="mt-2 font-mono text-xs text-faint">code: {runner.errorCode || call?.failure_code}</p>
              )}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" iconLeft={<RotateCw className="size-4" />} onClick={onRetry}>
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={onNewCall}>
                  New call
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Human-in-the-loop approval */}
      {!failed && approval && state === 'running' && (
        <div className="mb-5">
          <ApprovalCard request={approval} onDecide={(choice) => runner.decide(choice)} />
        </div>
      )}

      {/* Body */}
      {!failed && (meta.batch ? (
        <BatchBody template={template} runner={runner} currency={currency} />
      ) : (
        <SingleBody template={template} runner={runner} events={events} currency={currency} />
      ))}

      {/* Follow-up: retry / escalate when the call didn't land */}
      {needsFollowUp && onEscalateNow && onScheduleRetry && (
        <div className="mt-5">
          <RetryPlanner
            reason={
              String(result.next_steps ?? call?.summary ?? 'The call needs another attempt.')
            }
            onEscalateNow={onEscalateNow}
            onSchedule={onScheduleRetry}
          />
        </div>
      )}

      {/* Rate watch on a successful negotiation */}
      {negotiatedOk && onWatchRate && (
        <div className="mt-5">
          <RateWatchCard
            company={payload.demoPlan[0]?.businessName || String((payload.demoPlan[0]?.values as JsonObject | undefined)?.company ?? 'this provider')}
            newAmount={typeof result.new_amount === 'number' ? result.new_amount : null}
            promoLength={typeof result.promo_length === 'string' ? result.promo_length : null}
            currency={currency}
            watching={watching}
            onWatch={() => onWatchRate(result)}
          />
        </div>
      )}

      {/* Developer peek */}
      {state === 'done' && call && <DeveloperPeek payload={payload} call={call} />}

      {/* Footer actions */}
      {state === 'done' && call && (
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {bookedOk && <AddToCalendar result={result} title={meta.title} />}
          <CopyButton text={outcomeToText(template, call, meta.title, currency)} />
          <ShareButton snapshot={{ v: 1, templateId: meta.templateId, title: meta.title, batch: meta.batch, currency, call }} />
          <Button variant="accent" iconLeft={<Plus className="size-4" />} onClick={onNewCall}>
            Make another call
          </Button>
        </div>
      )}
      {running && (
        <div className="mt-6 flex justify-center">
          <Button variant="ghost" size="sm" iconLeft={<PhoneOff className="size-4" />} onClick={onNewCall}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function SingleBody({
  template,
  runner,
  events,
  currency = 'USD',
}: {
  template: TaskTemplate
  runner: CallRunner
  events: CallRunner['events']
  currency?: string
}) {
  const { call, state } = runner
  const recipient = call?.recipients?.[0]
  const attempts = recipient?.attempts ?? []
  const attempt = attempts[attempts.length - 1]
  const turns = attempt?.transcript_turns ?? []
  const connecting = state !== 'done' && turns.length === 0
  const done = state === 'done'
  const hasView = template.resultView.some((s) => call?.structured_result?.[s.key] != null)

  return (
    <div className="flex flex-col gap-5">
      {done && call && (hasView ? <OutcomeCard template={template} call={call} currency={currency} /> : (
        <div className="card p-5 sm:p-6">
          <h2 className="mb-3 text-sm font-bold text-ink">Result</h2>
          <RawResult result={call.structured_result ?? {}} />
          {call.summary && <p className="mt-3 text-sm text-muted">{call.summary}</p>}
        </div>
      ))}

      <div className="grid gap-5 lg:grid-cols-[1fr_270px]">
        {/* Transcript */}
        <div className="card p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-bold text-ink">Transcript</h2>
            {!done && turns.length > 0 && <span className="size-2 rounded-full bg-live live-dot" />}
          </div>
          <TranscriptView turns={turns} connecting={connecting} live={!done} />
        </div>

        {/* Event timeline */}
        <div className="card h-fit p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <ListTree className="size-4 text-muted" />
            <h2 className="text-sm font-bold text-ink">Call events</h2>
          </div>
          <EventTimeline events={events} />
        </div>
      </div>
    </div>
  )
}

function BatchBody({ template, runner, currency = 'USD' }: { template: TaskTemplate; runner: CallRunner; currency?: string }) {
  const { call, state } = runner
  if (state === 'done' && call) {
    return <ShootoutResults template={template} call={call} currency={currency} />
  }
  // Live batch progress.
  const recipients = call?.recipients ?? []
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Calling {recipients.length || 'your'} businesses{recipients.length ? '' : '…'} — results appear as each call wraps up.
      </p>
      {recipients.map((r, i) => {
        const rAttempts = r.attempts ?? []
        const attempt = rAttempts[rAttempts.length - 1]
        const lastTurn = attempt?.transcript_turns?.at(-1)
        return (
          <div key={r.id} className="card flex items-center gap-3 p-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-sm font-bold text-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{r.phones[0]}</p>
              <p className="truncate text-xs text-muted">{lastTurn ? lastTurn.text : 'Waiting to dial…'}</p>
            </div>
            <RecipientStatus status={r.status} />
          </div>
        )
      })}
    </div>
  )
}

function RecipientStatus({ status }: { status: string }) {
  if (status === 'completed') return <Badge tone="success">Done</Badge>
  if (status === 'in_progress')
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Waveform bars={3} className="text-primary" barClassName="h-3" /> live
      </span>
    )
  return <span className="text-xs font-medium text-faint">queued</span>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copy the result:', text)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button
      variant="outline"
      iconLeft={copied ? <Check className="size-4 text-success" /> : <ClipboardCopy className="size-4" />}
      onClick={copy}
    >
      {copied ? 'Copied' : 'Copy details'}
    </Button>
  )
}

function ShareButton({ snapshot }: { snapshot: import('@/lib/share').SharedSnapshot }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = buildShareUrl(snapshot)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy your shareable result link:', url)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Button variant="outline" iconLeft={copied ? <Check className="size-4 text-success" /> : <Share2 className="size-4" />} onClick={share}>
      {copied ? 'Link copied' : 'Share result'}
    </Button>
  )
}

function DeveloperPeek({ payload, call }: { payload: CreatePayload; call: import('@/lib/calle/types').CallTask }) {
  const [open, setOpen] = useState(false)
  const request = {
    endpoint: 'POST /v1/calls',
    task: payload.body.task,
    recipients: payload.body.recipients,
    result_schema: payload.body.result_schema,
    ...(payload.body.recipient_result_schema ? { recipient_result_schema: payload.body.recipient_result_schema } : {}),
    metadata: payload.body.metadata,
  }
  return (
    <div className="card mt-5 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-ink">
          <Code2 className="size-4 text-primary" /> Developer view — the CALL-E request &amp; structured result
        </span>
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border p-5 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 font-mono text-xs font-semibold text-muted">request →</p>
            <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-3.5 font-mono text-[0.72rem] leading-relaxed text-ink">
              {JSON.stringify(request, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1.5 font-mono text-xs font-semibold text-muted">structured_result ←</p>
            <pre className="max-h-72 overflow-auto rounded-xl bg-surface-2 p-3.5 font-mono text-[0.72rem] leading-relaxed text-ink">
              {JSON.stringify(call.structured_result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ state, status }: { state: string; status?: string }) {
  let label = 'Queued'
  let tone = 'bg-surface-2 text-muted'
  let live = false
  if (state === 'creating') {
    label = 'Placing…'
    tone = 'bg-primary-soft text-primary-strong dark:text-primary'
  } else if (status === 'completed' || state === 'done') {
    label = 'Completed'
    tone = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
  } else if (status === 'failed' || state === 'error') {
    label = 'Failed'
    tone = 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
  } else if (status === 'in_progress' || state === 'running') {
    label = 'On the call'
    tone = 'bg-primary-soft text-primary-strong dark:text-primary'
    live = true
  }
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold', tone)}>
      {live && <span className="size-2 rounded-full bg-live live-dot" />}
      {label}
    </span>
  )
}
