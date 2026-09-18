import { useState } from 'react'
import { FileText, Lock } from 'lucide-react'
import { ApiError, api } from '../../api'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Field'
import { dispatchLabel, dispatchTone, etaText, isAgency, kindLabel, milesText } from '../../lib/operator'
import { badgeTone } from './labels'
import type { DispatchRow } from '../../types'

/**
 * One resource, what it would take to get there, why the agent picked it — and the decision.
 *
 * The two paths through this component are not styling variants of each other. They are the
 * product's central distinction, drawn in `app/domain/state.py::requires_authorisation`:
 *
 *  * A **community resource** — a wellness van, a volunteer driver, a case of water — is something
 *    an agent may commit on its own. Sending a neighbour with water to a hot house is a recoverable
 *    mistake, and waiting on a human costs more than it saves. When one is still PROPOSED the human
 *    is *confirming*, and the button says so.
 *  * An **agency unit** — ambulance, fire engine, police welfare check — is a decision only a named
 *    person may take. A false ambulance call takes a unit away from somebody else's emergency. So
 *    the request stays visibly unsent, the packet a crew would be read is one click away, approval
 *    needs a name, and denial asks why. Nothing in this component sends anything to an agency: the
 *    endpoint behind Approve records the authorisation, and a person makes the call.
 *
 * Approve and Deny are the same size and the same weight. A screen that pushes towards yes is a
 * screen that stops being read, and "no, her daughter is already driving over" has to be as easy to
 * say as the other answer.
 */
export function AssetProposal({
  d,
  basis,
  source,
  operatorName,
  onOpenPacket,
  onDecided,
}: {
  d: DispatchRow
  /** The agent's grounds for this unit, from its own provenance row. */
  basis: string
  /** Which agent wrote them — a model name, or the deterministic picker. */
  source: string
  operatorName: string
  /** Present only when a responder packet exists for this case. */
  onOpenPacket?: () => void
  onDecided: () => void
}) {
  const [name, setName] = useState(operatorName)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [denying, setDenying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const agency = isAgency(d)
  const awaiting = d.status === 'PROPOSED' && agency
  const proposedCommunity = d.status === 'PROPOSED' && !agency

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onDecided()
    } catch (err) {
      // The backend's `detail` is the sentence explaining why a name was refused. Verbatim.
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** The same control either side of the decision; only the urgency in the label changes. */
  const packetButton = (className?: string) =>
    onOpenPacket ? (
      <Button size="sm" variant="secondary" className={className} icon={<FileText size={13} />} onClick={onOpenPacket}>
        {awaiting ? 'Read the responder packet first' : 'Read the responder packet'}
      </Button>
    ) : null

  return (
    <article
      className={
        awaiting
          ? 'rounded border border-p1/40 bg-p1-tint/40'
          : 'rounded border border-border bg-surface'
      }
    >
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-3 pt-2.5">
        <span className="text-13 font-semibold text-text">
          {kindLabel(d.kind)} <span className="font-mono">{d.call_sign}</span>
        </span>
        {d.operator_name ? <span className="text-12 text-muted">{d.operator_name}</span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {awaiting ? <Lock size={12} className="text-p1-text" aria-hidden="true" /> : null}
          <Badge tone={badgeTone(dispatchTone(d))} size="sm">
            {dispatchLabel(d)}
          </Badge>
        </span>
      </header>

      {/* Distances and times are computed by the backend from real coordinates. Mono so a ticking
          ETA does not shift the line beside it. */}
      <p className="px-3 pt-1 font-mono text-12 tabular-nums text-muted">
        {milesText(d.distance_miles)} · {etaText(d.eta_minutes)}
        {d.status === 'EN_ROUTE' ? ` · ${Math.round(d.progress * 100)}% of the way` : ''}
        {d.authorised_by ? <span className="font-sans"> · approved by {d.authorised_by}</span> : null}
      </p>

      {basis ? (
        <div className="mx-3 mt-2 rounded border border-divider bg-strip px-2.5 py-2">
          <div className="label">Why this unit</div>
          <p className="mt-1 text-13 leading-snug text-text">{basis}</p>
          {source ? <p className="mt-1 text-11 text-faint">{source}</p> : null}
        </div>
      ) : d.reason ? (
        <p className="px-3 pt-1.5 text-13 leading-snug text-text">{d.reason}</p>
      ) : null}

      {/* The backend's own sentence for this state. Never softened, never rewritten. */}
      {d.status_note ? <p className="px-3 pt-1.5 text-12 leading-snug text-p3-text">{d.status_note}</p> : null}

      {d.decline_reason ? (
        <p className="px-3 pt-1.5 text-12 leading-snug text-muted">
          Denied{d.authorised_by ? ` by ${d.authorised_by}` : ''} — {d.decline_reason}
        </p>
      ) : null}

      {/* The packet outlives the decision. Approving is not the end of this unit's story — the
          coordinator then rings the agency and reads the packet out, so the link has to survive the
          click that the paragraph below promises it for. */}
      {!awaiting && agency && onOpenPacket ? <div className="px-3 pt-2">{packetButton()}</div> : null}

      {awaiting ? (
        <div className="mt-2.5 border-t border-p1/25 px-3 py-2.5">
          <p className="flex items-start gap-1.5 text-12 leading-relaxed text-text">
            <Lock size={13} className="mt-0.5 shrink-0 text-p1-text" aria-hidden="true" />
            <span>
              <strong className="font-semibold">This unit belongs to an agency, so only a person can ask for it.</strong>{' '}
              BuddyE has prepared everything a crew would need and has asked nobody. It cannot dial 911 and has no path
              into an agency dispatch system. Approving records that you, by name, decided to spend this unit — you make
              the call, with the packet in front of you.
            </span>
          </p>

          {packetButton('mt-2')}

          {!denying ? (
            <div className="mt-2.5 flex flex-wrap items-end gap-2">
              <Field
                label="Your name"
                hint="This goes on the record as the person who decided."
                required
                className="min-w-[180px] flex-1"
              >
                {(props) => (
                  <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alma Reyes" />
                )}
              </Field>
              <Field label="Note for the crew" hint="Optional." className="min-w-[180px] flex-1">
                {(props) => (
                  <Input {...props} value={note} onChange={(e) => setNote(e.target.value)} placeholder="anything they should know" />
                )}
              </Field>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!name.trim()}
                  onClick={() => void run(() => api.authoriseDispatch(d.id, { name: name.trim(), note: note.trim() }))}
                >
                  Approve — request {d.call_sign}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setDenying(true)}>
                  Deny
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-2.5 flex flex-wrap items-end gap-2">
              <Field label="Your name" required className="min-w-[160px] flex-1">
                {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field
                label="Why not?"
                hint="This becomes part of the record, and is the half of it people ask about later."
                required
                className="min-w-[220px] flex-[2]"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. her daughter is already driving over"
                  />
                )}
              </Field>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!reason.trim() || !name.trim()}
                  onClick={() => void run(() => api.declineDispatch(d.id, { name: name.trim(), reason: reason.trim() }))}
                >
                  Record the denial
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setDenying(false)}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {proposedCommunity ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-divider px-3 py-2.5">
          <p className="min-w-[220px] flex-1 text-12 leading-snug text-muted">
            A community resource. An agent may commit one of these on its own — you are confirming, not authorising.
          </p>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => api.commitDispatch(d.id))}>
            Send {d.call_sign}
          </Button>
        </div>
      ) : null}

      {d.status === 'ARRIVED' ? (
        <div className="mt-2 border-t border-divider px-3 py-2.5">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void run(() => api.completeDispatch(d.id))}>
            Mark this visit finished
          </Button>
        </div>
      ) : null}

      {/* A decided unit has no footer block, so it needs the bottom padding the others get from
          theirs. Padding on the article instead would double it everywhere else. */}
      {!awaiting && !proposedCommunity && d.status !== 'ARRIVED' ? <div className="pb-2.5" /> : null}

      {error ? (
        <p className="mx-3 mb-2.5 rounded border border-rejected/30 bg-rejected-tint px-2.5 py-1.5 text-12 leading-snug text-rejected">
          {error}
        </p>
      ) : null}
    </article>
  )
}
