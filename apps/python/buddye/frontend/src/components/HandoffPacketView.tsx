import { useState } from 'react'
import { ApiError, api } from '../api'
import { Pill } from './Pill'
import { AlertIcon, BoltIcon, DocumentIcon, LockIcon } from './Icons'
import { fmtMask, fmtTime, humanize } from '../lib/utils'
import type { HandoffPacket } from '../types'

function snap(packet: HandoffPacket, key: string): unknown {
  return packet.neighbour_snapshot?.[key]
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2 border-b border-divider py-1.5 last:border-b-0">
      <span className="text-11 uppercase tracking-wide text-faint">{label}</span>
      <span className="text-13 leading-snug text-text">{children}</span>
    </div>
  )
}

/**
 * The responder handoff packet, as the document it is.
 *
 * Three deliberate choices, all of them about the same property.
 *
 *  * **The unreleased banner is the first thing on the page** and it uses the backend's own
 *    sentence, `status_note`. That sentence has been reviewed; softening it here would make the UI
 *    claim something the system does not do.
 *  * **The address, the medical facts and the access notes are shown in full.** `GET
 *    /api/handoffs/{id}` returns them unredacted on purpose — a packet with the address masked out
 *    helps nobody, and putting it in front of a human is the whole point of preparing it. This is
 *    the one surface in the console where that is true.
 *  * **The release control is labelled as a decision, not a send.** It records that a named person
 *    authorised telling a responder, and hands back the script for *that person* to read out.
 *    Nothing in this component, and nothing in the API behind it, dials an emergency service.
 */
export function HandoffPacketView({
  packet,
  captainName,
  onReleased,
}: {
  packet: HandoffPacket
  captainName: string
  onReleased: (p: HandoffPacket) => void
}) {
  // Deliberately NOT pre-filled with the captain's name. Typing it is the authorisation: a name
  // already sitting in the box turns a decision into a button press, and this is the one moment in
  // the product where a person is accepting responsibility for what a stranger is about to be told.
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const powerDependent = !!snap(packet, 'power_dependent')
  const backupHours = Number(snap(packet, 'power_backup_hours') ?? 0)
  const conditions = (snap(packet, 'conditions') as string[] | undefined) ?? []
  const address = [str(snap(packet, 'address')), str(snap(packet, 'unit'))].filter(Boolean).join(', ')
  const access = str(snap(packet, 'access_notes'))
  const mobility = str(snap(packet, 'mobility'))
  const attempts = packet.attempts_summary ?? []

  const release = async () => {
    setBusy(true)
    setError(null)
    try {
      const updated = await api.releaseHandoff(packet.id, { released_by: name.trim(), note: note.trim() })
      onReleased(updated)
      setConfirming(false)
    } catch (err) {
      // The backend refuses "system", "automation" and an empty name, and its `detail` explains
      // why. Shown verbatim: this is the one place a person is being asked to take responsibility.
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {packet.released ? (
        <div className="rounded border border-partial/30 bg-partial-tint px-3.5 py-3">
          <div className="flex items-center gap-2 text-partial">
            <DocumentIcon size={16} />
            <span className="text-13 font-semibold">Released by {packet.released_by}</span>
          </div>
          <p className="mt-1 text-12 leading-snug text-text">
            {packet.released_by} decided at {fmtTime(packet.released_at)} that a responder should be told, and has the
            script below to read out. BuddyE did not contact anyone.
          </p>
          {packet.release_note && <p className="mt-1 text-12 italic text-muted">{packet.release_note}</p>}
        </div>
      ) : (
        <div className="rounded border border-edge bg-strip px-3.5 py-3">
          <div className="flex items-center gap-2 text-text">
            <LockIcon size={16} />
            <span className="text-13 font-semibold">Prepared, not sent</span>
          </div>
          <p className="mt-1 text-12 leading-snug text-muted">{packet.status_note}</p>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-divider px-3.5 py-2.5">
          <span className="label">What a responder would be told</span>
          <span className="ml-auto font-mono text-11 text-faint">prepared {fmtTime(packet.prepared_at)}</span>
        </div>

        <div className="px-3.5 py-2">
          <Line label="Address">
            <span className="font-medium">{address || 'not on file'}</span>
          </Line>
          <Line label="Person">
            {str(snap(packet, 'name'))}
            {snap(packet, 'lives_alone') ? ' · lives alone' : ''}
            {str(snap(packet, 'age_band')) ? ` · ${humanize(str(snap(packet, 'age_band')))}` : ''}
          </Line>
          {(powerDependent || conditions.length > 0) && (
            <Line label="Medical">
              <span className="flex flex-wrap items-center gap-1.5">
                {powerDependent && (
                  <span className="pill gap-1 bg-rejected-tint text-rejected">
                    <BoltIcon size={12} />
                    Mains-powered equipment · {backupHours > 0 ? `${backupHours}h battery` : 'no battery backup'}
                  </span>
                )}
                {conditions.map((c) => (
                  <span key={c} className="pill bg-ground text-muted">
                    {c}
                  </span>
                ))}
              </span>
            </Line>
          )}
          {mobility && mobility !== 'independent' && <Line label="Mobility">{mobility.replace(/_/g, ' ')}</Line>}
          {access && <Line label="Access">{access}</Line>}
          <Line label="Last spoken to">
            {packet.last_contact_at ? fmtTime(packet.last_contact_at) : 'never reached today'}
          </Line>
          <Line label="Attempts">
            {attempts.length} call{attempts.length === 1 ? '' : 's'} logged
          </Line>
          <Line label="Phone">{fmtMask(str(snap(packet, 'phone')))}</Line>
        </div>

        {packet.last_words && (
          <div className="border-t border-divider bg-strip px-3.5 py-3">
            <span className="label">Their own words, verbatim</span>
            <blockquote className="mt-1.5 border-l-2 border-partial pl-2.5 text-14 italic leading-snug text-text">
              “{packet.last_words}”
            </blockquote>
          </div>
        )}

        {packet.concerns.length > 0 && (
          <div className="border-t border-divider px-3.5 py-3">
            <span className="label">Reported</span>
            <ul className="mt-1.5 space-y-1">
              {packet.concerns.map((c, i) => (
                <li key={i} className="flex gap-1.5 text-13 leading-snug text-text">
                  <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-divider bg-rejected-tint/40 px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-rejected">
            <AlertIcon size={14} />
            <span className="label text-rejected">Recommended</span>
          </div>
          <p className="mt-1 text-13 font-medium leading-snug text-text">{packet.recommended_action}</p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-divider px-3.5 py-2.5">
          <span className="label">Script for a person to read out</span>
        </div>
        <pre className="thin-scroll overflow-x-auto whitespace-pre-wrap px-3.5 py-3 font-mono text-12 leading-[1.65] text-text">
          {packet.spoken_script}
        </pre>
      </section>

      {attempts.length > 0 && (
        <section className="card overflow-hidden">
          <div className="border-b border-divider px-3.5 py-2.5">
            <span className="label">Every call logged about them</span>
          </div>
          <ul>
            {attempts.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-divider px-3.5 py-2 last:border-b-0">
                <span className="font-mono text-11 text-faint">{fmtTime(str(a.at))}</span>
                <span className="text-12 text-text">
                  {a.callee === 'emergency_contact' ? 'their emergency contact' : 'them'}
                </span>
                <Pill tone={a.reached ? 'verified' : 'grey'}>{a.reached ? 'spoke to them' : str(a.status).toLowerCase()}</Pill>
                {a.note ? <span className="w-full text-12 leading-snug text-muted">{str(a.note)}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!packet.released && (
        <section className="card overflow-hidden border-partial/40">
          <div className="border-b border-divider bg-partial-tint/50 px-3.5 py-2.5">
            <span className="label text-partial">Your decision</span>
            <p className="mt-1 text-12 leading-snug text-text">
              Releasing records that <em>you</em> decided a responder should be told, and gives you the script above to
              read out. BuddyE does not call 911 or any agency — it never has and there is no button here that makes it.
            </p>
          </div>
          <div className="space-y-2.5 px-3.5 py-3">
            <label className="block">
              <span className="label">Your name</span>
              <input
                className="field mt-1"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setConfirming(false)
                  setError(null)
                }}
                placeholder={captainName ? `e.g. ${captainName}` : 'the person taking responsibility'}
                autoComplete="name"
              />
            </label>
            <label className="block">
              <span className="label">Note (optional)</span>
              <input
                className="field mt-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="what you saw, who you rang"
              />
            </label>
            {error && <p className="text-12 leading-snug text-rejected">{error}</p>}
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex-1 text-12 leading-snug text-text">
                  Release this packet as <strong>{name.trim()}</strong>?
                </span>
                <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn-danger" onClick={() => void release()} disabled={busy}>
                  {busy ? 'Recording…' : 'Yes, release it'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-danger w-full justify-center"
                disabled={!name.trim()}
                onClick={() => setConfirming(true)}
              >
                Release to a responder
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
