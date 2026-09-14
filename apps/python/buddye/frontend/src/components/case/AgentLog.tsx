import { Bot, CornerDownRight } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { actionLabel, eventDetail, eventLabel } from './caseModel'
import type { CaseAction, CaseEvent } from './caseApi'
import { fmtClock } from '../../lib/utils'

/**
 * What the agents working this case decided, and whether a person agreed with them.
 *
 * `OperatorAction` is the only record in BuddyE that carries an agent's reasoning, so this is where
 * a coordinator finds out *why* a particular van was chosen at half past eight — the model, the
 * rationale in the agent's own words, how long it took, and the one column that matters most:
 * whether a human has looked at it.
 *
 * That column is three-state and is rendered as three states. `null` means nobody has reviewed the
 * proposal yet; `false` means a named person turned it down. An agent can never write either value
 * (see `app/agents/client.py`), which is what makes the column worth reading at all — so it is
 * never softened into "pending" when it means "a person said no".
 */

export function AgentDecisions({ actions }: { actions: CaseAction[] }) {
  if (!actions.length) {
    return (
      <EmptyState
        icon={<Bot size={18} />}
        title="No agent has had to decide anything yet"
        body="Agents record a row here when they choose a unit, write a brief or draft a message about this person."
      />
    )
  }
  return (
    <ul className="divide-y divide-divider">
      {actions.map((action) => (
        <li key={action.id} className="px-4 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="text-13 font-medium text-text">{actionLabel(action.kind)}</span>
            <Badge tone="outline" size="sm">
              {action.agent}
            </Badge>
            {action.model ? <span className="font-mono text-11 text-faint">{action.model}</span> : null}
            <span className="ml-auto flex items-center gap-2">
              {action.latency_ms != null ? (
                <span className="font-mono text-11 tabular-nums text-faint">{(action.latency_ms / 1000).toFixed(1)}s</span>
              ) : null}
              <span className="font-mono text-11 tabular-nums text-faint">{fmtClock(action.created_at)}</span>
            </span>
          </div>

          {action.rationale ? (
            <p className="mt-1.5 text-13 leading-relaxed text-muted">{action.rationale}</p>
          ) : null}
          {action.error ? <p className="mt-1.5 text-12 leading-snug text-rejected">{action.error}</p> : null}

          <div className="mt-2">
            {action.accepted === true ? (
              <Badge tone="verified" size="sm">
                Accepted by {action.accepted_by || 'a person'}
              </Badge>
            ) : action.accepted === false ? (
              <Badge tone="rejected" size="sm">
                Turned down by {action.accepted_by || 'a person'}
              </Badge>
            ) : (
              <Badge tone="neutral" size="sm">
                No person has reviewed this yet
              </Badge>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

/**
 * The evening, as it happened to this person.
 *
 * Filtered, and the filter is the point. The raw timeline for somebody with a van on the way is
 * mostly `asset.moved` — a position update every few seconds, which belongs on the map and nowhere
 * near a log a tired person reads. What is left is the story: rung, answered, decided, escalated, a
 * case opened, a unit proposed.
 */
export function CaseTimeline({ events }: { events: CaseEvent[] }) {
  if (!events.length) {
    return <EmptyState title="Nothing has happened to this case yet" body="Events land here the moment BuddyE acts." />
  }
  return (
    <ol className="space-y-2">
      {events.map((ev) => {
        const detail = eventDetail(ev)
        return (
          <li key={ev.id} className="flex gap-2.5">
            <span className="w-[52px] shrink-0 pt-px text-right font-mono text-11 tabular-nums text-faint">
              {fmtClock(ev.at)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-13 leading-snug text-text">{eventLabel(ev.type)}</p>
              {detail ? (
                <p className="mt-0.5 flex gap-1 text-12 leading-snug text-muted">
                  <CornerDownRight size={12} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                  <span className="min-w-0">{detail}</span>
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
