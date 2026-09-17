import { LivePill, Pill } from './Pill'
import { BoltIcon, ChevronIcon, PhoneIcon, PhoneMissedIcon } from './Icons'
import { cn, fmtTimeToHarm } from '../lib/utils'
import { bandLabel, bandTone, outcomeLabel, outcomeTone, phaseIsLive, phaseLabel, phaseTone } from '../lib/status'
import type { BoardPerson } from '../lib/board'

/** The reasons triage gave, in plain English. A bare score is never shown anywhere in this UI. */
function Reasons({ reasons, limit = 2 }: { reasons: string[] | undefined; limit?: number }) {
  if (!reasons?.length) return null
  const shown = reasons.slice(0, limit)
  return (
    <ul className="mt-1.5 space-y-0.5">
      {shown.map((r, i) => (
        <li key={i} className="flex gap-1.5 text-12 leading-snug text-muted">
          <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
          <span>{r}</span>
        </li>
      ))}
      {reasons.length > limit && <li className="pl-[9px] text-11 text-faint">+{reasons.length - limit} more</li>}
    </ul>
  )
}

function LiveOrOutcome({ p }: { p: BoardPerson }) {
  if (p.call && phaseIsLive(p.call.phase)) {
    return <LivePill tone={phaseTone(p.call.phase)}>{phaseLabel(p.call.phase)}</LivePill>
  }
  if (p.outcome) return <Pill tone={outcomeTone(p.outcome)}>{outcomeLabel(p.outcome)}</Pill>
  if (p.notDialledReason) return <Pill tone="grey">Not called</Pill>
  return <Pill tone="grey">Waiting</Pill>
}

/**
 * A card in the "needs you now" stack.
 *
 * This is the only list view that shows a health fact, and it shows exactly one: whether the person
 * depends on wall power, and only while the hazard cuts it. That is the Walter case — during a
 * blackout it is not a detail about him, it is the reason she should drive to his house first — and
 * it is the difference between a list she can act on and a list she has to open fourteen times.
 */
export function AttentionCard({
  p,
  showPower,
  onOpen,
  onOpenPacket,
}: {
  p: BoardPerson
  showPower: boolean
  onOpen: () => void
  onOpenPacket?: () => void
}) {
  const urgent = p.outcome === 'URGENT' || p.outcome === 'UNREACHABLE'
  const hours = fmtTimeToHarm(p.n.risk?.time_to_harm_h)
  const quote = p.lastWords || p.concerns[0] || ''
  const packet = p.packet && !p.packet.released ? p.packet : null

  return (
    <article className={cn(urgent ? 'card-urgent' : 'card-attention', 'overflow-hidden')}>
      <button type="button" onClick={onOpen} className="block w-full px-4 py-3 text-left">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-15 font-semibold text-text">{p.n.name}</span>
              <Pill tone={bandTone(p.n.risk?.band)}>{bandLabel(p.n.risk?.band)}</Pill>
              {showPower && p.n.power_dependent && (
                <span className="pill gap-1 bg-rejected-tint text-rejected">
                  <BoltIcon size={12} />
                  Runs on wall power
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <LiveOrOutcome p={p} />
              {hours && <span className="text-12 text-muted">In trouble within {hours}</span>}
            </div>
          </div>
          <span className="mt-1 shrink-0 text-faint">
            <ChevronIcon size={16} />
          </span>
        </div>

        {p.reason && <p className="mt-2 text-13 leading-snug text-text">{p.reason}</p>}
        {quote && (
          <blockquote className="mt-2 border-l-2 border-edge pl-2.5 text-13 italic leading-snug text-muted">“{quote}”</blockquote>
        )}
        {!quote && p.outcome === 'UNREACHABLE' && <Reasons reasons={p.n.risk?.reasons} />}
      </button>

      {(packet || p.escalation) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-divider bg-surface/70 px-4 py-2">
          {p.escalation && (
            <span className="text-11 text-muted">
              Escalation open · {p.escalation.rungs.length} rung{p.escalation.rungs.length === 1 ? '' : 's'} tried
            </span>
          )}
          {packet && onOpenPacket && (
            <button type="button" className="btn-secondary ml-auto h-8 min-h-0 py-0 text-12" onClick={onOpenPacket}>
              Responder packet ready — you decide
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** A compact roster row. Name, band, reasons, outcome. No addresses, no conditions. */
export function RosterRow({ p, onOpen }: { p: BoardPerson; onOpen: () => void }) {
  const live = p.call && phaseIsLive(p.call.phase)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-start gap-3 border-b border-divider px-4 py-3 text-left last:border-b-0 hover:bg-active',
        live && 'bg-active',
      )}
    >
      <span className="mt-0.5 shrink-0 text-faint">
        {p.outcome === 'UNREACHABLE' ? <PhoneMissedIcon size={16} /> : <PhoneIcon size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-14 font-medium text-text">{p.n.name}</span>
          <Pill tone={bandTone(p.n.risk?.band)}>{bandLabel(p.n.risk?.band)}</Pill>
        </span>
        <Reasons reasons={p.n.risk?.reasons} limit={1} />
        {p.reason && <span className="mt-1 block text-12 leading-snug text-muted">{p.reason}</span>}
      </span>
      <span className="shrink-0">
        <LiveOrOutcome p={p} />
      </span>
    </button>
  )
}

/** The quiet block. Reassurance is the whole job here, so it stays small and green. */
export function SafeRow({ p, onOpen }: { p: BoardPerson; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-active"
    >
      <span className="text-13 text-text">{p.n.name}</span>
      {p.outcome === 'HELP_DECLINED' && <span className="text-11 text-faint">turned help down</span>}
    </button>
  )
}
