import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { ApiError, api } from '../../api'
import { Badge, PriorityBadge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { AssetProposal } from './AssetProposal'
import { Paperwork } from './Paperwork'
import { badgeTone, caseStatusLabel, caseStatusTone, justificationFor, proposalSource } from './labels'
import { outcomeBlurb, outcomeLabel, outcomeTone } from '../../lib/status'
import {
  etaText,
  isAgency,
  isLiveDispatch,
  kindLabel,
  milesText,
  needLabel,
  needsSentence,
} from '../../lib/operator'
import { fmtTime, humanize } from '../../lib/utils'
import type { Eligibility, IncidentDetail, IncidentRow } from '../../types'

/**
 * One deployment case: a person, an address, what the call established, and what to send.
 *
 * The collapsed row is what a coordinator scans — how bad, who, where, what it needs, and whether
 * anything is moving. It carries no health detail on purpose: conditions, medications and power
 * dependence are sensitive facts about a named person and belong where the decision that needs them
 * is actually taken, one click in, not on a list somebody leaves open on a screen.
 *
 * Expanded, the order is the order the questions get asked: what did the call establish, what does
 * that mean has to physically arrive, what does a crew need to know before knocking, who is
 * proposed and why that unit rather than another, and what did the agents decide along the way. The
 * reasoning is the substance of this screen, not decoration around it — a coordinator who cannot
 * see why an ambulance was proposed has not been given a decision, only a button.
 */
export function CaseCard({
  incident,
  expanded,
  onToggle,
  operatorName,
  pendingJustification,
  onOpenPacket,
  onChanged,
  highlighted = false,
  cardRef,
}: {
  incident: IncidentRow
  expanded: boolean
  onToggle: () => void
  operatorName: string
  /** Dispatch id -> the justification `/api/dispatch/pending` computed server-side. */
  pendingJustification: ReadonlyMap<string, string>
  /** Present only when a responder packet exists for this case. */
  onOpenPacket?: () => void
  onChanged: () => void
  /** This is the case a notification sent the coordinator here to decide. */
  highlighted?: boolean
  cardRef?: (el: HTMLElement | null) => void
}) {
  const [detail, setDetail] = useState<IncidentDetail | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [showWhyNot, setShowWhyNot] = useState(false)
  const [showAgents, setShowAgents] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposing, setProposing] = useState(false)

  const waiting = incident.dispatches.filter((d) => d.status === 'PROPOSED' && isAgency(d))
  const live = incident.dispatches.filter((d) => isLiveDispatch(d) && d.status !== 'PROPOSED')
  const proposedCommunity = incident.dispatches.filter((d) => d.status === 'PROPOSED' && !isAgency(d))

  /**
   * Re-read the record when this case changes underneath us.
   *
   * The dispatch statuses are the revision: the SSE stream refetches the incident rows, and an
   * approval three seconds ago has to be reflected in the needs, the provenance and the paperwork
   * without the coordinator collapsing and reopening the card.
   */
  const revision = `${incident.status}|${incident.dispatches.map((d) => `${d.id}:${d.status}`).join(',')}`

  useEffect(() => {
    if (!expanded) return
    let alive = true
    void (async () => {
      try {
        const full = await api.incident(incident.id)
        if (alive) {
          setDetail(full)
          setError(null)
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [incident.id, expanded, revision])

  const loadEligibility = useCallback(async () => {
    setShowWhyNot((v) => !v)
    if (eligibility) return
    try {
      setEligibility(await api.candidates(incident.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [eligibility, incident.id])

  const propose = async () => {
    setProposing(true)
    setError(null)
    try {
      await api.proposeDispatch(incident.id, true)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setProposing(false)
    }
  }

  const said = (detail?.situation?.what_they_said as string[] | undefined) ?? []
  const tone = waiting.length > 0 ? 'border-l-[3px] border-l-p1' : live.length > 0 ? '' : 'border-l-[3px] border-l-p3'

  return (
    <section
      ref={cardRef}
      // scroll-mt-14: the shell's header is sticky at 48px, and scrollIntoView({block:'start'})
      // would otherwise park the priority badge and the person's name underneath it.
      className={`scroll-mt-14 overflow-hidden rounded border bg-surface ${tone} ${
        highlighted ? 'border-accent shadow-panel' : 'border-border'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full px-3.5 py-3 text-left transition-colors hover:bg-active"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <PriorityBadge priority={incident.priority} label={incident.priority_label} />
          <span className="text-15 font-semibold leading-tight text-text">{incident.name}</span>
          <span className="text-12 text-muted">
            {incident.address}
            {incident.unit ? `, ${incident.unit}` : ''}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Badge tone={badgeTone(outcomeTone(incident.outcome))} size="sm">
              {outcomeLabel(incident.outcome)}
            </Badge>
            <Badge tone={caseStatusTone(incident.status)} size="sm">
              {caseStatusLabel(incident.status)}
            </Badge>
            {expanded ? (
              <ChevronDown size={14} className="text-faint" aria-hidden="true" />
            ) : (
              <ChevronRight size={14} className="text-faint" aria-hidden="true" />
            )}
          </span>
        </div>

        {incident.summary ? <p className="mt-1.5 text-13 leading-snug text-text">{incident.summary}</p> : null}

        <p className="mt-1 text-12 text-muted">
          <span className="label mr-1.5">Needs</span>
          {needsSentence(incident.needs)}
          <span className="ml-2 font-mono text-11 text-faint">opened {fmtTime(incident.opened_at)}</span>
        </p>

        <div className="mt-1.5 space-y-0.5">
          {waiting.map((d) => (
            <p key={d.id} className="flex flex-wrap items-center gap-1.5 text-12 leading-snug text-p1-text">
              <Lock size={12} aria-hidden="true" />
              <strong className="font-semibold">
                {kindLabel(d.kind)} {d.call_sign} — request, not sent
              </strong>
              <span className="font-mono tabular-nums text-muted">
                {milesText(d.distance_miles)} · {etaText(d.eta_minutes)} if approved
              </span>
            </p>
          ))}
          {live.map((d) => (
            <p key={d.id} className="flex flex-wrap items-center gap-1.5 text-12 leading-snug text-text">
              <strong className="font-medium">
                {kindLabel(d.kind)} {d.call_sign}
              </strong>
              {/* An arrived unit is a fact, not a distance: "1.0 mi" against a van that is already
                  at the door reads as though it were still coming. */}
              {d.status === 'ARRIVED' ? (
                <span className="text-verified-text">at the address</span>
              ) : (
                <span className="font-mono tabular-nums text-muted">
                  {d.status === 'EN_ROUTE'
                    ? `${etaText(d.eta_minutes)} out · ${Math.round(d.progress * 100)}% of the way`
                    : `assigned · ${milesText(d.distance_miles)}`}
                </span>
              )}
            </p>
          ))}
          {/* A community resource an agent prepared but did not commit. Nobody is waiting on an
              authorisation here — a coordinator only has to say go — but leaving it off the row
              would make the case look as though nothing had been worked out for it. */}
          {proposedCommunity.map((d) => (
            <p key={d.id} className="flex flex-wrap items-center gap-1.5 text-12 leading-snug text-p3-text">
              <strong className="font-medium">
                {kindLabel(d.kind)} {d.call_sign} — proposed, not sent
              </strong>
              <span className="font-mono tabular-nums text-muted">
                {milesText(d.distance_miles)} · {etaText(d.eta_minutes)} once you say go
              </span>
            </p>
          ))}
          {waiting.length === 0 && live.length === 0 && proposedCommunity.length === 0 ? (
            <p className="text-12 leading-snug text-p3-text">Nothing has been sent to this address yet.</p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-divider bg-strip/60 px-3.5 py-3">
          {error ? (
            <p className="mb-2.5 rounded border border-rejected/30 bg-rejected-tint px-2.5 py-1.5 text-12 text-rejected">
              {error}
            </p>
          ) : null}

          <Block label="What the call established">
            {/* The finding itself is on the row above; repeating it here would be the same sentence
                twice on one card. What this adds is how it was established, in their words. */}
            <p className="text-13 leading-relaxed text-text">
              {outcomeBlurb(incident.outcome) || incident.summary || 'No finding recorded.'}
            </p>
            {said.length > 0 ? (
              <ul className="mt-2 space-y-1 border-l-2 border-edge pl-3 text-13 leading-snug text-muted">
                {said.map((s, i) => (
                  <li key={i}>“{s}”</li>
                ))}
              </ul>
            ) : null}
            {detail && detail.risk_reasons.length > 0 ? (
              <ul className="mt-2 grid gap-x-6 gap-y-0.5 text-12 leading-snug text-muted sm:grid-cols-2">
                {detail.risk_reasons.map((r, i) => (
                  <li key={i}>· {r}</li>
                ))}
              </ul>
            ) : null}
          </Block>

          <Block label="What has to arrive">
            {detail?.need_detail?.needs?.length ? (
              <ul className="space-y-1">
                {detail.need_detail.needs.map((n) => (
                  <li key={n.capability} className="flex flex-wrap items-baseline gap-x-2 text-13 leading-snug">
                    <span className="font-medium text-text">{needLabel(n.capability)}</span>
                    <span className="min-w-[200px] flex-1 text-12 text-muted">{n.reason}</span>
                    {n.life_safety ? (
                      <Badge priority={1} size="sm">
                        life safety
                      </Badge>
                    ) : null}
                  </li>
                ))}
                {detail.need_detail.preferred?.map((n) => (
                  <li key={`pref-${n.capability}`} className="flex flex-wrap items-baseline gap-x-2 text-13 leading-snug">
                    <span className="text-muted">{needLabel(n.capability)}</span>
                    <span className="min-w-[200px] flex-1 text-12 text-faint">{n.reason}</span>
                    <Badge tone="neutral" size="sm">
                      nice to have
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-13 text-muted">{detail ? 'Nothing derived yet.' : 'Reading the record…'}</p>
            )}
            {detail?.need_detail?.notes?.length ? (
              <ul className="mt-2 space-y-0.5 text-12 leading-snug text-p3-text">
                {detail.need_detail.notes.map((n, i) => (
                  <li key={i}>· {n}</li>
                ))}
              </ul>
            ) : null}
            {detail?.need_detail?.agency_justified ? (
              <p className="mt-2 rounded border border-p3/40 bg-p3-tint px-2.5 py-2 text-12 leading-relaxed text-p3-text">
                An agency unit is justified here: {detail.need_detail.agency_reason}. It still cannot become a request
                until a named person approves it.
              </p>
            ) : null}
          </Block>

          {/* The health facts, once, on the surface where the decision that needs them is taken. */}
          <Block label="What a crew needs to know">
            <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 text-12 leading-snug">
              {incident.power_dependent !== null ? (
                <>
                  <dt className="text-faint">Power</dt>
                  <dd className="text-text">
                    {incident.power_dependent ? 'Depends on mains power' : 'Not power dependent'}
                  </dd>
                </>
              ) : null}
              {incident.conditions.length > 0 ? (
                <>
                  <dt className="text-faint">Conditions</dt>
                  <dd className="text-text">{incident.conditions.join(', ')}</dd>
                </>
              ) : null}
              {incident.mobility ? (
                <>
                  <dt className="text-faint">Mobility</dt>
                  {/* The API stores these as identifiers ("cane_walker"); a crew reads words. */}
                  <dd className="text-text">{humanize(incident.mobility)}</dd>
                </>
              ) : null}
              {incident.lives_alone !== null ? (
                <>
                  <dt className="text-faint">Household</dt>
                  <dd className="text-text">{incident.lives_alone ? 'Lives alone' : 'Not alone'}</dd>
                </>
              ) : null}
              {incident.access_notes ? (
                <>
                  <dt className="text-faint">Access</dt>
                  <dd className="text-text">{incident.access_notes}</dd>
                </>
              ) : null}
            </dl>
          </Block>

          <Block
            label="What is proposed"
            right={
              <Button size="sm" variant="secondary" loading={proposing} onClick={() => void propose()}>
                {proposing ? 'Asking the operator agent…' : 'Ask the operator agent'}
              </Button>
            }
          >
            {incident.dispatches.length === 0 ? (
              <p className="text-13 text-muted">
                Nothing proposed for this address yet. The operator agent runs on its own; asking takes up to a minute.
              </p>
            ) : (
              <div className="space-y-2">
                {incident.dispatches.map((d) => (
                  <AssetProposal
                    key={d.id}
                    d={d}
                    basis={justificationFor(detail?.actions, d.asset_id, pendingJustification.get(d.id) ?? '')}
                    source={proposalSource(detail?.actions, d.asset_id)}
                    operatorName={operatorName}
                    onOpenPacket={isAgency(d) ? onOpenPacket : undefined}
                    onDecided={onChanged}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => void loadEligibility()}
              className="mt-2 text-12 text-accent underline underline-offset-2"
            >
              {showWhyNot ? 'Hide' : 'Show'} who else could go, and why the rest could not
            </button>
            {showWhyNot ? (
              <div className="mt-2 divide-y divide-divider rounded border border-border bg-surface text-12">
                {!eligibility ? <p className="px-2.5 py-2 text-muted">Working out who is eligible…</p> : null}
                {eligibility?.error ? <p className="px-2.5 py-2 text-rejected">{eligibility.error}</p> : null}
                {eligibility?.candidates.map((c) => (
                  <p key={c.asset_id} className="px-2.5 py-2 text-text">
                    {c.reason}
                  </p>
                ))}
                {eligibility?.excluded.map((e) => (
                  <p key={e.asset_id} className="px-2.5 py-2 text-muted">
                    <span className="font-mono text-11">{e.call_sign}</span> — {e.reason}
                  </p>
                ))}
                {eligibility ? (
                  <p className="px-2.5 py-2 font-mono text-11 text-faint">
                    Search radius {eligibility.radius_miles} mi
                  </p>
                ) : null}
              </div>
            ) : null}
          </Block>

          <Block label="Paperwork">
            <Paperwork incidentId={incident.id} agencyWaiting={waiting.length > 0} operatorName={operatorName} />
          </Block>

          {detail && detail.actions.length > 0 ? (
            <Block
              label="What the agents decided"
              right={
                <button
                  type="button"
                  onClick={() => setShowAgents((v) => !v)}
                  className="text-12 text-accent underline underline-offset-2"
                >
                  {showAgents ? 'Hide' : `Show ${detail.actions.length}`}
                </button>
              }
            >
              {showAgents ? (
                <div className="divide-y divide-divider rounded border border-border bg-surface">
                  {detail.actions.map((a) => (
                    <div key={a.id} className="px-2.5 py-2">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-11">
                        <span className="font-mono text-text">{a.agent}</span>
                        <span className="text-faint">{a.kind}</span>
                        {a.model ? <span className="font-mono text-faint">{a.model}</span> : null}
                        {a.latency_ms !== null ? (
                          <span className="font-mono tabular-nums text-faint">{Math.round(a.latency_ms)} ms</span>
                        ) : null}
                        <span className="ml-auto">
                          {a.error ? (
                            <Badge tone="rejected" size="sm">
                              fell back
                            </Badge>
                          ) : a.accepted ? (
                            <Badge tone="verified" size="sm">
                              used{a.accepted_by ? ` · ${a.accepted_by}` : ''}
                            </Badge>
                          ) : (
                            <Badge tone="neutral" size="sm">
                              recorded
                            </Badge>
                          )}
                        </span>
                      </div>
                      {a.rationale ? <p className="mt-1 text-12 leading-snug text-text">{a.rationale}</p> : null}
                      {a.error ? <p className="mt-1 text-12 leading-snug text-muted">{a.error}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-12 text-muted">
                  {detail.actions.length} agent decision{detail.actions.length === 1 ? '' : 's'} recorded against this
                  case, with the model and the latency behind each.
                </p>
              )}
            </Block>
          ) : null}

          {incident.status === 'RESOLVED' || incident.status === 'CLOSED' ? (
            <p className="rounded border border-l-[3px] border-border border-l-verified bg-surface px-2.5 py-2 text-13 text-text">
              Closed{incident.resolution ? ` — ${incident.resolution}` : ''}.
            </p>
          ) : (
            <Block label="Close this case">
              <CloseCase incidentId={incident.id} operatorName={operatorName} onChanged={onChanged} />
            </Block>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Block({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mb-3 border-b border-divider pb-3 last:mb-0 last:border-b-0 last:pb-0">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {right}
      </div>
      {children}
    </section>
  )
}

/**
 * Closing a case.
 *
 * Small, and at the bottom, because it is the least urgent thing on the card — but it is here
 * rather than nowhere: nothing else in the new flow closes an incident, and a rail badge that never
 * clears is a badge people stop reading. The name is required for the same reason the API requires
 * it: "resolved" with nobody attached says somebody checked when nobody did.
 */
function CloseCase({
  incidentId,
  operatorName,
  onChanged,
}: {
  incidentId: string
  operatorName: string
  onChanged: () => void
}) {
  const [name, setName] = useState(operatorName)
  const [resolution, setResolution] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Your name" hint="A person, not a service account." className="min-w-[150px] flex-1">
        {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
      </Field>
      <Field label="What happened" hint="Goes on the record." className="min-w-[200px] flex-[2]">
        {(props) => (
          <Input
            {...props}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="e.g. WV-1 took her to the cooling centre"
          />
        )}
      </Field>
      <Button
        variant="secondary"
        loading={busy}
        disabled={!name.trim()}
        onClick={() => {
          setBusy(true)
          setError(null)
          void api
            .resolveIncident(incidentId, { resolved_by: name.trim(), resolution: resolution.trim() })
            .then(() => onChanged())
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => setBusy(false))
        }}
      >
        Close
      </Button>
      {error ? <p className="w-full text-12 text-rejected">{error}</p> : null}
    </div>
  )
}
