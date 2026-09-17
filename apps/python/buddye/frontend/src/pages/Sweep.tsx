import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, ChevronRight, ClipboardList } from 'lucide-react'
import { useHazard } from '../state/hazard'
import { buildBoard } from '../lib/board'
import type { BoardPerson } from '../lib/board'
import { bandLabel, bandTone, outcomeLabel, outcomeTone, phaseIsLive, phaseLabel } from '../lib/status'
import { fmtClock } from '../lib/utils'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { StatCard, StatRow } from '../components/ui/StatCard'
import { TBody, THead, Table, TableWrap, Td, Th, Tr } from '../components/ui/Table'
import { badgeTone, GROUP_LABEL, groupOf, sweepOrder, topReason, waitingOn } from '../components/case/caseModel'
import type { SweepGroup } from '../components/case/caseModel'

/**
 * The catalogue: everybody under watch tonight, one case each.
 *
 * This is not a dashboard and it is not a list of calls. It is the set of *people* the evening is
 * about, ordered by who most needs a human to do something, and every row opens that person's case.
 *
 * Three decisions worth defending.
 *
 * **The order is the argument.** An unanswered telephone at a critical-band house sits above an
 * alarming call that was actually answered, because the answered call at least has a voice on the
 * record to weigh; silence at that address has nothing. That judgement already exists in
 * `lib/board.ts::attentionRank` and is reused rather than restated, so this screen and the console's
 * other views cannot come to disagree about who is worst off.
 *
 * **Somebody who opted out is on the list.** They are shown, marked, sorted to the bottom, and
 * never dialled. Dropping them would be tidier and would quietly turn a person's decision into an
 * absence — and an absence is the kind of thing somebody corrects by ringing them.
 *
 * **It fetches nothing.** The roster, the live calls, the ladder and the deployment cases are all
 * already on the layout's single SSE connection and its REST rows. A second fetch here would be a
 * second version of the truth on the same screen.
 */

type Filter = SweepGroup | 'all' | 'attention'

/** The four buckets that need a human, collapsed into the one number the tile shows. */
const ATTENTION: SweepGroup[] = ['unreachable_high', 'urgent', 'unreachable', 'needs_help']

export default function Sweep() {
  const { hazardId, roster, stream, escalations, packets, incidents, hazard } = useHazard()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')

  const board = useMemo(
    () => sweepOrder(buildBoard(roster, stream, escalations, packets)),
    [roster, stream, escalations, packets],
  )

  const counts = useMemo(() => {
    const out: Record<string, number> = { attention: 0, calling: 0, waiting: 0, settled: 0, opted_out: 0 }
    for (const person of board) {
      const group = groupOf(person)
      if (ATTENTION.includes(group)) out.attention += 1
      else out[group] = (out[group] ?? 0) + 1
    }
    return out
  }, [board])

  const rows = useMemo(() => {
    if (filter === 'all') return board
    if (filter === 'attention') return board.filter((p) => ATTENTION.includes(groupOf(p)))
    return board.filter((p) => groupOf(p) === filter)
  }, [board, filter])

  // Clicking the tile you are already filtered by goes back to everybody: the fastest way out of a
  // filter is the control that put you in it.
  const toggle = (next: Filter) => setFilter((current) => (current === next ? 'all' : next))

  return (
    <div className="space-y-4">
      <StatRow>
        <StatCard
          label="Need a human"
          value={counts.attention}
          unit={`of ${board.length}`}
          tone={counts.attention ? 'urgent' : 'default'}
          hint="No answer, urgent, or waiting on help they accepted"
          onClick={() => toggle('attention')}
        />
        <StatCard
          label="On the phone"
          value={counts.calling}
          tone={counts.calling ? 'accent' : 'default'}
          hint="A call is on the line right now"
          onClick={() => toggle('calling')}
        />
        <StatCard
          label="Not called yet"
          value={counts.waiting}
          tone={counts.waiting ? 'attention' : 'default'}
          hint="Nobody has rung them tonight"
          onClick={() => toggle('waiting')}
        />
        <StatCard
          label="Spoken to, alright"
          value={counts.settled}
          tone={counts.settled ? 'good' : 'default'}
          hint="Answered and nothing outstanding"
          onClick={() => toggle('settled')}
        />
      </StatRow>

      <section className="overflow-hidden rounded border border-border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-divider bg-strip px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="label truncate">
              {filter === 'all' ? 'Everybody under watch' : filter === 'attention' ? 'Waiting on a human' : GROUP_LABEL[filter]}
            </h2>
            <p className="mt-1 truncate text-12 text-muted">
              {hazard ? hazard.headline : 'Ordered by who needs somebody most.'}
            </p>
          </div>
          {filter !== 'all' ? (
            <button type="button" onClick={() => setFilter('all')} className="text-12 text-accent underline underline-offset-2">
              show everybody
            </button>
          ) : null}
        </header>

        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={18} />}
            title="Nobody in this bucket"
            body="Nothing is wrong — there is simply no one in this state right now."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Person</Th>
                  <Th>Risk</Th>
                  <Th>Why they are on this list</Th>
                  <Th>Where the call got to</Th>
                  <Th>Waiting on</Th>
                  <Th className="w-8" />
                </tr>
              </THead>
              <TBody>
                {rows.map((person, i) => {
                  const group = groupOf(person)
                  const newGroup = i === 0 || groupOf(rows[i - 1]) !== group
                  return (
                    <PersonRow
                      key={person.n.id}
                      person={person}
                      group={group}
                      showGroupHeader={newGroup && filter === 'all'}
                      waiting={waitingOn(person.n.id, incidents, packets, escalations)}
                      onOpen={() => navigate(`/hazards/${hazardId}/sweep/${person.n.id}`)}
                    />
                  )
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </section>
    </div>
  )
}

function PersonRow({
  person,
  group,
  showGroupHeader,
  waiting,
  onOpen,
}: {
  person: BoardPerson
  group: SweepGroup
  showGroupHeader: boolean
  waiting: ReturnType<typeof waitingOn>
  onOpen: () => void
}) {
  const { n } = person
  const optedOut = group === 'opted_out'
  const live = !!person.call && phaseIsLive(person.call.phase)

  return (
    <>
      {showGroupHeader ? (
        <tr className="bg-strip">
          <td colSpan={6} className="px-3 py-1.5">
            <span className="label">{GROUP_LABEL[group]}</span>
          </td>
        </tr>
      ) : null}
      {/* The row is the link. Reachable by keyboard because this console gets driven at speed with
          one hand when something is going wrong. */}
      <Tr
        interactive
        onClick={onOpen}
        tabIndex={0}
        aria-label={`Open the case for ${n.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen()
          }
        }}
      >
        <Td className="max-w-[220px]">
          <div className="truncate text-13 font-medium text-text">{n.name}</div>
          <div className="truncate text-12 text-muted">
            {n.address}
            {n.unit ? `, ${n.unit}` : ''}
          </div>
        </Td>

        <Td className="whitespace-nowrap">
          <Badge tone={badgeTone(bandTone(n.risk?.band))} size="sm">
            {bandLabel(n.risk?.band)}
          </Badge>
        </Td>

        {/* One sentence, the heaviest factor triage found. The case page shows all of them. */}
        <Td className="max-w-[380px] text-muted">
          <span className="line-clamp-2 leading-snug">{topReason(n.risk)}</span>
        </Td>

        <Td>
          {optedOut ? (
            <span className="inline-flex items-center gap-1.5 text-12 text-muted">
              <BellOff size={12} aria-hidden="true" /> Opted out — never dialled
            </span>
          ) : live && person.call ? (
            <Badge tone="accent" size="sm" dot pulse>
              {phaseLabel(person.call.phase)}
            </Badge>
          ) : person.outcome ? (
            <div className="flex items-center gap-2">
              <Badge tone={badgeTone(outcomeTone(person.outcome))} size="sm">
                {outcomeLabel(person.outcome)}
              </Badge>
              {n.last_call_at ? (
                <span className="font-mono text-11 tabular-nums text-faint">{fmtClock(n.last_call_at)}</span>
              ) : null}
            </div>
          ) : (
            <span className="text-12 text-muted">{person.notDialledReason ?? 'Not called yet'}</span>
          )}
        </Td>

        <Td className="max-w-[260px]">
          {waiting ? (
            <span
              className={
                waiting.human
                  ? 'text-12 font-medium leading-snug text-rejected'
                  : 'text-12 leading-snug text-muted'
              }
            >
              {waiting.text}
            </span>
          ) : (
            <span className="text-12 text-faint">—</span>
          )}
        </Td>

        <Td className="text-faint">
          <ChevronRight size={14} aria-hidden="true" />
        </Td>
      </Tr>
    </>
  )
}
