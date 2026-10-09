import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Phone } from 'lucide-react'
import { useHazard } from '../state/hazard'
import { Badge } from '../components/ui/Badge'
import { EmptyState } from '../components/ui/EmptyState'
import { Panel } from '../components/ui/Panel'
import { bandLabel, bandTone, outcomeLabel, outcomeTone } from '../lib/status'
import { AgentDecisions, CaseTimeline } from '../components/case/AgentLog'
import { CallLauncher } from '../components/case/CallLauncher'
import { CallPanel } from '../components/case/CallPanel'
import { SituationBriefCard } from '../components/case/SituationBrief'
import { useSituationBrief } from '../hooks/useSituationBrief'
import { EmergencyContact, LadderPanel, WhoTheyAre, WhyAtRisk } from '../components/case/CaseIdentity'
import { DeploymentHandoff } from '../components/case/DeploymentHandoff'
import { CaseApiError, fetchCase, launchCall } from '../components/case/caseApi'
import type { CasePayload } from '../components/case/caseApi'
import { LOGGED_EVENTS, badgeTone, fieldEvidence, ownCalls, reconcileMeta } from '../components/case/caseModel'
import { incidentIsOpen } from '../lib/operator'

/**
 * One person's case — the page a coordinator lives on while something is happening to them.
 *
 * The whole flow narrows to this screen: a notification lands, it opens here, a call goes out from
 * here, what the person said is understood here, and the deployment that comes out of it is handed
 * off from here to the human who approves it. So the page is arranged in that order and not in the
 * order the data arrives — the handoff sits directly under the name, above everything else, because
 * it is the only thing on the page that somebody else is waiting on.
 *
 * **Two sources, and both are needed.** `GET /api/cases/...` returns the durable case in one
 * response — the calls, the decisions, the ladder, the agent log, the deployment. The layout's
 * single SSE connection carries what is happening right now: the ringing, the turns landing one at
 * a time, the outcome being decided seconds after the line drops. This page reads both and never
 * opens a connection of its own.
 *
 * **It cannot send anything.** The only write on this screen is the telephone. An agency unit
 * raised by a call is shown here as prepared and unsent, with a link to the incident where a named
 * human decides — see `DeploymentHandoff`.
 */

/** The events that mean the stored case is now out of date. Movement updates are not among them. */
const REFRESH_ON = new Set([
  'call.started',
  'call.completed',
  'call.failed',
  'call.skipped',
  'check.decided',
  'reconcile.finished',
  'escalation.opened',
  'escalation.rung',
  'handoff.prepared',
  'handoff.released',
  'incident.opened',
  'dispatch.proposed',
  'dispatch.committed',
  'dispatch.awaiting_authorisation',
  'dispatch.authorised',
  'dispatch.declined',
  'dispatch.arrived',
])

export default function CasePage() {
  const { hazardId, roster, stream, operatorName } = useHazard()
  const { neighbourId } = useParams<{ neighbourId: string }>()

  const [payload, setPayload] = useState<CasePayload | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)

  /**
   * The stream's high-water mark when this page opened, so "just now" means since you got here.
   *
   * Read through a ref rather than a dependency: the value has to be sampled once, when the case
   * opens, and putting `stream` in that effect's deps would resample it on every event and make
   * "raised just now" permanently true.
   */
  const lastEventIdRef = useRef(stream.lastEventId)
  lastEventIdRef.current = stream.lastEventId
  const openedAt = useRef(0)

  /**
   * Which case this page is currently showing.
   *
   * Two effects fetch — the one that runs when the person changes, and the one that re-reads after
   * the stream reports something — and the second has no abort signal, so a fetch issued for Rosa
   * can land after somebody has already clicked through to Walter. Checking the key before writing
   * state is what stops Rosa's calls, risk and `can_call` from appearing under Walter's name. Same
   * pattern as `HazardLayout.refetch`.
   */
  const wantedRef = useRef<string>('')

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!hazardId || !neighbourId) return
      const key = `${hazardId}:${neighbourId}`
      try {
        const data = await fetchCase(hazardId, neighbourId, signal)
        if (signal?.aborted || wantedRef.current !== key) return
        setPayload(data)
        setLoadError(null)
      } catch (err) {
        if (signal?.aborted || wantedRef.current !== key) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        setLoadError(err instanceof Error ? err.message : String(err))
      }
    },
    [hazardId, neighbourId],
  )

  // A different person is a different case: drop the old one rather than showing Rosa's calls under
  // Walter's name for the beat before the fetch lands.
  useEffect(() => {
    const controller = new AbortController()
    setPayload(null)
    setLaunchError(null)
    wantedRef.current = `${hazardId}:${neighbourId}`
    openedAt.current = lastEventIdRef.current
    void load(controller.signal)
    return () => controller.abort()
  }, [load, hazardId, neighbourId])

  /**
   * Re-read the case when the stream says something happened to *this* person.
   *
   * Keyed on the id of the newest relevant event rather than on the event array, so a hundred
   * `asset.moved` updates from a van on its way to the address do not each trigger a fetch.
   */
  const relevantCursor = useMemo(() => {
    let last = 0
    for (const ev of stream.events) {
      if (ev.neighbour_id === neighbourId && REFRESH_ON.has(ev.type)) last = ev.id
    }
    return last
  }, [stream.events, neighbourId])

  useEffect(() => {
    if (!relevantCursor) return
    void load()
  }, [relevantCursor, load])

  // ---------------------------------------------------------------------------------------------
  // What the two sources say between them
  // ---------------------------------------------------------------------------------------------
  const rosterRow = roster.find((n) => n.id === neighbourId) ?? null
  const neighbour = payload?.neighbour ?? rosterRow
  const calls = useMemo(
    () => (neighbourId ? ownCalls(payload?.calls ?? [], stream, neighbourId) : []),
    [payload, stream, neighbourId],
  )
  const latest = calls.length ? calls[calls.length - 1] : null
  const live = !!latest?.live

  // The dial is accepted long before the phone is answered, so the button stays busy until the
  // stream shows a call actually on the line.
  useEffect(() => {
    if (live) setLaunching(false)
  }, [live])

  const onLaunch = useCallback(async () => {
    if (!hazardId || !neighbourId) return
    setLaunching(true)
    setLaunchError(null)
    try {
      await launchCall(hazardId, neighbourId, operatorName)
    } catch (err) {
      setLaunching(false)
      // The backend's own sentence: no consent, not allowlisted, budget spent, already ringing.
      setLaunchError(err instanceof CaseApiError ? err.message : err instanceof Error ? err.message : String(err))
    }
  }, [hazardId, neighbourId, operatorName])

  /** A deployment case raised since this page opened — the one the flow just handed over. */
  const freshIncidentId = useMemo(() => {
    let id: string | null = null
    for (const ev of stream.events) {
      if (ev.type !== 'incident.opened' || ev.neighbour_id !== neighbourId) continue
      if (ev.id <= openedAt.current) continue
      const value = (ev.payload ?? {}).incident_id
      if (typeof value === 'string') id = value
    }
    return id
  }, [stream.events, neighbourId])

  const caseIncidents = useMemo(() => {
    const rows = [...(payload?.incidents ?? [])]
    // Open cases first, then newest: the one somebody has to decide about outranks the one that
    // was closed out an hour ago.
    rows.sort((a, b) => {
      const oa = incidentIsOpen(a) ? 0 : 1
      const ob = incidentIsOpen(b) ? 0 : 1
      if (oa !== ob) return oa - ob
      return b.opened_at.localeCompare(a.opened_at)
    })
    return rows
  }, [payload])

  const timeline = useMemo(
    () => (payload?.timeline ?? []).filter((ev) => LOGGED_EVENTS.has(ev.type)).reverse(),
    [payload],
  )

  // ---------------------------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------------------------
  // The model's read of the call. Polls only while there is a finished call to summarise, and
  // gives up quietly if the free tier never answers — the page is complete without it.
  const { brief: situationBrief, state: briefState } = useSituationBrief(hazardId, neighbour?.id, {
    enabled: calls.some((c) => c.outcome),
  })

  if (!neighbour) {
    return (
      <EmptyState
        size="full"
        title={loadError ? 'That case could not be opened' : 'Opening the case…'}
        body={loadError ?? 'Reading everything BuddyE knows about this person.'}
        action={
          <Link to={`/hazards/${hazardId}/sweep`} className="text-13 text-accent underline underline-offset-2">
            Back to everybody under watch
          </Link>
        }
      />
    )
  }

  const risk = payload?.risk ?? rosterRow?.risk ?? null
  const outcome = latest?.outcome ?? neighbour.outcome ?? null

  return (
    <div className="space-y-4">
      {/* ---- who this is, and the one button that acts ---------------------------------------- */}
      <div className="rounded border border-border bg-surface px-4 py-3.5">
        <Link
          to={`/hazards/${hazardId}/sweep`}
          className="inline-flex items-center gap-1 text-12 text-muted no-underline hover:text-text"
        >
          <ArrowLeft size={12} aria-hidden="true" /> Everybody under watch
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-22 font-semibold leading-tight tracking-tight text-text">{neighbour.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={badgeTone(bandTone(risk?.band))}>{bandLabel(risk?.band)}</Badge>
              {outcome ? <Badge tone={badgeTone(outcomeTone(outcome))}>{outcomeLabel(outcome)}</Badge> : null}
              {!calls.length ? <Badge tone="neutral">Not called yet</Badge> : null}
              <span className="text-12 text-muted">
                {neighbour.address}
                {neighbour.unit ? `, ${neighbour.unit}` : ''}
              </span>
            </div>
          </div>

          {payload ? (
            <CallLauncher
              name={neighbour.name}
              phoneMasked={neighbour.phone_masked}
              canCall={payload.can_call}
              live={live}
              launching={launching}
              calledBefore={calls.length > 0}
              error={launchError}
              onDismissError={() => setLaunchError(null)}
              onLaunch={() => void onLaunch()}
              consent={neighbour.check_in_consent}
              notes={neighbour.notes}
            />
          ) : null}
        </div>
      </div>

      {loadError ? (
        <p className="rounded border border-rejected/30 bg-rejected-tint px-3 py-2 text-12 text-rejected">{loadError}</p>
      ) : null}

      {/* ---- the hinge: a case the call raised, and the human who has to decide ---------------- */}
      {caseIncidents.length ? (
        <DeploymentHandoff hazardId={hazardId} incidents={caseIncidents} freshIncidentId={freshIncidentId} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ---- the call, and everything that came out of it --------------------------------- */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* The model's read of the call, above the call itself. It arrives seconds to a minute
              after the data below, which is already complete — see useSituationBrief. */}
          {calls.some((c) => c.outcome) ? (
            <SituationBriefCard brief={situationBrief} state={briefState} />
          ) : null}
          {calls.length ? (
            [...calls].reverse().map((call, i) => (
              <CallPanel
                key={call.id || `call-${i}`}
                call={call}
                offers={payload?.hazard.help_offered ?? []}
                evidence={fieldEvidence(payload?.timeline ?? [], call.id)}
                reconcile={reconcileMeta(payload?.timeline ?? [], call.id)}
                powerDependent={neighbour.power_dependent}
                defaultOpen={i === 0}
              />
            ))
          ) : (
            <Panel title="The call">
              <EmptyState
                icon={<Phone size={18} />}
                title={neighbour.check_in_consent ? 'Nobody has rung them tonight' : 'This person is never dialled'}
                body={
                  neighbour.check_in_consent
                    ? 'The call opens with who is ringing and why, asks only what decides whether they are safe, and is over in under two minutes.'
                    : 'They asked not to be called. BuddyE will not dial this number under any circumstances.'
                }
              />
            </Panel>
          )}

          <Panel
            title="Case agent log"
            subtitle="Every decision an agent made about this person, and whether a human agreed with it."
            padded={false}
          >
            <div className="py-3">
              <AgentDecisions actions={payload?.actions ?? []} />
            </div>
          </Panel>

          <Panel title="What BuddyE did" subtitle="Newest first. Vehicle movement lives on the map, not here." scroll={340}>
            <CaseTimeline events={timeline} />
          </Panel>
        </div>

        {/* ---- who they are ------------------------------------------------------------------ */}
        <div className="min-w-0 space-y-4">
          <Panel title="Why they are on this list">
            <WhyAtRisk risk={risk} reasons={payload?.risk_reasons ?? []} hazardHeadline={payload?.hazard.headline ?? ''} />
          </Panel>

          <Panel title="Who they are">
            {payload ? <WhoTheyAre neighbour={neighbour} hazard={payload.hazard} /> : null}
          </Panel>

          <Panel title="Emergency contact">
            <EmergencyContact neighbour={neighbour} />
          </Panel>

          <Panel title="Escalation">
            <LadderPanel escalations={payload?.escalations ?? []} handoffs={payload?.handoffs ?? []} />
          </Panel>
        </div>
      </div>

      {/* The console's own guarantee, stated once per case rather than implied by its absence. */}
      <p className="px-1 text-11 leading-snug text-faint">
        BuddyE rings neighbours and the people they nominated. It never dials emergency services: an ambulance, fire
        crew or police welfare check is prepared and left unsent until a named person approves it.
      </p>
    </div>
  )
}
