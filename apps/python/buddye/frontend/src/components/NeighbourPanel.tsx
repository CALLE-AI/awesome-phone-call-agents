import { useEffect, useState } from 'react'
import { api } from '../api'
import { Section, Sheet } from './Sheet'
import { LivePill, Pill } from './Pill'
import { BoltIcon, PhoneIcon } from './Icons'
import { LadderView } from './LadderView'
import { OutcomeDetail } from './OutcomeDetail'
import { TranscriptCard } from './TranscriptCard'
import { HandoffPacketView } from './HandoffPacketView'
import { bandLabel, bandTone, phaseIsLive, phaseLabel, phaseTone } from '../lib/status'
import { firstName, fmtMask, fmtTime, fmtTimeToHarm, humanize } from '../lib/utils'
import type { BoardPerson } from '../lib/board'
import type { Escalation, HandoffPacket, NeighbourDetail, TranscriptTurn } from '../types'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 py-1">
      <span className="text-11 uppercase tracking-wide text-faint">{label}</span>
      <span className="text-13 leading-snug text-text">{children}</span>
    </div>
  )
}

/**
 * One person, everything about them.
 *
 * This is where the health details live. `conditions`, the address, the access notes and whether
 * they run equipment off wall power are decision facts — a captain choosing whose door to knock on
 * first needs them — but they are shown here, on a surface she deliberately opened, rather than
 * spread across a list that might be on a screen in a community centre.
 */
export function NeighbourPanel({
  person,
  hazardId,
  captainName,
  escalation,
  onClose,
  onChanged,
}: {
  person: BoardPerson
  hazardId: string
  captainName: string
  escalation: Escalation | null
  onClose: () => void
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<NeighbourDetail | null>(null)
  const [packet, setPacket] = useState<HandoffPacket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const n = person.n
  const risk = n.risk
  const live = person.call && phaseIsLive(person.call.phase)

  useEffect(() => {
    let cancelled = false
    setDetail(null)
    api
      .neighbour(n.id, hazardId)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [n.id, hazardId, person.outcome])

  // The packet is fetched on its own: the list endpoint deliberately omits the snapshots, and the
  // full document — address, medical facts and all — only comes back from GET /api/handoffs/{id}.
  const packetId = person.packet?.id ?? detail?.handoffs?.[0]?.id ?? null
  useEffect(() => {
    let cancelled = false
    if (!packetId) {
      setPacket(null)
      return
    }
    api
      .handoff(packetId)
      .then((p) => {
        if (!cancelled) setPacket(p)
      })
      .catch(() => {
        /* the packet stays unshown rather than the panel breaking */
      })
    return () => {
      cancelled = true
    }
  }, [packetId, person.packet?.released])

  // Live turns while the call is in flight; the persisted transcript once it lands.
  const ownCall = person.call
  const liveTurns: TranscriptTurn[] = ownCall?.transcript ?? ownCall?.liveTurns ?? []
  const storedCall = detail?.calls?.filter((c) => c.callee === 'neighbour').slice(-1)[0] ?? null
  const turns: TranscriptTurn[] = liveTurns.length ? liveTurns : (storedCall?.transcript ?? [])
  const contactCallStored = detail?.calls?.filter((c) => c.callee === 'emergency_contact').slice(-1)[0] ?? null
  const result = ownCall?.structured_result ?? storedCall?.structured_result ?? null
  const hours = fmtTimeToHarm(risk?.time_to_harm_h)

  // The board's escalation is the richer object. When the page has not got it yet — a reload
  // straight into someone's detail — the per-neighbour endpoint carries the same rungs, so the
  // ladder is assembled from those rather than left blank.
  const fallback = detail?.escalations?.[detail.escalations.length - 1]
  const esc: Escalation | null =
    escalation ??
    (fallback
      ? {
          id: fallback.id,
          sweep_id: '',
          hazard_id: hazardId,
          neighbour_id: n.id,
          name: n.name,
          address: n.address,
          outcome: fallback.outcome as Escalation['outcome'],
          level: fallback.level,
          status: fallback.status,
          reason: fallback.reason,
          trigger_call_id: null,
          rungs: fallback.rungs,
          contact_name: n.contact_name,
          contact_relation: n.contact_relation,
          resolved_by: fallback.resolved_by,
          resolved_note: fallback.resolved_note,
          created_at: '',
          updated_at: '',
          resolved_at: null,
          handoffs: [],
        }
      : null)

  return (
    <Sheet
      title={n.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={bandTone(risk?.band)}>{bandLabel(risk?.band)}</Pill>
          {hours && <span>in trouble within {hours}</span>}
          {live && ownCall && <LivePill tone={phaseTone(ownCall.phase)}>{phaseLabel(ownCall.phase)}</LivePill>}
        </span>
      }
      onClose={onClose}
    >
      {error && <p className="mb-3 text-12 text-rejected">{error}</p>}

      {/* Why triage put them where it did. The sentences, never the number on its own. */}
      {risk && risk.reasons.length > 0 && (
        <Section title="Why they are on this list">
          <div className="card px-3.5 py-3">
            <ul className="space-y-1.5">
              {risk.reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-13 leading-snug text-text">
                  <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
                  {r}
                </li>
              ))}
            </ul>
            {!risk.may_call && (
              <p className="mt-2.5 border-t border-divider pt-2.5 text-12 leading-snug text-muted">
                BuddyE did not ring them: {risk.skip_reason || 'they have not opted in to automated check-in calls'}.
              </p>
            )}
          </div>
        </Section>
      )}

      {person.notDialledReason && !person.outcome && (
        <Section title="Not called">
          <p className="card px-3.5 py-3 text-13 leading-snug text-text">{person.notDialledReason}</p>
        </Section>
      )}

      {(person.outcome || ownCall) && (
        <Section title="Their check-in call">
          <OutcomeDetail
            outcome={person.outcome}
            reason={person.reason}
            concerns={person.concerns}
            lastWords={person.lastWords}
            result={result}
            durationS={ownCall?.duration_s ?? storedCall?.duration_s ?? null}
            at={ownCall?.completed_at ?? storedCall?.completed_at ?? n.last_call_at}
            helpAccepted={ownCall?.decision?.help_accepted}
            helpDeclined={ownCall?.decision?.help_declined}
          />
        </Section>
      )}

      {(turns.length > 0 || live) && (
        <Section title="Transcript">
          <TranscriptCard
            turns={turns}
            live={!!live}
            speakerName={firstName(n.name)}
            highlightQuote={person.lastWords}
          />
        </Section>
      )}

      {(person.contactCall || contactCallStored) && (
        <Section title={`Call to ${n.contact_name || 'their emergency contact'}`}>
          <div className="card px-3.5 py-3">
            <div className="flex items-center gap-2">
              <PhoneIcon size={14} />
              <span className="text-13 text-text">
                {n.contact_name}
                {n.contact_relation ? ` · ${n.contact_relation}` : ''}
              </span>
              <span className="ml-auto font-mono text-11 text-faint">
                {fmtTime(person.contactCall?.completed_at ?? contactCallStored?.completed_at ?? null)}
              </span>
            </div>
            {(person.contactCall?.summary || contactCallStored?.summary) && (
              <p className="mt-1.5 text-12 leading-snug text-muted">
                {person.contactCall?.summary ?? contactCallStored?.summary}
              </p>
            )}
            <TranscriptCardInline
              turns={person.contactCall?.transcript ?? person.contactCall?.liveTurns ?? contactCallStored?.transcript ?? []}
              name={firstName(n.contact_name)}
            />
          </div>
        </Section>
      )}

      {esc && (
        <Section title="What BuddyE did next">
          <LadderView escalation={esc} captainName={captainName} onResolved={() => onChanged?.()} />
        </Section>
      )}

      {packet && (
        <Section title="Responder handoff packet">
          <HandoffPacketView packet={packet} captainName={captainName} onReleased={setPacket} />
        </Section>
      )}

      {/* Health and access facts last: they are the reason the board is useful, and they are also
          the most sensitive thing on this screen, so they sit below the decision, not above it. */}
      <Section title="What we know about them">
        <div className="card px-3.5 py-2.5">
          <Fact label="Address">
            {n.address}
            {n.unit ? `, ${n.unit}` : ''}
          </Fact>
          <Fact label="Phone">{fmtMask(n.phone_masked)}</Fact>
          <Fact label="Household">
            {n.age_band}
            {n.lives_alone ? ' · lives alone' : ''}
            {n.preferred_language && n.preferred_language !== 'en-US' ? ` · speaks ${n.preferred_language}` : ''}
          </Fact>
          {n.conditions.length > 0 && (
            <Fact label="Conditions">
              <span className="flex flex-wrap gap-1">
                {n.conditions.map((c) => (
                  <span key={c} className="pill bg-ground text-muted">
                    {c}
                  </span>
                ))}
              </span>
            </Fact>
          )}
          {n.power_dependent && (
            <Fact label="Power">
              <span className="pill gap-1 bg-rejected-tint text-rejected">
                <BoltIcon size={12} />
                Equipment runs off wall power ·{' '}
                {n.power_backup_hours > 0 ? `${n.power_backup_hours}h battery` : 'no battery backup'}
              </span>
            </Fact>
          )}
          <Fact label="Cooling">{humanize(n.cooling)}</Fact>
          {n.mobility && n.mobility !== 'independent' && <Fact label="Mobility">{humanize(n.mobility)}</Fact>}
          {n.access_notes && <Fact label="Access">{n.access_notes}</Fact>}
          <Fact label="Contact">
            {n.contact_name ? (
              <>
                {n.contact_name}
                {n.contact_relation ? ` · ${n.contact_relation}` : ''}
                {!n.has_contact_phone && <span className="ml-1 text-12 text-muted">(no number on file)</span>}
              </>
            ) : (
              <span className="text-muted">nobody nominated</span>
            )}
          </Fact>
          {n.notes && <Fact label="Notes">{n.notes}</Fact>}
        </div>
      </Section>
    </Sheet>
  )
}

/** A stripped transcript for the contact call — it is context, not the main event. */
function TranscriptCardInline({ turns, name }: { turns: TranscriptTurn[]; name: string }) {
  if (!turns.length) return null
  return (
    <div className="thin-scroll mt-2 max-h-[180px] space-y-1.5 overflow-y-auto border-t border-divider pt-2">
      {turns.map((t, i) => (
        <div key={i} className="grid grid-cols-[58px_minmax(0,1fr)] gap-2">
          <span className="truncate font-mono text-11 text-faint">{t.speaker === 'bot' ? 'BuddyE' : name || 'them'}</span>
          <span className="text-12 leading-snug text-text">{t.text}</span>
        </div>
      ))}
    </div>
  )
}
