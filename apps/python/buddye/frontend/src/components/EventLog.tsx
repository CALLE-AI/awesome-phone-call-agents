import { useState } from 'react'
import { fmtClock } from '../lib/utils'
import { ChevronIcon } from './Icons'
import type { AgentEvent } from '../types'

/** Event types whose payload carries a sentence worth putting next to the type. */
function line(ev: AgentEvent): string {
  const p = ev.payload ?? {}
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
  switch (ev.type) {
    case 'sweep.triaged':
      return `${p.queued ?? '?'} of ${p.roster ?? '?'} to call`
    case 'check.decided':
      return `${s('name')} — ${s('outcome')}: ${s('reason')}`
    case 'call.started':
      return `${s('name')} (${s('callee')})`
    case 'call.completed':
      return `${s('name')} — ${s('status')}`
    case 'neighbour.skipped':
    case 'call.skipped':
      return `${s('name') || s('neighbour_id')} — ${s('reason')}`
    case 'escalation.opened':
      return `${s('name')} — ${s('outcome')} at ${s('level')}`
    case 'escalation.notified':
      return `${s('name')} — ${s('captain')} notified`
    case 'handoff.prepared':
      return `${s('name')} — packet prepared, not sent`
    case 'handoff.released':
      return `released by ${s('released_by')}`
    case 'sweep.unaccounted':
      return `${p.count ?? 0} people nobody has accounted for`
    case 'sweep.state':
      return `${s('from') || '—'} → ${s('to')}`
    default:
      return s('message') || s('reason') || s('note') || ''
  }
}

/**
 * The raw stream, collapsed by default.
 *
 * It is here because a judge and a captain want different things from the same evening — she wants
 * to know who needs her, he wants to see that the calls really happened — and hiding the machinery
 * entirely would make the second question unanswerable without a terminal.
 */
export function EventLog({ events }: { events: AgentEvent[] }) {
  const [open, setOpen] = useState(false)
  const recent = [...events].reverse().slice(0, 200)

  return (
    <section className="card mb-4 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-active"
      >
        <span className={open ? 'rotate-90 text-faint transition-transform' : 'text-faint transition-transform'}>
          <ChevronIcon size={14} />
        </span>
        <span className="label">Everything BuddyE did</span>
        <span className="ml-auto font-mono text-11 text-faint">{events.length} events</span>
      </button>
      {open && (
        <div className="thin-scroll max-h-[320px] overflow-y-auto border-t border-divider">
          {recent.map((ev) => (
            <div key={ev.id} className="grid grid-cols-[62px_150px_minmax(0,1fr)] gap-2 border-b border-divider px-4 py-1.5 last:border-b-0">
              <span className="font-mono text-11 text-faint">{fmtClock(ev.created_at)}</span>
              <span className="truncate font-mono text-11 text-accent">{ev.type}</span>
              <span className="truncate text-12 text-muted">{line(ev)}</span>
            </div>
          ))}
          {recent.length === 0 && <p className="px-4 py-3 text-12 text-faint">Nothing yet.</p>}
        </div>
      )}
    </section>
  )
}
