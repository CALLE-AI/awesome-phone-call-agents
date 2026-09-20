import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, FileText, Lock } from 'lucide-react'
import { useHazard } from '../state/hazard'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Select } from '../components/ui/Field'
import { StatCard, StatRow } from '../components/ui/StatCard'
import { TBody, THead, Table, TableWrap, Td, Th, Tr, useSort } from '../components/ui/Table'
import { PacketSheet } from '../components/incident/PacketSheet'
import { decisionsCsv, decisionsFor, isHumanVerdict, verdictWord } from '../components/incident/ledger'
import type { DecisionRow, Verdict } from '../components/incident/ledger'
import type { BadgeTone } from '../components/ui/Badge'
import { fmtTime } from '../lib/utils'

/**
 * The record of what was decided.
 *
 * This page used to be the work queue, and it is not one any more: the deciding happens on
 * Incidents, next to the case it is about, where a coordinator can see what the call established
 * before she answers. What is left here is the more durable thing — the audit trail an emergency
 * programme is judged on afterwards.
 *
 * So it is built to read like a document rather than a dashboard. One chronological ledger, one row
 * per decision, and every row answers the same five questions in the same order: what was asked
 * for, by which agent and on what grounds, who decided, what they said, and what happened next.
 * There are no buttons on it that change anything.
 *
 * Three things it is careful about:
 *
 *  * **A denial is a decision.** "No, her daughter is already driving over" is an answer somebody
 *    gave and may be asked about a week later, so it is a first-class row with its reason attached,
 *    not an absence.
 *  * **Who decided is never blurred.** An agent committing a wellness van and a person authorising
 *    an ambulance are the same dispatch status and completely different facts. The verdict column
 *    keeps them apart by name.
 *  * **It is honest about what it does not know.** A request nobody has answered yet says so, in
 *    the same list, rather than being hidden until it becomes history.
 */

const VERDICT_TONE: Record<Verdict, BadgeTone> = {
  approved: 'verified',
  denied: 'neutral',
  auto: 'accent',
  waiting: 'rejected',
  proposed: 'partial',
  released: 'partial',
  prepared: 'neutral',
}

type ResourceFilter = 'all' | 'agency' | 'community' | 'handoff'
type VerdictFilter = 'all' | 'human' | Verdict

export default function Approvals() {
  const { incidents, packets, pending, operatorName, hazardId, refetch } = useHazard()

  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all')
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all')
  const [person, setPerson] = useState<string>('all')
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [packetId, setPacketId] = useState<string | null>(null)

  const sort = useSort<'at' | 'name' | 'resource' | 'verdict'>('at', 'desc')

  const rows = useMemo(() => decisionsFor(incidents, packets, pending), [incidents, packets, pending])

  const people = useMemo(() => Array.from(new Set(rows.map((r) => r.name))).sort(), [rows])

  const filtered = useMemo(() => {
    const kept = rows.filter((r) => {
      if (person !== 'all' && r.name !== person) return false
      if (resourceFilter === 'agency' && (!r.agency || r.kind === 'handoff')) return false
      if (resourceFilter === 'community' && r.agency) return false
      if (resourceFilter === 'handoff' && r.kind !== 'handoff') return false
      if (verdictFilter === 'human') return isHumanVerdict(r.verdict)
      if (verdictFilter !== 'all' && r.verdict !== verdictFilter) return false
      return true
    })
    return sort.sorted(kept, (r, key) =>
      key === 'at' ? r.at : key === 'name' ? r.name : key === 'resource' ? r.resource : verdictWord(r.verdict),
    )
  }, [rows, person, resourceFilter, verdictFilter, sort])

  const tally = useMemo(() => {
    const count = (v: Verdict) => rows.filter((r) => r.verdict === v).length
    return {
      approved: count('approved') + count('released'),
      denied: count('denied'),
      auto: count('auto'),
      waiting: count('waiting'),
    }
  }, [rows])

  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** The record as a file. Decisions only — no conditions, no medication, no access notes. */
  const download = useCallback(() => {
    const blob = new Blob([decisionsCsv(filtered)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `buddye-decisions-${hazardId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [filtered, hazardId])

  return (
    <>
      <p className="mb-3 max-w-[86ch] text-13 leading-relaxed text-muted">
        Every resource this programme committed tonight, and every one it was asked for and refused. Community resources —
        volunteers, water, rides, a wellness visit — an agent commits on its own. An ambulance, a fire engine or a police
        welfare check is only ever <em>requested</em>, and only by a named person. Decisions are made on{' '}
        <Link to={`/hazards/${hazardId}/incidents`}>Incidents</Link>; this page changes nothing.
      </p>

      <StatRow className="mb-3">
        <StatCard
          label="Approved by a person"
          value={tally.approved}
          tone="good"
          hint="Records carrying a person's name. One click can make two: authorising an agency unit also releases the packet behind it."
        />
        <StatCard label="Denied" value={tally.denied} hint="Refused, with a reason on the record." />
        <StatCard
          label="Committed by an agent"
          value={tally.auto}
          tone="accent"
          hint="Community resources. No authorisation needed and none claimed."
        />
        <StatCard
          label="Still waiting on a person"
          value={tally.waiting}
          tone={tally.waiting > 0 ? 'urgent' : 'default'}
          hint={tally.waiting > 0 ? 'Prepared, unsent, nobody has been asked.' : 'Nothing is unanswered.'}
        />
      </StatRow>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by decision"
          className="h-8 w-auto min-w-[168px]"
          value={verdictFilter}
          onChange={(e) => setVerdictFilter(e.target.value as VerdictFilter)}
        >
          <option value="all">Every decision</option>
          <option value="human">Decided by a person</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="auto">Committed by an agent</option>
          <option value="waiting">Waiting on a person</option>
          <option value="released">Handoff released</option>
        </Select>
        <Select
          aria-label="Filter by resource"
          className="h-8 w-auto min-w-[168px]"
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value as ResourceFilter)}
        >
          <option value="all">Every resource</option>
          <option value="agency">Agency units only</option>
          <option value="community">Community resources only</option>
          <option value="handoff">Responder handoffs</option>
        </Select>
        <Select
          aria-label="Filter by person"
          className="h-8 w-auto min-w-[168px]"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="all">Everybody</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <span className="font-mono text-12 tabular-nums text-faint">
          {filtered.length} of {rows.length}
        </span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          icon={<Download size={13} />}
          disabled={filtered.length === 0}
          onClick={download}
        >
          Export this view
        </Button>
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        {filtered.length === 0 ? (
          <EmptyState
            size="full"
            title={rows.length === 0 ? 'Nothing has been decided yet.' : 'Nothing matches these filters.'}
            body={
              rows.length === 0
                ? 'The first row appears the moment an agent commits a community resource or a person answers a request.'
                : undefined
            }
          />
        ) : (
          <TableWrap>
            {/* A minimum width so a narrow window scrolls the ledger sideways instead of wrapping
                "Ambulance R-15" over two lines. A record is read across, not down. */}
            <Table className="min-w-[900px]">
              <THead>
                <tr>
                  <Th sortable sortDirection={sort.directionFor('at')} onSort={() => sort.toggle('at')}>
                    When
                  </Th>
                  <Th sortable sortDirection={sort.directionFor('name')} onSort={() => sort.toggle('name')}>
                    Person
                  </Th>
                  <Th sortable sortDirection={sort.directionFor('resource')} onSort={() => sort.toggle('resource')}>
                    Resource
                  </Th>
                  <Th sortable sortDirection={sort.directionFor('verdict')} onSort={() => sort.toggle('verdict')}>
                    Decision
                  </Th>
                  <Th>Decided by</Th>
                  <Th>Afterwards</Th>
                </tr>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <DecisionRows
                    key={r.id}
                    r={r}
                    hazardId={hazardId}
                    open={open.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    onOpenPacket={r.kind === 'handoff' ? () => setPacketId(r.id) : undefined}
                  />
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </div>

      <p className="mt-4 px-1 pb-4 text-11 leading-relaxed text-faint">
        Approving an agency unit records that a named person decided to spend it. BuddyE does not dial 911, has no path
        into an agency dispatch system, and sends no message to anybody: the person whose name is on the row makes the
        call. Times are this machine's local clock; every row is kept whether or not the case it belongs to was closed.
      </p>

      {packetId ? (
        <PacketSheet
          packetId={packetId}
          captainName={operatorName}
          onClose={() => setPacketId(null)}
          onChanged={() => void refetch()}
        />
      ) : null}
    </>
  )
}

/**
 * One decision, and — when it is opened — the whole of it.
 *
 * Two `<tr>`s rather than a wide table: the grounds an agent gave and the sentence a person wrote
 * are prose, and prose squeezed into a table column is prose nobody reads.
 */
function DecisionRows({
  r,
  hazardId,
  open,
  onToggle,
  onOpenPacket,
}: {
  r: DecisionRow
  hazardId: string
  open: boolean
  onToggle: () => void
  onOpenPacket?: () => void
}) {
  return (
    <>
      <Tr interactive selected={open} onClick={onToggle}>
        <Td mono muted className="whitespace-nowrap">
          {fmtTime(r.at)}
          {r.undecided ? <span className="ml-1.5 font-sans text-11 text-faint">prepared</span> : null}
        </Td>
        {/* Name over address rather than beside it: at this column width an inline address wraps
            mid-street and the eye stops being able to run down the name column. */}
        <Td>
          <span className="block font-medium leading-tight text-text">{r.name}</span>
          {r.address ? <span className="block text-11 leading-tight text-muted">{r.address}</span> : null}
        </Td>
        <Td>
          <span className="inline-flex items-center gap-1.5">
            {r.agency ? <Lock size={11} className="shrink-0 text-faint" aria-hidden="true" /> : null}
            {r.resource}
          </span>
        </Td>
        <Td>
          <Badge tone={VERDICT_TONE[r.verdict]} size="sm">
            {verdictWord(r.verdict)}
          </Badge>
        </Td>
        <Td muted>{r.decidedBy || '—'}</Td>
        <Td muted>{r.after}</Td>
      </Tr>
      {open ? (
        <tr className="bg-strip">
          <td colSpan={6} className="px-3 py-3">
            <dl className="grid gap-x-8 gap-y-2 text-12 leading-snug sm:grid-cols-2">
              <Line label="Asked for by">
                {r.requestedBy}
                {r.agency ? ' — and held at PROPOSED until a person answered' : ''}
              </Line>
              <Line label="Priority">
                {r.priority ? `P${r.priority} ${r.priorityLabel}` : 'not set'}
              </Line>
              <Line label="On what grounds" wide>
                {r.basis || 'No justification recorded against this request.'}
              </Line>
              <Line label="They said" wide>
                {r.said || (isHumanVerdict(r.verdict) ? 'Nothing written down.' : 'No decision has been taken yet.')}
              </Line>
              <Line label="Afterwards">{r.after}</Line>
              <Line label="Recorded at">
                <span className="font-mono">{r.at}</span>
              </Line>
            </dl>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {r.incidentId ? (
                <Link
                  to={`/hazards/${hazardId}/incidents/${r.incidentId}`}
                  className="rounded border border-edge bg-surface px-2.5 py-1 text-12 no-underline hover:bg-strip"
                >
                  Open the case
                </Link>
              ) : null}
              <Link
                to={`/hazards/${hazardId}/sweep/${r.neighbourId}`}
                className="rounded border border-edge bg-surface px-2.5 py-1 text-12 no-underline hover:bg-strip"
              >
                {r.name}'s case page
              </Link>
              {onOpenPacket ? (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FileText size={13} />}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenPacket()
                  }}
                >
                  Read the packet
                </Button>
              ) : null}
              <span className="ml-auto font-mono text-11 text-faint">{r.id}</span>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Line({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="label">{label}</dt>
      <dd className="mt-0.5 text-text">{children}</dd>
    </div>
  )
}
