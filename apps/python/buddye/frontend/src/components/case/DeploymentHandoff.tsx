import { Link } from 'react-router-dom'
import { ArrowRight, ShieldAlert, Siren } from 'lucide-react'
import { Badge, PriorityBadge, clampPriority } from '../ui/Badge'
import { buttonClass, cx } from '../ui/Button'
import { badgeTone } from './caseModel'
import {
  awaitingApproval,
  dispatchLabel,
  dispatchTone,
  etaText,
  incidentStatusLabel,
  incidentStatusTone,
  isAgency,
  isRolling,
  kindLabel,
  milesText,
  needsSentence,
} from '../../lib/operator'
import type { DispatchRow, IncidentDetail } from '../../types'

/**
 * The handoff: the call raised a deployment case, and a human has to decide about it.
 *
 * This is the hinge of the whole console — the moment the flow stops being about one person's
 * telephone and starts being about sending something to their door — so it is built to be the
 * loudest thing on the page and to have exactly one exit: the incident where the decision is made.
 *
 * **There is no approve button here, and there must never be one.** An agency unit — an ambulance,
 * a fire crew, a police welfare check — is only ever *prepared*: `requires_authorisation` on the
 * dispatch row is `app/domain/state.py::requires_authorisation` speaking, and the only path out of
 * PROPOSED runs through a named human on the Incidents screen. A case page that could send one
 * would put a 911 dispatch behind a button on a page about somebody's cat and their sticking front
 * door. So this component states the position in the console's own words — request, not sent — and
 * links away.
 */

export interface DeploymentHandoffProps {
  hazardId: string
  incidents: IncidentDetail[]
  /** Highlights the case that has just been raised by the call this page is watching. */
  freshIncidentId?: string | null
}

export function DeploymentHandoff({ hazardId, incidents, freshIncidentId }: DeploymentHandoffProps) {
  if (!incidents.length) return null
  return (
    <div className="space-y-3">
      {incidents.map((incident) => (
        <DeploymentCard
          key={incident.id}
          hazardId={hazardId}
          incident={incident}
          fresh={incident.id === freshIncidentId}
        />
      ))}
    </div>
  )
}

/**
 * The priority scale, drawn on the card itself.
 *
 * Keyed off the incident's own priority rather than hardcoded, because the badge in the header is
 * already stating that number: a P3 case painted in the P1 tint would put two different reds
 * meaning two different things on the same row, which is the one thing the priority tokens exist to
 * prevent. The card wears a colour only while somebody is being waited on.
 */
const PRIORITY_EDGE: Record<number, string> = {
  1: 'border-l-p1 bg-p1-tint/30',
  2: 'border-l-p2 bg-p2-tint/30',
  3: 'border-l-p3 bg-p3-tint/30',
  4: 'border-l-p4 bg-p4-tint/30',
  5: 'border-l-p5 bg-p5-tint/30',
}
const PRIORITY_INK: Record<number, string> = {
  1: 'text-p1', 2: 'text-p2', 3: 'text-p3', 4: 'text-p4', 5: 'text-p5',
}
const PRIORITY_TEXT: Record<number, string> = {
  1: 'text-p1-text', 2: 'text-p2-text', 3: 'text-p3-text', 4: 'text-p4-text', 5: 'text-p5-text',
}
const PRIORITY_BORDER: Record<number, string> = {
  1: 'border-p1/30', 2: 'border-p2/30', 3: 'border-p3/30', 4: 'border-p4/30', 5: 'border-p5/30',
}

function DeploymentCard({ hazardId, incident, fresh }: { hazardId: string; incident: IncidentDetail; fresh: boolean }) {
  const waiting = incident.dispatches.filter(awaitingApproval)
  const resolved = incident.status === 'RESOLVED' || incident.status === 'CLOSED'
  const priority = clampPriority(incident.priority)

  return (
    <section
      className={cx(
        'overflow-hidden rounded border bg-surface',
        waiting.length
          ? cx('border-border border-l-[3px]', PRIORITY_EDGE[priority])
          : resolved
            ? 'border-border'
            : 'border-border border-l-[3px] border-l-accent',
        fresh && 'animate-slideIn',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-divider px-4 py-2.5">
        <PriorityBadge priority={incident.priority} label={incident.priority_label} />
        <span className="text-14 font-semibold leading-tight text-text">Deployment case</span>
        <Badge tone={badgeTone(incidentStatusTone(incident.status))}>{incidentStatusLabel(incident.status)}</Badge>
        <span className="font-mono text-11 text-faint">{incident.id}</span>
        <Link
          to={`/hazards/${hazardId}/incidents/${incident.id}`}
          className={buttonClass({ variant: waiting.length ? 'primary' : 'secondary', size: 'sm' }, 'ml-auto')}
        >
          {waiting.length ? 'Decide on this' : 'Open the case'}
          <ArrowRight size={13} />
        </Link>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-13 leading-relaxed text-text">{incident.summary}</p>
        <p className="text-12 leading-snug text-muted">
          Needs {needsSentence(incident.needs)} at {incident.address}
          {incident.unit ? `, ${incident.unit}` : ''}.
        </p>

        {/* The safety property, said plainly and in the same words the rest of the console uses. */}
        {waiting.length ? (
          <div className={cx('flex items-start gap-2.5 rounded border bg-surface px-3.5 py-3', PRIORITY_BORDER[priority])}>
            <ShieldAlert size={17} className={cx('mt-0.5 shrink-0', PRIORITY_INK[priority])} aria-hidden="true" />
            <div className="min-w-0">
              <p className={cx('text-13 font-semibold leading-snug', PRIORITY_TEXT[priority])}>
                {waiting.length === 1 ? 'An agency unit is prepared and unsent' : `${waiting.length} agency units are prepared and unsent`}
              </p>
              <p className="mt-1 text-12 leading-relaxed text-text">
                Nobody has been asked and nothing has been sent. BuddyE cannot dispatch an agency unit; only a named
                person can, and they do it on the deployment case.
              </p>
            </div>
          </div>
        ) : null}

        {incident.dispatches.length ? (
          <ul className="divide-y divide-divider rounded border border-border">
            {incident.dispatches.map((d) => (
              <DispatchLine key={d.id} dispatch={d} priority={priority} />
            ))}
          </ul>
        ) : (
          <p className="text-12 text-muted">Nothing has been proposed for this address yet.</p>
        )}

        {incident.resolution ? <p className="text-12 leading-snug text-muted">{incident.resolution}</p> : null}
      </div>
    </section>
  )
}

/**
 * One unit against this address.
 *
 * Distance and ETA are mono because the server recomputes them as the vehicle moves, and a
 * proportional 1 is narrower than an 8 — a row that re-renders every few seconds would twitch.
 * Both numbers come from the API exactly as sent; nothing here computes a distance or advances a
 * position.
 */
function DispatchLine({ dispatch, priority }: { dispatch: DispatchRow; priority: number }) {
  const agency = isAgency(dispatch)
  const waiting = awaitingApproval(dispatch)
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
      {agency ? (
        <Siren size={13} className={waiting ? PRIORITY_INK[priority] : 'text-faint'} aria-hidden="true" />
      ) : null}
      <span className="font-mono text-12 font-medium text-text">{dispatch.call_sign}</span>
      <span className="text-12 text-muted">{kindLabel(dispatch.kind)}</span>
      <Badge tone={badgeTone(dispatchTone(dispatch))} size="sm">
        {dispatchLabel(dispatch)}
      </Badge>
      <span className="ml-auto flex items-center gap-2.5 font-mono text-12 tabular-nums text-muted">
        {dispatch.distance_miles ? <span>{milesText(dispatch.distance_miles)}</span> : null}
        {/* An ETA belongs to a unit that is still coming. Leaving it on a unit that has arrived
            reads as a countdown that never ended. */}
        {isRolling(dispatch) && dispatch.eta_minutes ? <span>{etaText(dispatch.eta_minutes)}</span> : null}
      </span>
      {dispatch.status_note ? (
        <p className="w-full text-12 leading-snug text-muted">{dispatch.status_note}</p>
      ) : null}
    </li>
  )
}
