import { useState } from 'react'
import { api } from '../api'
import { Pill } from './Pill'
import { CheckIcon, LockIcon, PhoneIcon } from './Icons'
import { cn, fmtTime } from '../lib/utils'
import { LADDER, LADDER_META, escalationStatusLabel, escalationStatusTone, rungActionLabel } from '../lib/status'
import type { Escalation, EscalationLevel, Rung } from '../types'

const ACTION_TONE: Record<string, 'verified' | 'accent' | 'partial' | 'grey'> = {
  called: 'accent',
  notified: 'accent',
  entered: 'grey',
  skipped: 'grey',
  prepared: 'partial',
  released: 'verified',
}

function RungLine({ rung }: { rung: Rung }) {
  return (
    <li className="flex gap-2 py-1.5">
      <span className="mt-[3px] shrink-0">
        {rung.action === 'skipped' ? (
          <span className="block h-[9px] w-[9px] rounded-full border border-edge" />
        ) : (
          <span className="block h-[9px] w-[9px] rounded-full bg-accent" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <Pill tone={ACTION_TONE[rung.action] ?? 'grey'}>{rungActionLabel(rung.action)}</Pill>
          <span className="text-12 leading-snug text-text">{rung.result}</span>
          <span className="ml-auto shrink-0 font-mono text-11 text-faint">{fmtTime(rung.at)}</span>
        </span>
        {rung.note && <span className="mt-0.5 block text-12 leading-snug text-muted">{rung.note}</span>}
      </span>
    </li>
  )
}

/**
 * The ladder, all three rungs, whether or not they were reached.
 *
 * Every rung is drawn even when it was never used, and each one says who does the acting. That is
 * the honest version of this diagram: an escalation that opened at the block captain because the
 * neighbour has no emergency contact on file should look like a rung that was skipped for a reason,
 * not like a rung that does not exist.
 *
 * The RESPONDER rung is labelled with what BuddyE actually does there — prepare a document — and it
 * never renders as an action the software has taken or could take on its own.
 */
export function LadderView({
  escalation,
  captainName,
  onResolved,
}: {
  escalation: Escalation
  captainName?: string
  onResolved?: (e: Escalation) => void
}) {
  const [name, setName] = useState(captainName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closable = onResolved && !['RESOLVED', 'CANCELLED'].includes(escalation.status)

  const resolve = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.resolveEscalation(escalation.id, { resolved_by: name.trim() })
      onResolved?.(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const byLevel = new Map<EscalationLevel, Rung[]>()
  for (const r of escalation.rungs ?? []) {
    const list = byLevel.get(r.level) ?? []
    list.push(r)
    byLevel.set(r.level, list)
  }
  const reachedIdx = LADDER.indexOf(escalation.level)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-3.5 py-2.5">
        <span className="label">Escalation ladder</span>
        <Pill tone={escalationStatusTone(escalation.status)}>{escalationStatusLabel(escalation.status)}</Pill>
        {escalation.resolved_by && <span className="text-11 text-faint">closed by {escalation.resolved_by}</span>}
      </div>

      {escalation.reason && <p className="border-b border-divider px-3.5 py-2.5 text-13 leading-snug text-text">{escalation.reason}</p>}

      <ol>
        {LADDER.map((level, i) => {
          const rungs = byLevel.get(level) ?? []
          const active = i === reachedIdx
          const past = i < reachedIdx
          const meta = LADDER_META[level]
          return (
            <li
              key={level}
              className={cn(
                'border-b border-divider px-3.5 py-2.5 last:border-b-0',
                active && 'bg-active',
                !active && !past && rungs.length === 0 && 'opacity-55',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-faint">
                  {level === 'RESPONDER' ? <LockIcon size={15} /> : level === 'EMERGENCY_CONTACT' ? <PhoneIcon size={15} /> : <CheckIcon size={15} color="#5d5f66" />}
                </span>
                <span className="text-13 font-medium text-text">{meta.label}</span>
                {level === 'EMERGENCY_CONTACT' && escalation.contact_name && (
                  <span className="text-12 text-muted">
                    {escalation.contact_name}
                    {escalation.contact_relation ? ` · ${escalation.contact_relation}` : ''}
                  </span>
                )}
                {active && <span className="ml-auto shrink-0 pill bg-accent-tint text-accent">here now</span>}
              </div>
              <p className="mt-0.5 pl-[23px] text-11 text-faint">{meta.who}</p>
              {rungs.length > 0 && <ul className="mt-1 pl-[23px]">{rungs.map((r, k) => <RungLine key={k} rung={r} />)}</ul>}
              {rungs.length === 0 && !past && !active && <p className="mt-1 pl-[23px] text-12 text-faint">Not reached.</p>}
            </li>
          )
        })}
      </ol>

      {closable && (
        <div className="border-t border-divider bg-strip px-3.5 py-3">
          {/* Closing an escalation needs a name for the same reason releasing a packet does: it is a
              person saying "I have accounted for them", and the record is worth nothing without
              knowing who. The backend refuses an empty name and its wording is shown as-is. */}
          <span className="label">Close this one</span>
          <p className="mt-1 text-12 leading-snug text-muted">
            Only if you know they are alright — you spoke to them, or somebody went round.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="field flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="your name"
              autoComplete="name"
            />
            <button type="button" className="btn-secondary" disabled={!name.trim() || busy} onClick={() => void resolve()}>
              {busy ? 'Closing…' : 'Accounted for'}
            </button>
          </div>
          {error && <p className="mt-1.5 text-12 text-rejected">{error}</p>}
        </div>
      )}
    </div>
  )
}
