import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api'
import { Sheet, Section } from './Sheet'
import { Pill } from './Pill'
import { LockIcon } from './Icons'
import {
  dispatchLabel,
  dispatchTone,
  etaText,
  incidentStatusLabel,
  incidentStatusTone,
  isAgency,
  kindLabel,
  milesText,
  needLabel,
  priorityTone,
} from '../lib/operator'
import type { CorrespondenceDraft, DispatchRow, Eligibility, IncidentDetail, IncidentDocument } from '../types'

/**
 * One address, and everything the system has decided about it.
 *
 * The order is the order a coordinator asks the questions in: what did the call actually establish,
 * what does that mean has to physically arrive, who is going, why that unit and not another one,
 * and what paperwork does the decision generate. The agent's reasoning is on the screen next to the
 * outcome it produced, with its model and its latency, because "who decided this and on what basis"
 * is a question that gets asked a week later by somebody who was not here.
 */
export function IncidentPanel({
  incidentId,
  operatorName,
  onClose,
  onChanged,
}: {
  incidentId: string
  operatorName: string
  onClose: () => void
  onChanged: () => void
}) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null)
  const [eligibility, setEligibility] = useState<Eligibility | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * Which actions are in flight, keyed.
   *
   * A set rather than one "busy" flag, because generating an ICS form or a message draft is a
   * 20-100 s model call — and a single flag would have that call grey out the approve button on an
   * ambulance request sitting three inches below it. Nothing a coordinator does may be blocked by
   * paperwork the machine is writing.
   */
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [showWhyNot, setShowWhyNot] = useState(false)

  const load = useCallback(async () => {
    try {
      const [detail, elig] = await Promise.all([api.incident(incidentId), api.candidates(incidentId).catch(() => null)])
      setIncident(detail)
      setEligibility(elig)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [incidentId])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [key]: true }))
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy((b) => {
        const { [key]: _done, ...rest } = b
        return rest
      })
    }
  }

  if (!incident) {
    return (
      <Sheet title="Incident" onClose={onClose}>
        {error ? <p className="text-13 text-rejected">{error}</p> : <p className="text-13 text-muted">Loading the incident…</p>}
      </Sheet>
    )
  }

  const said = (incident.situation?.what_they_said as string[] | undefined) ?? []
  const live = incident.dispatches.filter((d) => d.status !== 'CANCELLED')
  const declined = incident.dispatches.filter((d) => d.status === 'CANCELLED')

  return (
    <Sheet
      title={incident.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{incident.address}{incident.unit ? `, ${incident.unit}` : ''}</span>
          <Pill tone={priorityTone(incident.priority)}>{incident.priority_label}</Pill>
          <Pill tone={incidentStatusTone(incident.status)}>{incidentStatusLabel(incident.status)}</Pill>
        </span>
      }
      onClose={onClose}
    >
      {error && <p className="mb-3 rounded border border-rejected/30 bg-rejected-tint px-3 py-2 text-12 text-rejected">{error}</p>}

      <Section title="What the call established">
        <div className="card px-3 py-2.5 text-13 leading-snug text-text">
          {incident.summary || 'No finding recorded.'}
          {said.length > 0 && (
            <ul className="mt-2 space-y-1 border-l-2 border-edge pl-3 text-muted">
              {said.map((s, i) => (
                <li key={i}>“{s}”</li>
              ))}
            </ul>
          )}
        </div>
        {incident.risk_reasons.length > 0 && (
          <ul className="mt-2 space-y-0.5 px-1 text-12 text-muted">
            {incident.risk_reasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="What has to arrive">
        <div className="card divide-y divide-divider">
          {incident.need_detail?.needs?.length ? (
            incident.need_detail.needs.map((n) => (
              <div key={n.capability} className="flex items-start gap-2 px-3 py-2">
                <span className="mt-0.5 text-13 font-medium text-text">{needLabel(n.capability)}</span>
                <span className="flex-1 text-12 leading-snug text-muted">{n.reason}</span>
                {n.life_safety && <Pill tone="rejected">life safety</Pill>}
              </div>
            ))
          ) : (
            <p className="px-3 py-2 text-13 text-muted">Nothing derived yet.</p>
          )}
          {incident.need_detail?.preferred?.map((n) => (
            <div key={`pref-${n.capability}`} className="flex items-start gap-2 px-3 py-2">
              <span className="mt-0.5 text-13 text-muted">{needLabel(n.capability)}</span>
              <span className="flex-1 text-12 leading-snug text-faint">{n.reason}</span>
              <Pill tone="grey">nice to have</Pill>
            </div>
          ))}
        </div>
        {incident.need_detail?.notes?.length > 0 && (
          <ul className="mt-2 space-y-0.5 px-1 text-12 text-partial">
            {incident.need_detail.notes.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
          </ul>
        )}
        {incident.need_detail?.agency_justified && (
          <p className="mt-2 rounded border border-partial/40 bg-partial-tint px-3 py-2 text-12 leading-snug text-text">
            An agency unit is justified here: {incident.need_detail.agency_reason}. It still cannot leave a request until a
            named person approves it.
          </p>
        )}
      </Section>

      {/* The health facts, once, where the decision is made. Never on a list view. */}
      <Section title="What a crew needs to know">
        <dl className="card grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-3 py-2.5 text-12">
          {incident.power_dependent !== null && (
            <>
              <dt className="text-faint">Power</dt>
              <dd className="text-text">{incident.power_dependent ? 'Depends on mains power' : 'Not power dependent'}</dd>
            </>
          )}
          {incident.conditions.length > 0 && (
            <>
              <dt className="text-faint">Conditions</dt>
              <dd className="text-text">{incident.conditions.join(', ')}</dd>
            </>
          )}
          {incident.mobility && (
            <>
              <dt className="text-faint">Mobility</dt>
              <dd className="text-text">{incident.mobility}</dd>
            </>
          )}
          {incident.lives_alone !== null && (
            <>
              <dt className="text-faint">Household</dt>
              <dd className="text-text">{incident.lives_alone ? 'Lives alone' : 'Not alone'}</dd>
            </>
          )}
          {incident.access_notes && (
            <>
              <dt className="text-faint">Access</dt>
              <dd className="text-text">{incident.access_notes}</dd>
            </>
          )}
        </dl>
      </Section>

      <Section
        title="Who is going"
        right={
          <button
            type="button"
            className="btn-secondary h-7 min-h-0 py-0 text-11"
            disabled={!!busy.propose}
            onClick={() => void run('propose', () => api.proposeDispatch(incident.id, true))}
          >
            {busy.propose ? 'Asking the operator agent…' : 'Ask the operator agent'}
          </button>
        }
      >
        {live.length === 0 && <p className="card px-3 py-2.5 text-13 text-muted">Nothing has been sent to this address.</p>}
        <div className="space-y-2">
          {live.map((d) => (
            <DispatchCard
              key={d.id}
              d={d}
              operatorName={operatorName}
              busy={busy}
              onRun={run}
            />
          ))}
        </div>
        {declined.length > 0 && (
          <div className="mt-2 space-y-1">
            {declined.map((d) => (
              <p key={d.id} className="text-12 leading-snug text-muted">
                <strong className="font-medium text-text">
                  {kindLabel(d.kind)} {d.call_sign}
                </strong>{' '}
                declined{d.authorised_by ? ` by ${d.authorised_by}` : ''}
                {d.decline_reason ? ` — ${d.decline_reason}` : ''}
              </p>
            ))}
          </div>
        )}
        {eligibility && (
          <div className="mt-2">
            <button type="button" className="text-12 text-accent underline" onClick={() => setShowWhyNot((v) => !v)}>
              {showWhyNot ? 'Hide' : 'Show'} who could go, and why the rest could not
            </button>
            {showWhyNot && (
              <div className="mt-2 card divide-y divide-divider text-12">
                {eligibility.error && <p className="px-3 py-2 text-rejected">{eligibility.error}</p>}
                {eligibility.candidates.map((c) => (
                  <p key={c.asset_id} className="px-3 py-2 text-text">
                    {c.reason}
                  </p>
                ))}
                {eligibility.excluded.map((e) => (
                  <p key={e.asset_id} className="px-3 py-2 text-muted">
                    <span className="font-mono text-11">{e.call_sign}</span> — {e.reason}
                  </p>
                ))}
                <p className="px-3 py-2 text-faint">Search radius {eligibility.radius_miles} miles.</p>
              </div>
            )}
          </div>
        )}
      </Section>

      {incident.actions.length > 0 && (
        <Section title="What the agents decided">
          <div className="card divide-y divide-divider">
            {incident.actions.map((a) => (
              <div key={a.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2 text-11">
                  <span className="font-mono text-text">{a.agent}</span>
                  <span className="text-faint">{a.kind}</span>
                  {a.model && <span className="font-mono text-faint">{a.model}</span>}
                  {a.latency_ms !== null && <span className="font-mono text-faint">{Math.round(a.latency_ms)} ms</span>}
                  <span className="ml-auto">
                    {a.error ? (
                      <Pill tone="rejected">fell back</Pill>
                    ) : a.accepted ? (
                      <Pill tone="verified">used{a.accepted_by ? ` · ${a.accepted_by}` : ''}</Pill>
                    ) : (
                      <Pill tone="grey">not used</Pill>
                    )}
                  </span>
                </div>
                {a.rationale && <p className="mt-1 text-12 leading-snug text-text">{a.rationale}</p>}
                {a.error && <p className="mt-1 text-12 leading-snug text-muted">{a.error}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="ICS paperwork"
        right={
          <span className="flex gap-1.5">
            {(['ICS-214', 'ICS-213', 'situation_report'] as const).map((form) => (
              <button
                key={form}
                type="button"
                className="btn-secondary h-7 min-h-0 py-0 text-11"
                disabled={!!busy[`doc-${form}`]}
                onClick={() =>
                  void run(`doc-${form}`, () =>
                    api.generateDocument({ form, incident_id: incident.id, prepared_by: operatorName }),
                  )
                }
              >
                {busy[`doc-${form}`] ? 'Writing…' : form === 'situation_report' ? 'Sitrep' : form}
              </button>
            ))}
          </span>
        }
      >
        {incident.documents.length === 0 && (
          <p className="card px-3 py-2.5 text-13 text-muted">No forms generated for this incident yet.</p>
        )}
        <div className="space-y-2">
          {incident.documents.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} operatorName={operatorName} busy={busy} onRun={run} />
          ))}
        </div>
      </Section>

      <Section
        title="Drafts for a human to send"
        right={
          <span className="flex gap-1.5">
            {(['contact', 'family', 'agency'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className="btn-secondary h-7 min-h-0 py-0 text-11"
                disabled={!!busy[`draft-${kind}`]}
                onClick={() => void run(`draft-${kind}`, () => api.draftCorrespondence({ kind, incident_id: incident.id }))}
              >
                {busy[`draft-${kind}`] ? 'Drafting…' : kind}
              </button>
            ))}
          </span>
        }
      >
        <p className="mb-2 px-1 text-11 leading-snug text-faint">
          BuddyE writes these; it never sends one. There is no send path in the product — a draft is words on a screen for
          you to read out or copy.
        </p>
        {incident.correspondence.length === 0 && (
          <p className="card px-3 py-2.5 text-13 text-muted">Nothing drafted for this incident yet.</p>
        )}
        <div className="space-y-2">
          {incident.correspondence.map((msg) => (
            <CorrespondenceCard key={msg.id} msg={msg} operatorName={operatorName} busy={busy} onRun={run} />
          ))}
        </div>
      </Section>

      {incident.status !== 'RESOLVED' && incident.status !== 'CLOSED' ? (
        <ResolveBox incidentId={incident.id} operatorName={operatorName} busy={busy} onRun={run} />
      ) : (
        <p className="card-calm px-3 py-2.5 text-13 text-text">
          Resolved{incident.resolution ? ` — ${incident.resolution}` : ''}.
        </p>
      )}
    </Sheet>
  )
}

type Runner = (key: string, fn: () => Promise<unknown>) => Promise<void>
type Busy = Record<string, boolean>

/** One assigned or requested resource, with only the buttons that are legal for its state. */
function DispatchCard({ d, operatorName, busy, onRun }: { d: DispatchRow; operatorName: string; busy: Busy; onRun: Runner }) {
  const [name, setName] = useState(operatorName)
  const [reason, setReason] = useState('')
  const agency = isAgency(d)
  const awaiting = d.status === 'PROPOSED' && agency

  return (
    <div className={awaiting ? 'card-attention px-3 py-2.5' : 'card px-3 py-2.5'}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-13 font-semibold text-text">
          {kindLabel(d.kind)} {d.call_sign}
        </span>
        {d.operator_name && <span className="text-12 text-muted">{d.operator_name}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {awaiting && <LockIcon size={12} />}
          <Pill tone={dispatchTone(d)}>{dispatchLabel(d)}</Pill>
        </span>
      </div>
      <p className="mt-1 text-12 leading-snug text-muted">
        {milesText(d.distance_miles)} · {etaText(d.eta_minutes)}
        {d.progress > 0 && d.status === 'EN_ROUTE' ? ` · ${Math.round(d.progress * 100)}% of the way` : ''}
        {d.authorised_by ? ` · approved by ${d.authorised_by}` : ''}
      </p>
      {d.reason && <p className="mt-1 text-12 leading-snug text-text">{d.reason}</p>}
      {/* The backend's own words for what this state means. Rendered as written. */}
      {d.status_note && <p className="mt-1 text-12 leading-snug text-partial">{d.status_note}</p>}

      {awaiting && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-divider pt-2">
          <label className="flex-1 min-w-[150px]">
            <span className="label mb-1 block">Your name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alma Reyes" />
          </label>
          <label className="flex-1 min-w-[150px]">
            <span className="label mb-1 block">Reason, if you decline</span>
            <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="why not" />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-danger"
              disabled={!!busy[`auth-${d.id}`]}
              onClick={() => void onRun(`auth-${d.id}`, () => api.authoriseDispatch(d.id, { name: name.trim() }))}
            >
              Approve and send
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!!busy[`decl-${d.id}`] || !reason.trim()}
              onClick={() => void onRun(`decl-${d.id}`, () => api.declineDispatch(d.id, { name: name.trim(), reason: reason.trim() }))}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {d.status === 'PROPOSED' && !agency && (
        <button
          type="button"
          className="btn-primary mt-2 h-8 min-h-0 py-0 text-12"
          disabled={!!busy[`commit-${d.id}`]}
          onClick={() => void onRun(`commit-${d.id}`, () => api.commitDispatch(d.id))}
        >
          Send {d.call_sign}
        </button>
      )}

      {d.status === 'ARRIVED' && (
        <button
          type="button"
          className="btn-secondary mt-2 h-8 min-h-0 py-0 text-12"
          disabled={!!busy[`done-${d.id}`]}
          onClick={() => void onRun(`done-${d.id}`, () => api.completeDispatch(d.id))}
        >
          Mark this visit finished
        </button>
      )}
    </div>
  )
}

function DocumentCard({ doc, operatorName, busy, onRun }: { doc: IncidentDocument; operatorName: string; busy: Busy; onRun: Runner }) {
  const [name, setName] = useState(operatorName)
  return (
    <div className="card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-11 text-faint">{doc.form}</span>
        <span className="text-13 font-medium text-text">{doc.title}</span>
        <span className="ml-auto">
          {doc.approved ? <Pill tone="verified">signed by {doc.approved_by}</Pill> : <Pill tone="partial">unsigned</Pill>}
        </span>
      </div>
      <pre className="thin-scroll mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded border border-divider bg-strip px-2.5 py-2 font-mono text-11 leading-relaxed text-text">
        {doc.body}
      </pre>
      {!doc.approved && (
        <div className="mt-2 flex items-end gap-2">
          <label className="flex-1">
            <span className="label mb-1 block">Sign it — a form signed by nobody is a form nobody signed</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy[`sign-${doc.id}`]}
            onClick={() => void onRun(`sign-${doc.id}`, () => api.approveDocument(doc.id, name.trim()))}
          >
            Sign
          </button>
        </div>
      )}
    </div>
  )
}

function CorrespondenceCard({ msg, operatorName, busy, onRun }: { msg: CorrespondenceDraft; operatorName: string; busy: Busy; onRun: Runner }) {
  const [name, setName] = useState(operatorName)
  return (
    <div className="card px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-11 text-faint">{msg.channel}</span>
        <span className="text-13 font-medium text-text">{msg.subject || `To ${msg.to_name || 'contact'}`}</span>
        <span className="ml-auto">{msg.approved ? <Pill tone="verified">approved</Pill> : <Pill tone="partial">draft</Pill>}</span>
      </div>
      {msg.to_name && <p className="text-12 text-muted">To {msg.to_name}</p>}
      <pre className="thin-scroll mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded border border-divider bg-strip px-2.5 py-2 text-12 leading-relaxed text-text">
        {msg.body}
      </pre>
      {/* Verbatim: "draft — nobody has been contacted". Nothing in BuddyE can set sent_at. */}
      <p className="mt-1 text-11 text-partial">{msg.status_note}</p>
      {!msg.approved && (
        <div className="mt-2 flex items-end gap-2">
          <label className="flex-1">
            <span className="label mb-1 block">Approve the wording — approving is not sending</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" />
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy[`appr-${msg.id}`]}
            onClick={() => void onRun(`appr-${msg.id}`, () => api.approveCorrespondence(msg.id, name.trim()))}
          >
            Approve
          </button>
        </div>
      )}
    </div>
  )
}

function ResolveBox({ incidentId, operatorName, busy, onRun }: { incidentId: string; operatorName: string; busy: Busy; onRun: Runner }) {
  const [name, setName] = useState(operatorName)
  const [resolution, setResolution] = useState('')
  return (
    <Section title="Close this incident">
      <div className="card px-3 py-2.5">
        <p className="mb-2 text-12 leading-snug text-muted">
          A name, because “resolved” with nobody attached says somebody checked when nobody did.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[140px]">
            <span className="label mb-1 block">Your name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex-[2] min-w-[180px]">
            <span className="label mb-1 block">What happened</span>
            <input className="field" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="e.g. WV-1 took her to the cooling centre" />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={!!busy.resolve}
            onClick={() => void onRun('resolve', () => api.resolveIncident(incidentId, { resolved_by: name.trim(), resolution: resolution.trim() }))}
          >
            Resolve
          </button>
        </div>
      </div>
    </Section>
  )
}
