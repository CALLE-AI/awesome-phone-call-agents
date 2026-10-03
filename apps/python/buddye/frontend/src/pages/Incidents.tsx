import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Lock, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useHazard } from '../state/hazard'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { CaseCard } from '../components/incident/CaseCard'
import { PacketSheet } from '../components/incident/PacketSheet'
import { caseIsOpen } from '../components/incident/labels'
import { incidentOrder, isAgency } from '../lib/operator'
import type { IncidentRow } from '../types'

/**
 * Where a human decides.
 *
 * A call ends and, within seconds, a deployment case is raised from it — from what the person said,
 * or from the fact that nobody answered, which for somebody on this roster is the stronger signal
 * of the two. Every one of those cases lands here, worst first, and this is the only screen in the
 * console with approve and deny on it.
 *
 * The route carries `:incidentId` when a notification or a case page sent the coordinator here to
 * decide one specific thing. That case is expanded and scrolled to on arrival, and — this is the
 * part worth being careful about — it is shown **whatever the current filter says**. Being sent to
 * decide something and landing on a page that does not contain it is the one failure this screen
 * cannot have.
 *
 * What is deliberately absent: any suggestion that BuddyE can send an agency unit. An ambulance, a
 * fire engine or a police welfare check is prepared, routed, timed and justified by an agent, and
 * then it sits at PROPOSED — visible, unsent, and waiting for a person's name. That rule lives in
 * `app/domain/state.py::requires_authorisation`, and every word on this page is written to it.
 */

type Filter = 'waiting' | 'open' | 'closed' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'waiting', label: 'Waiting on you' },
  { key: 'open', label: 'Open' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

function isWaiting(i: IncidentRow): boolean {
  return i.dispatches.some((d) => d.status === 'PROPOSED' && isAgency(d))
}

function matches(i: IncidentRow, filter: Filter): boolean {
  switch (filter) {
    case 'waiting':
      return isWaiting(i)
    case 'open':
      return caseIsOpen(i.status)
    case 'closed':
      return !caseIsOpen(i.status)
    case 'all':
      return true
  }
}

export default function Incidents() {
  const { incidentId } = useParams<{ incidentId: string }>()
  const { incidents, packets, escalations, pending, operatorName, hazardId, refetch, setError } = useHazard()

  const [filter, setFilter] = useState<Filter>('open')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [packetId, setPacketId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const cards = useRef(new Map<string, HTMLElement>())
  const scrolledFor = useRef<string | null>(null)

  const ordered = useMemo(() => [...incidents].sort(incidentOrder), [incidents])
  const waitingCount = useMemo(() => ordered.filter(isWaiting).length, [ordered])
  const openCount = useMemo(() => ordered.filter((i) => caseIsOpen(i.status)).length, [ordered])

  /** The deep-linked case is always visible, whatever the filter is set to. */
  const shown = useMemo(
    () => ordered.filter((i) => matches(i, filter) || i.id === incidentId),
    [ordered, filter, incidentId],
  )

  /** Justifications the backend already computed for the agency requests. */
  const pendingJustification = useMemo(
    () => new Map(pending.map((p) => [p.id, p.justification])),
    [pending],
  )

  /**
   * The responder packet behind a case, if the ladder prepared one.
   *
   * Incident -> escalation -> packet, with a fall back to the neighbour's own escalation for cases
   * opened straight off a call rather than through the ladder.
   */
  const packetFor = useCallback(
    (incident: IncidentRow): string | null => {
      const escalationId =
        incident.escalation_id || escalations.find((e) => e.neighbour_id === incident.neighbour_id)?.id
      if (!escalationId) return null
      return packets.find((p) => p.escalation_id === escalationId)?.id ?? null
    },
    [escalations, packets],
  )

  // Arriving on a deep link: open that case. Left in whatever state the coordinator puts it in
  // afterwards — this expands, it does not collapse anything she opened herself.
  useEffect(() => {
    if (!incidentId) return
    setExpanded((prev) => (prev.has(incidentId) ? prev : new Set(prev).add(incidentId)))
  }, [incidentId])

  /**
   * Put the deep-linked case under the coordinator's eyes, and keep it there.
   *
   * Two things make this harder than one `scrollIntoView`. The row is not in `incidents` on the
   * first render — `HazardLayout` clears its rows and refetches on a hazard change — so the effect
   * has to run again when the row appears. And the case *expands* a beat after it arrives, which
   * grows the page underneath a scroll that has already been computed: scrolling once, on arrival,
   * left the card three hundred pixels below the fold.
   *
   * So it re-checks rather than latching: if the card is already sitting in the top band it does
   * nothing, and otherwise it scrolls again. `scroll-mt-14` on the card keeps it clear of the
   * shell's sticky header.
   */
  useEffect(() => {
    if (!incidentId) {
      scrolledFor.current = null
      return
    }
    const el = cards.current.get(incidentId)
    if (!el) return
    const top = el.getBoundingClientRect().top
    if (scrolledFor.current === incidentId && top >= -8 && top <= 140) return
    scrolledFor.current = incidentId
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [incidentId, shown, expanded])

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const sync = async () => {
    setSyncing(true)
    try {
      await api.syncIncidents(hazardId)
      await refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSyncing(false)
    }
  }

  const missing = !!incidentId && incidents.length > 0 && !incidents.some((i) => i.id === incidentId)

  return (
    <>
      {/* The one thing on this page that is allowed to shout, and only when it is true. */}
      {waitingCount > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-p1/40 bg-p1-tint px-3.5 py-2.5">
          <Lock size={14} className="shrink-0 text-p1-text" aria-hidden="true" />
          <p className="min-w-[260px] flex-1 text-13 leading-snug text-p1-text">
            <strong className="font-semibold">
              {waitingCount} agency request{waitingCount === 1 ? '' : 's'} prepared and waiting on a person.
            </strong>{' '}
            Nothing has been sent and no agency has been contacted.
          </p>
          {filter !== 'waiting' ? (
            <Button size="sm" variant="secondary" onClick={() => setFilter('waiting')}>
              Show just those
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter cases">
          {FILTERS.map((f) => {
            const count =
              f.key === 'waiting'
                ? waitingCount
                : f.key === 'open'
                  ? openCount
                  : f.key === 'closed'
                    ? incidents.length - openCount
                    : incidents.length
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={active}
                className={`rounded border px-2.5 py-1 text-12 transition-colors ${
                  active
                    ? 'border-text bg-text text-surface'
                    : 'border-edge bg-surface text-muted hover:bg-strip hover:text-text'
                }`}
              >
                {f.label} <span className="font-mono tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto" loading={syncing} onClick={() => void sync()}>
          {syncing ? 'Reconciling…' : 'Reconcile with the ladder'}
        </Button>
      </div>

      {missing ? (
        <p className="mb-3 rounded border border-border bg-surface px-3.5 py-2.5 text-13 leading-snug text-muted">
          Case <span className="font-mono text-12">{incidentId}</span> is not on this hazard's board. It may belong to an
          earlier hazard, or the sweep that raised it has been reset.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="rounded border border-border bg-surface">
          <EmptyState
            size="full"
            icon={<ShieldCheck size={22} />}
            title={
              filter === 'waiting'
                ? 'Nothing is waiting on you.'
                : incidents.length === 0
                  ? 'No deployment cases yet.'
                  : 'Nothing matches this filter.'
            }
            body={
              filter === 'waiting'
                ? 'No agency unit has been requested. Community resources an agent commits on its own appear under Open.'
                : incidents.length === 0
                  ? 'A case is raised the moment a call is understood — from what the person said, or from nobody answering.'
                  : undefined
            }
            action={
              filter !== 'all' && incidents.length > 0 ? (
                <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                  Show all {incidents.length}
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {shown.map((i) => {
            const packet = packetFor(i)
            return (
              <CaseCard
                key={i.id}
                incident={i}
                expanded={expanded.has(i.id)}
                highlighted={i.id === incidentId}
                onToggle={() => toggle(i.id)}
                operatorName={operatorName}
                pendingJustification={pendingJustification}
                onOpenPacket={packet ? () => setPacketId(packet) : undefined}
                onChanged={() => void refetch()}
                cardRef={(el) => {
                  if (el) cards.current.set(i.id, el)
                  else cards.current.delete(i.id)
                }}
              />
            )
          })}
        </div>
      )}

      <p className="mt-4 px-1 pb-4 text-11 leading-relaxed text-faint">
        BuddyE cannot dial 911 and has no path into an agency dispatch system. Approving an ambulance, a fire engine or a
        police welfare check records that a named person decided to spend that unit; that person makes the call, with the
        packet in front of them. Every decision here, and every denial, is kept on{' '}
        <Link to={`/hazards/${hazardId}/approvals`}>Approvals</Link>.
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
