import { useState } from 'react'
import { api, ApiError } from '../api'
import { Pill } from './Pill'
import { LockIcon } from './Icons'
import { etaText, kindLabel, milesText, needsSentence } from '../lib/operator'
import type { HandoffPacket, IncidentRow, PendingDispatch } from '../types'

/**
 * One agency request, and the two buttons that are the whole point of this product.
 *
 * An agent has already done everything it is allowed to do: picked the unit, computed the route,
 * timed the drive, and written down why. What it has *not* done is ask anybody, and the wording here
 * has to keep saying so — the row is headed "requested", the status note is the backend's own
 * sentence rendered verbatim, and no part of it may read as though a unit is on its way.
 *
 * Approve and decline are the same size. A coordinator who feels the screen is pushing her towards
 * yes is a coordinator who stops reading it, and "no, because the daughter is already driving over"
 * is a real answer that has to be as easy to give as the other one.
 */
export function ApprovalRow({
  d,
  incident,
  packet,
  operatorName,
  onDone,
  onOpenPacket,
  onOpenIncident,
}: {
  d: PendingDispatch
  incident: IncidentRow | null
  packet: HandoffPacket | null
  operatorName: string
  onDone: () => void
  onOpenPacket?: () => void
  onOpenIncident?: () => void
}) {
  const [name, setName] = useState(operatorName)
  const [note, setNote] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDone()
    } catch (err) {
      // The backend's `detail` is the sentence explaining *why* a name was refused. Verbatim.
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card-urgent px-4 py-3.5">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-15 font-semibold text-text">{d.name}</h3>
        <span className="text-12 text-muted">{d.address}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {d.incident_priority !== null && <Pill tone="rejected">{incident?.priority_label ?? `priority ${d.incident_priority}`}</Pill>}
          <Pill tone="partial">
            <LockIcon size={12} />
            <span className="ml-1">Request — not sent</span>
          </Pill>
        </div>
      </header>

      <p className="mt-2 text-13 leading-snug text-text">
        <strong className="font-semibold">
          {kindLabel(d.kind)} {d.call_sign}
        </strong>{' '}
        requested — {milesText(d.distance_miles)} out, about {etaText(d.eta_minutes)} if it leaves now.
      </p>

      {/* The agent's grounds, off its own provenance row. Not re-derived, not paraphrased. */}
      {d.justification && (
        <p className="mt-1.5 rounded border border-border bg-strip px-3 py-2 text-13 leading-snug text-text">
          <span className="label mr-1.5 align-middle">Why</span>
          {d.justification}
        </p>
      )}
      {!d.justification && d.reason && <p className="mt-1.5 text-13 leading-snug text-muted">{d.reason}</p>}

      {d.incident_summary && <p className="mt-1.5 text-13 leading-snug text-muted">{d.incident_summary}</p>}

      {incident && (
        <div className="mt-2 grid gap-x-6 gap-y-1 text-12 text-muted sm:grid-cols-2">
          <div>
            <span className="label mr-1.5">Needs</span>
            {needsSentence(incident.needs)}
          </div>
          {/* Health facts belong here: this is the decision they exist to inform. */}
          {(incident.power_dependent || incident.conditions.length > 0 || incident.mobility) && (
            <div>
              <span className="label mr-1.5">Them</span>
              {[
                incident.power_dependent ? 'depends on mains power' : '',
                incident.lives_alone ? 'lives alone' : '',
                incident.mobility ? `mobility: ${incident.mobility}` : '',
                ...incident.conditions,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          )}
          {incident.access_notes && (
            <div>
              <span className="label mr-1.5">Access</span>
              {incident.access_notes}
            </div>
          )}
        </div>
      )}

      {/* The backend's own sentence for this state. Never softened, never rewritten. */}
      {d.status_note && <p className="mt-2 text-12 leading-snug text-partial">{d.status_note}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {packet && onOpenPacket && (
          <button type="button" className="btn-secondary h-8 min-h-0 py-0 text-12" onClick={onOpenPacket}>
            Read the responder packet
          </button>
        )}
        {onOpenIncident && (
          <button type="button" className="btn-secondary h-8 min-h-0 py-0 text-12" onClick={onOpenIncident}>
            Open the incident
          </button>
        )}
      </div>

      {!declining ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-divider pt-3">
          <label className="flex-1 min-w-[180px]">
            <span className="label mb-1 block">Your name — this goes on the record</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alma Reyes" />
          </label>
          <label className="flex-1 min-w-[180px]">
            <span className="label mb-1 block">Note (optional)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="anything the crew should know" />
          </label>
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              className="btn-danger flex-1 sm:flex-none"
              disabled={busy}
              onClick={() => void run(() => api.authoriseDispatch(d.id, { name: name.trim(), note: note.trim() }))}
            >
              {busy ? 'Sending…' : `Approve and send ${d.call_sign}`}
            </button>
            <button type="button" className="btn-secondary flex-1 sm:flex-none" disabled={busy} onClick={() => setDeclining(true)}>
              Decline
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-divider pt-3">
          <label className="flex-1 min-w-[180px]">
            <span className="label mb-1 block">Your name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alma Reyes" />
          </label>
          <label className="flex-[2] min-w-[220px]">
            <span className="label mb-1 block">Why not? This becomes part of the incident record</span>
            <input
              className="field"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. her daughter is already driving over"
            />
          </label>
          <div className="flex w-full gap-2 sm:w-auto">
            <button
              type="button"
              className="btn-primary flex-1 sm:flex-none"
              disabled={busy || !reason.trim()}
              onClick={() => void run(() => api.declineDispatch(d.id, { name: name.trim(), reason: reason.trim() }))}
            >
              {busy ? 'Recording…' : 'Record the decline'}
            </button>
            <button type="button" className="btn-secondary flex-1 sm:flex-none" disabled={busy} onClick={() => setDeclining(false)}>
              Back
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 rounded border border-rejected/30 bg-rejected-tint px-3 py-2 text-12 text-rejected">{error}</p>}
    </article>
  )
}
