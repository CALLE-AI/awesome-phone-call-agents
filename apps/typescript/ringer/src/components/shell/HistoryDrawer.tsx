import { BellRing, CalendarClock, Clock, PhoneOutgoing, Play, Repeat2, Trash2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { OutcomeTone } from '@/lib/tasks/types'
import type { HistoryEntry } from '@/lib/app'
import { formatDue, type RateWatch, type ScheduledCall } from '@/lib/followups'
import type { JobStatus, ScheduledJob } from '@/lib/schedule'
import { relativeTime, formatMoney } from '@/lib/format'
import { ImpactSummary } from './ImpactSummary'

const JOB_TONE: Record<JobStatus, OutcomeTone> = {
  pending: 'pending',
  placed: 'success',
  failed: 'failed',
  canceled: 'neutral',
  unresolved: 'partial',
}
const JOB_LABEL: Record<JobStatus, string> = {
  pending: 'Scheduled',
  placed: 'Placed',
  failed: 'Failed',
  canceled: 'Canceled',
  unresolved: 'Needs check',
}

function jobSubline(job: ScheduledJob): string {
  if (job.status === 'placed') return job.placedAt ? `Placed ${relativeTime(job.placedAt)}` : 'Placed'
  if (job.status === 'failed') return job.error ? `Failed — ${job.error}` : 'Failed'
  if (job.status === 'canceled') return 'Canceled'
  if (job.status === 'unresolved') {
    // Ambiguous outcome — the call may or may not have gone out; needs a manual check.
    return job.error ? `Unconfirmed — ${job.error}` : 'Unconfirmed — verify with CALL-E'
  }
  return `Calls ${formatDue(job.dueAt)}`
}

export function HistoryDrawer({
  open,
  onClose,
  entries,
  onClear,
  jobs = [],
  onCancelJob,
  scheduled = [],
  onRunScheduled,
  onCancelScheduled,
  watches = [],
  onQueueWatch,
  onRemoveWatch,
}: {
  open: boolean
  onClose: () => void
  entries: HistoryEntry[]
  onClear: () => void
  jobs?: ScheduledJob[]
  onCancelJob?: (id: string) => void
  scheduled?: ScheduledCall[]
  onRunScheduled?: (entry: ScheduledCall) => void
  onCancelScheduled?: (id: string) => void
  watches?: RateWatch[]
  onQueueWatch?: (watch: RateWatch) => void
  onRemoveWatch?: (id: string) => void
}) {
  const empty =
    entries.length === 0 && scheduled.length === 0 && watches.length === 0 && jobs.length === 0

  return (
    <Modal open={open} onClose={onClose} side title="Impact & history">
      {entries.length > 0 && <ImpactSummary history={entries} />}

      {/* Durable scheduled calls (fired server-side by the cron) */}
      {jobs.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <PhoneOutgoing className="size-3.5" /> Scheduled calls
          </p>
          <div className="flex flex-col gap-2">
            {jobs.map((j) => (
              <div key={j.id} className="card-2 flex items-center gap-2.5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{j.title}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span className="truncate">{jobSubline(j)}</span>
                    {j.recurrenceMonths ? (
                      <span className="inline-flex items-center gap-1 text-faint">
                        <Repeat2 className="size-3" /> every {j.recurrenceMonths}mo
                      </span>
                    ) : null}
                  </p>
                </div>
                <Badge tone={JOB_TONE[j.status]}>{JOB_LABEL[j.status]}</Badge>
                {j.status === 'pending' && onCancelJob && (
                  <button
                    onClick={() => onCancelJob(j.id)}
                    aria-label="Cancel scheduled call"
                    className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled follow-up calls (in-browser fallback) */}
      {scheduled.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <CalendarClock className="size-3.5" /> Scheduled calls
          </p>
          <div className="flex flex-col gap-2">
            {scheduled.map((s) => (
              <div key={s.id} className="card-2 flex items-center gap-2.5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{s.title}</p>
                  <p className="text-xs text-muted">
                    {formatDue(s.dueAt)}
                    {s.escalated && ' · escalation script'}
                  </p>
                </div>
                {onRunScheduled && (
                  <Button size="sm" variant="primary" iconLeft={<Play className="size-3.5" />} onClick={() => onRunScheduled(s)}>
                    Run now
                  </Button>
                )}
                {onCancelScheduled && (
                  <button
                    onClick={() => onCancelScheduled(s.id)}
                    aria-label="Cancel scheduled call"
                    className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate watches */}
      {watches.length > 0 && (
        <div className="border-b border-border p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            <BellRing className="size-3.5" /> Rate watches
          </p>
          <div className="flex flex-col gap-2">
            {watches.map((w) => (
              <div key={w.id} className="card-2 flex items-center gap-2.5 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {w.company}
                    {w.newAmount != null && (
                      <span className="ml-1.5 font-normal text-muted">{formatMoney(w.newAmount, w.currency)}/mo</span>
                    )}
                  </p>
                  <p className="text-xs text-muted">Renegotiate {formatDue(w.endsAt)}</p>
                </div>
                {onQueueWatch && (
                  <Button size="sm" variant="outline" onClick={() => onQueueWatch(w)}>
                    Queue now
                  </Button>
                )}
                {onRemoveWatch && (
                  <button
                    onClick={() => onRemoveWatch(w.id)}
                    aria-label="Remove rate watch"
                    className="cursor-pointer rounded-lg p-1.5 text-faint hover:bg-danger/10 hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {empty ? (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-faint">
            <Clock className="size-6" />
          </span>
          <p className="font-semibold text-ink">No calls yet</p>
          <p className="max-w-xs text-sm text-muted">
            Every call you place shows up here with its outcome — even the demo ones.
          </p>
        </div>
      ) : entries.length === 0 ? null : (
        <div className="flex flex-col gap-2.5 p-4">
          {entries.map((e) => (
            <div key={e.id} className="card-2 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-ink">{e.title}</p>
                <Badge tone={e.outcomeTone}>{e.outcomeLabel}</Badge>
              </div>
              {e.headline && <p className="mt-0.5 text-sm font-semibold text-primary">{e.headline}</p>}
              {e.summary && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{e.summary}</p>}
              <div className="mt-2 flex items-center gap-2 text-[0.7rem] font-medium text-faint">
                <span>{relativeTime(e.at)}</span>
                <span>·</span>
                <span className="uppercase">{e.mode}</span>
                {e.batch && (
                  <>
                    <span>·</span>
                    <span>shootout</span>
                  </>
                )}
              </div>
            </div>
          ))}
          <Button variant="ghost" size="sm" className="mt-2 self-center text-danger" iconLeft={<Trash2 className="size-4" />} onClick={onClear}>
            Clear history
          </Button>
        </div>
      )}
    </Modal>
  )
}
