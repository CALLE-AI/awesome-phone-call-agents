import { Pill } from './Pill'
import { CheckIcon } from './Icons'
import { checkSentence, outcomeBlurb, outcomeLabel, outcomeTone } from '../lib/status'
import { fmtSeconds, fmtTime } from '../lib/utils'
import type { CheckOutcome, CheckResult } from '../types'

/**
 * What one check-in call established, in the neighbour's own words wherever possible.
 *
 * `concerns` comes back from CALL-E as close to what they actually said as the extraction could
 * manage, and it is rendered as quotation rather than as a tidy list of flags. "My cooler quit
 * yesterday" tells the captain something that `too_hot: yes` does not, and it is what she will
 * repeat to whoever she sends round.
 */
export function OutcomeDetail({
  outcome,
  reason,
  concerns,
  lastWords,
  result,
  durationS,
  at,
  helpAccepted,
  helpDeclined,
}: {
  outcome: CheckOutcome | null
  reason: string
  concerns: string[]
  lastWords: string
  result: CheckResult | null
  durationS: number | null
  at: string | null
  helpAccepted?: string[]
  helpDeclined?: string[]
}) {
  const checks = Object.entries(result?.checks ?? {})
    .map(([k, v]) => ({ k, s: checkSentence(k, String(v)) }))
    .filter((x): x is { k: string; s: { text: string; good: boolean } } => !!x.s)
  const accepted = helpAccepted ?? result?.help_accepted ?? []
  const declined = helpDeclined ?? result?.help_declined ?? []
  const equipment = result?.equipment_hours_remaining ?? ''
  const callBack = result?.call_back_requested === 'yes' ? result?.call_back_time || 'yes' : ''

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-divider px-3.5 py-2.5">
        <Pill tone={outcomeTone(outcome)}>{outcomeLabel(outcome)}</Pill>
        <span className="text-12 text-muted">{outcomeBlurb(outcome)}</span>
        <span className="ml-auto shrink-0 font-mono text-11 text-faint">
          {at ? fmtTime(at) : ''} {durationS != null ? `· ${fmtSeconds(durationS)}` : ''}
        </span>
      </div>

      {reason && <p className="border-b border-divider px-3.5 py-2.5 text-13 leading-snug text-text">{reason}</p>}

      {lastWords && (
        <div className="border-b border-divider bg-strip px-3.5 py-3">
          <span className="label">The line that mattered</span>
          <blockquote className="mt-1.5 border-l-2 border-partial pl-2.5 text-14 italic leading-snug text-text">
            “{lastWords}”
          </blockquote>
        </div>
      )}

      {concerns.length > 0 && (
        <div className="border-b border-divider px-3.5 py-3">
          <span className="label">What they told us</span>
          <ul className="mt-1.5 space-y-1.5">
            {concerns.map((c, i) => (
              <li key={i} className="text-13 leading-snug text-text">
                “{c}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {checks.length > 0 && (
        <div className="border-b border-divider px-3.5 py-3">
          <span className="label">Established on the call</span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {checks.map(({ k, s }) => (
              <span
                key={k}
                className={s.good ? 'pill bg-verified-tint text-verified-text' : 'pill bg-rejected-tint text-rejected'}
              >
                {s.text}
              </span>
            ))}
          </div>
          {equipment && <p className="mt-2 text-12 text-muted">Equipment will last: “{equipment}”</p>}
          {callBack && <p className="mt-1 text-12 text-muted">Asked to be called back: {callBack}</p>}
        </div>
      )}

      {(accepted.length > 0 || declined.length > 0) && (
        <div className="px-3.5 py-3">
          <span className="label">Help offered</span>
          <div className="mt-1.5 space-y-1">
            {accepted.map((k) => (
              <div key={k} className="flex items-center gap-1.5 text-13 text-text">
                <CheckIcon size={13} />
                <span>
                  Accepted <strong className="font-medium">{k.replace(/_/g, ' ')}</strong>
                </span>
              </div>
            ))}
            {declined.map((k) => (
              <div key={k} className="flex items-center gap-1.5 text-13 text-muted">
                <span className="w-[13px] text-center text-faint">–</span>
                <span>Turned down {k.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
