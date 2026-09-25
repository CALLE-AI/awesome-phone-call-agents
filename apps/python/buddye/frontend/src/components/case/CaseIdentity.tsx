import { KeyRound, MapPin, PhoneOff, UserRound } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { badgeTone } from './caseModel'
import { bandLabel, bandTone, escalationStatusLabel, escalationStatusTone, LADDER_META, rungActionLabel } from '../../lib/status'
import { fmtClock, fmtMask } from '../../lib/utils'
import type { CaseEscalation, CaseHandoff } from './caseApi'
import type { EscalationLevel, Hazard, Neighbour, Risk } from '../../types'

/**
 * Who this person is, where they live, and what makes them vulnerable to *this* hazard.
 *
 * Everything on this panel is health information about a named person, and it is here for exactly
 * one reason: a volunteer standing at the wrong door with the wrong thing in their hands helps
 * nobody. So it is the operational subset — how they cool the house, whether their equipment needs
 * mains power, how they get about, how to get in — and not a medical record.
 */

const AGE_BAND: Record<string, string> = {
  under_65: 'Under 65',
  '65_74': '65 to 74',
  '75_plus': '75 or older',
}

const MOBILITY: Record<string, string> = {
  independent: 'Gets about unaided',
  cane_walker: 'Cane or walker',
  wheelchair: 'Wheelchair',
  bedbound: 'Bedbound',
}

const COOLING: Record<string, string> = {
  central_ac: 'Central air conditioning',
  window_unit: 'One window unit',
  swamp_cooler: 'Evaporative (swamp) cooler',
  fan_only: 'Fans only',
}

const HEATING: Record<string, string> = {
  central: 'Central heating',
  wall_furnace: 'Wall furnace',
  space_heater: 'Space heater',
}

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, ' ')
}

export function WhoTheyAre({ neighbour, hazard }: { neighbour: Neighbour; hazard: Hazard }) {
  // Which line of the household matters depends on the hazard: a heat warning is decided by how
  // the house is cooled, a winter outage by how it is heated. Both are shown, the relevant one
  // first, because the same person is read under both.
  const heatLed = hazard.profile?.swamp_cooler_compromised || hazard.kind === 'heat'
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <MapPin size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-13 leading-snug text-text">
            {neighbour.address}
            {neighbour.unit ? `, ${neighbour.unit}` : ''}
          </p>
          <p className="mt-0.5 font-mono text-11 tabular-nums text-faint">{fmtMask(neighbour.phone_masked)}</p>
        </div>
      </div>

      {neighbour.access_notes ? (
        <div className="flex items-start gap-2.5 rounded border border-border bg-strip px-3 py-2.5">
          <KeyRound size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
          <div className="min-w-0">
            <p className="label">Getting in</p>
            <p className="mt-1 text-13 leading-relaxed text-text">{neighbour.access_notes}</p>
          </div>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
        <Fact label="Age" value={label(AGE_BAND, neighbour.age_band)} />
        <Fact label="Household" value={neighbour.lives_alone ? 'Lives alone' : 'Someone else at home'} />
        <Fact label="Mobility" value={label(MOBILITY, neighbour.mobility)} />
        <Fact label="Own transport" value={neighbour.has_transport ? 'Yes' : 'No vehicle'} />
        {heatLed ? (
          <Fact label="Cooling" value={label(COOLING, neighbour.cooling)} />
        ) : (
          <Fact label="Heating" value={label(HEATING, neighbour.heating)} />
        )}
        <Fact label="Speaks" value={neighbour.preferred_language} mono />
      </dl>

      {/* Power dependency is its own row rather than a chip in a list: it is the single fact that
          changes what an unanswered telephone means. */}
      {neighbour.power_dependent ? (
        <div className="rounded border border-rejected/30 bg-rejected-tint px-3 py-2.5">
          <p className="text-13 font-semibold leading-snug text-rejected">Medical equipment on mains power</p>
          <p className="mt-0.5 text-12 leading-snug text-text">
            {neighbour.power_backup_hours > 0
              ? `About ${neighbour.power_backup_hours} hours of backup if the power goes.`
              : 'No backup on file if the power goes.'}
          </p>
        </div>
      ) : null}

      {neighbour.conditions.length ? (
        <div>
          <p className="label mb-1.5">On file</p>
          <div className="flex flex-wrap gap-1.5">
            {neighbour.conditions.map((c) => (
              <span key={c} className="inline-flex items-center rounded-pill border border-border bg-surface px-2 py-0.5 text-12 text-muted">
                {c}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {neighbour.notes ? <p className="text-12 leading-relaxed text-muted">{neighbour.notes}</p> : null}
    </div>
  )
}

function Fact({ label: name, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label">{name}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-13 text-text' : 'mt-0.5 text-13 text-text'}>{value}</dd>
    </div>
  )
}

/**
 * Why triage put this person where it did — every reason, in full.
 *
 * The catalogue shows one line; the case shows all of them, because this is the page where somebody
 * decides whether the machine got it right. The score is shown beside the band and never on its
 * own: a number with no sentences under it invites arguing with the arithmetic instead of with the
 * reasoning.
 */
export function WhyAtRisk({ risk, reasons, hazardHeadline }: { risk: Risk | null; reasons: string[]; hazardHeadline: string }) {
  if (!risk) return <p className="text-13 text-muted">This person has not been triaged against this hazard.</p>
  const lines = reasons.length ? reasons : risk.reasons ?? []
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={badgeTone(bandTone(risk.band))}>{bandLabel(risk.band)}</Badge>
        <span className="font-mono text-13 tabular-nums text-muted">{Math.round(risk.score)}</span>
        {hazardHeadline ? <span className="text-12 text-muted">against {hazardHeadline}</span> : null}
      </div>
      <ul className="space-y-1.5">
        {lines.map((reason) => (
          <li key={reason} className="flex gap-2 text-13 leading-relaxed text-text">
            <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
            {reason}
          </li>
        ))}
      </ul>
      {risk.skip_reason ? <p className="text-12 leading-snug text-muted">{risk.skip_reason}</p> : null}
    </div>
  )
}

/**
 * The person they nominated — or, said plainly, that there is nobody.
 *
 * "No emergency contact" is a finding and is rendered as one. It is the difference between a first
 * rung the ladder can climb and a case that goes straight to a block captain with nobody in
 * between, and a blank space where a name should be reads as missing data rather than as the fact
 * it is.
 */
export function EmergencyContact({ neighbour }: { neighbour: Neighbour }) {
  if (!neighbour.contact_name) {
    return (
      <div className="flex items-start gap-2.5">
        <PhoneOff size={15} className="mt-0.5 shrink-0 text-rejected" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-13 font-medium text-text">Nobody nominated</p>
          <p className="mt-0.5 text-12 leading-snug text-muted">
            There is no emergency contact on file. If this person cannot be reached there is no one to ring before the
            block captain.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2.5">
      <UserRound size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-13 text-text">
          {neighbour.contact_name}
          {neighbour.contact_relation ? <span className="text-muted"> — {neighbour.contact_relation}</span> : null}
        </p>
        <p className="mt-0.5 text-12 leading-snug text-muted">
          {neighbour.has_contact_phone
            ? 'A number is on file. BuddyE may ring them; it never rings an agency.'
            : 'No number on file for them, so this rung cannot be called.'}
        </p>
      </div>
    </div>
  )
}

/**
 * The escalation ladder, rung by rung, with who does the acting on each one.
 *
 * `LADDER_META` carries that last part and it is quoted rather than paraphrased: BuddyE calls an
 * emergency contact, it puts things on the captain's board, and at the responder rung it prepares a
 * packet and stops. A handoff packet's `status_note` is the backend's own sentence for whether
 * anybody has been told, and it is printed exactly as written.
 */
export function LadderPanel({ escalations, handoffs }: { escalations: CaseEscalation[]; handoffs: CaseHandoff[] }) {
  if (!escalations.length && !handoffs.length) {
    return <p className="text-13 text-muted">Nothing has been escalated for this person.</p>
  }
  return (
    <div className="space-y-4">
      {escalations.map((esc) => (
        <div key={esc.id}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(escalationStatusTone(esc.status))}>{escalationStatusLabel(esc.status)}</Badge>
            <span className="text-12 text-muted">{LADDER_META[esc.level as EscalationLevel]?.label ?? esc.level}</span>
          </div>
          {esc.reason ? <p className="mt-1.5 text-12 leading-relaxed text-muted">{esc.reason}</p> : null}
          <ol className="mt-2 space-y-1.5 border-l border-divider pl-3">
            {esc.rungs.map((rung, i) => (
              <li key={`${rung.at}-${i}`} className="text-12 leading-snug">
                <span className="font-mono tabular-nums text-faint">{fmtClock(rung.at)}</span>{' '}
                <span className="text-text">{rungActionLabel(rung.action)}</span>{' '}
                <span className="text-muted">— {LADDER_META[rung.level]?.who ?? rung.level}</span>
                {rung.result ? <p className="mt-0.5 text-muted">{rung.result}</p> : null}
              </li>
            ))}
          </ol>
          {esc.resolved_by ? (
            <p className="mt-1.5 text-12 text-muted">
              Resolved by {esc.resolved_by}
              {esc.resolved_note ? ` — ${esc.resolved_note}` : ''}
            </p>
          ) : null}
        </div>
      ))}

      {handoffs.map((packet) => (
        <div key={packet.id} className="rounded border border-rejected/30 bg-rejected-tint px-3 py-2.5">
          <p className="text-13 font-semibold leading-snug text-rejected">Responder packet</p>
          <p className="mt-1 text-13 leading-relaxed text-text">{packet.recommended_action}</p>
          {/* Verbatim. This sentence is the safety property of the product, not copy. */}
          <p className="mt-1.5 text-12 leading-snug text-muted">{packet.status_note}</p>
        </div>
      ))}
    </div>
  )
}
