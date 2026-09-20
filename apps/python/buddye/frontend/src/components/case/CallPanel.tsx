import { useState } from 'react'
import { Check, PhoneOff, Quote, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button, cx } from '../ui/Button'
import { Transcript } from './Transcript'
import { badgeTone } from './caseModel'
import type { CaseCallView, ReconcileMeta } from './caseModel'
import { checkSentence, outcomeBlurb, outcomeLabel, outcomeTone, phaseLabel, phaseTone } from '../../lib/status'
import { fmtClock, fmtSeconds, humanize } from '../../lib/utils'
import type { HelpOffer } from '../../types'

/**
 * One call to this person: what is happening on the line, or what came back from it.
 *
 * The panel is written so that the two findings a coordinator has to act on are the two that read
 * loudest. **Nobody answered** is one of them: for a neighbour whose oxygen concentrator runs on
 * wall power, an unanswered telephone is not a gap in the record, it is the most alarming thing on
 * the screen, and a console that renders it as an empty transcript is the failure this product
 * exists to avoid. The other is the person's own words — quoted, never paraphrased.
 */

export interface CallPanelProps {
  call: CaseCallView
  /** From the hazard: the exact wording the caller was able to offer, keyed by offer id. */
  offers: HelpOffer[]
  /** field -> the words that decided it, from the understanding layer. May be empty. */
  evidence: Record<string, string>
  reconcile: ReconcileMeta | null
  /** Their oxygen or medical equipment runs on mains power. Changes what silence means. */
  powerDependent: boolean
  /** Older calls come in collapsed; the latest one is open. */
  defaultOpen?: boolean
}

export function CallPanel({ call, offers, evidence, reconcile, powerDependent, defaultOpen = true }: CallPanelProps) {
  const [showTranscript, setShowTranscript] = useState(defaultOpen)
  const offerLabel = (key: string) => offers.find((o) => o.key === key)?.label ?? humanize(key)
  const result = call.result

  const noAnswer = call.phase === 'no_answer' || call.status === 'NO_ANSWER'
  const failed = call.phase === 'failed'

  return (
    <section className="overflow-hidden rounded border border-border bg-surface">
      {/* The state of the call itself, always on the same line in the same place. */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-divider bg-strip px-4 py-2.5">
        <Badge tone={badgeTone(phaseTone(call.phase))} dot={call.live} pulse={call.live}>
          {phaseLabel(call.phase)}
        </Badge>
        {/* UNREACHABLE reads as "No answer" and so does the phase it produced. One badge, not the
            same word twice. */}
        {call.outcome && outcomeLabel(call.outcome) !== phaseLabel(call.phase) ? (
          <Badge tone={badgeTone(outcomeTone(call.outcome))}>{outcomeLabel(call.outcome)}</Badge>
        ) : null}
        <span className="text-12 text-muted">
          Attempt <span className="font-mono tabular-nums">{call.attempt}</span>
        </span>
        {call.started_at ? (
          <span className="font-mono text-12 tabular-nums text-faint">{fmtClock(call.started_at)}</span>
        ) : null}
        {call.duration_s != null ? (
          <span className="font-mono text-12 tabular-nums text-faint">{fmtSeconds(call.duration_s)}</span>
        ) : null}
        <span className="ml-auto text-11 uppercase text-faint" style={{ letterSpacing: '0.06em' }}>
          {call.provider}
        </span>
      </header>

      <div className="space-y-3.5 p-4">
        {/* --- nobody picked up ------------------------------------------------------------- */}
        {noAnswer ? (
          <div className="flex items-start gap-3 rounded border border-rejected/30 bg-rejected-tint px-3.5 py-3">
            <PhoneOff size={17} className="mt-0.5 shrink-0 text-rejected" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-15 font-semibold leading-tight text-rejected">Nobody answered</p>
              <p className="mt-1 text-13 leading-relaxed text-text">
                {powerDependent
                  ? 'This is the finding, not a gap. Their medical equipment runs on mains power and there is no voice on the record to weigh against the silence.'
                  : 'We rang and nobody picked up. There is no voice on the record for this address.'}
              </p>
              {call.reason ? <p className="mt-1.5 text-12 leading-snug text-muted">{call.reason}</p> : null}
            </div>
          </div>
        ) : null}

        {failed ? (
          <div className="rounded border border-rejected/30 bg-rejected-tint px-3.5 py-3">
            <p className="text-13 font-semibold text-rejected">The call failed before anyone could be reached</p>
            {call.failure ? <p className="mt-1 text-12 leading-snug text-text">{call.failure}</p> : null}
          </div>
        ) : null}

        {/* --- the live call ---------------------------------------------------------------- */}
        {call.live ? (
          <div>
            <p className="label mb-2">The call, as it happens</p>
            {call.turns.length ? (
              <Transcript turns={call.turns} follow maxHeight={280} />
            ) : (
              <p className="text-13 text-muted">
                Ringing. Turns appear here as they are spoken — nothing is buffered.
              </p>
            )}
          </div>
        ) : null}

        {/* --- what was decided ------------------------------------------------------------- */}
        {!call.live && call.outcome && !noAnswer ? (
          <div>
            <p className="text-15 font-semibold leading-snug text-text">{outcomeBlurb(call.outcome)}</p>
            {call.reason ? <p className="mt-1 text-13 leading-relaxed text-muted">{call.reason}</p> : null}
          </div>
        ) : null}

        {call.summary && !call.live ? (
          <p className="border-l-2 border-edge pl-3 text-13 leading-relaxed text-text">{call.summary}</p>
        ) : null}

        {/* --- their own words -------------------------------------------------------------- */}
        {call.lastWords ? (
          <div className="flex items-start gap-2.5 rounded border border-border bg-strip px-3.5 py-3">
            <Quote size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <p className="min-w-0 text-14 italic leading-relaxed text-text">“{call.lastWords}”</p>
          </div>
        ) : null}

        {call.concerns.length ? (
          <div>
            <p className="label mb-1.5">What they told us</p>
            <ul className="space-y-1">
              {call.concerns.map((concern) => (
                <li key={concern} className="flex gap-2 text-13 leading-relaxed text-text">
                  <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-faint" />
                  {concern}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* --- what the checks established -------------------------------------------------- */}
        {result?.checks ? <Checks checks={result.checks} /> : null}

        {/* --- help accepted and declined ---------------------------------------------------- */}
        {result && ((result.help_accepted ?? []).length || (result.help_declined ?? []).length) ? (
          <div>
            <p className="label mb-1.5">Help</p>
            <div className="flex flex-wrap gap-1.5">
              {(result.help_accepted ?? []).map((key) => (
                <span
                  key={`a-${key}`}
                  className="inline-flex items-center gap-1 rounded-pill bg-verified-tint px-2 py-0.5 text-12 font-medium text-verified-text"
                >
                  <Check size={12} aria-hidden="true" /> Accepted {offerLabel(key).toLowerCase()}
                </span>
              ))}
              {(result.help_declined ?? []).map((key) => (
                <span
                  key={`d-${key}`}
                  className="inline-flex items-center gap-1 rounded-pill border border-border bg-surface px-2 py-0.5 text-12 text-muted"
                >
                  <X size={12} aria-hidden="true" /> Turned down {offerLabel(key).toLowerCase()}
                </span>
              ))}
            </div>
            {result.help_offers_stated === 'no' ? (
              <p className="mt-1.5 text-12 leading-snug text-muted">
                The caller never got as far as offering anything on this call.
              </p>
            ) : null}
          </div>
        ) : null}

        {/* --- the understanding layer's evidence -------------------------------------------- */}
        {/* Shown when the understanding layer ran at all — a pass that patched nothing still has
            provenance worth reading, and a blank space would read as "it was never asked". */}
        {!call.live && (call.reconciled || reconcile) ? <Evidence evidence={evidence} meta={reconcile} /> : null}

        {/* --- CALL-E's own judgment of the call -------------------------------------------- */}
        {call.taskEvidence.length && !call.live ? (
          <details className="group">
            <summary className="cursor-pointer list-none text-12 text-muted hover:text-text">
              <span className="underline underline-offset-2">
                CALL-E's own read of the call
                {call.confidence?.label ? ` — ${call.confidence.label} confidence` : ''}
              </span>
            </summary>
            <ul className="mt-2 space-y-1 border-l-2 border-divider pl-3">
              {call.taskEvidence.map((line) => (
                <li key={line} className="text-12 leading-relaxed text-muted">
                  {line}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {call.validationErrors.length ? (
          <div className="rounded border border-partial/40 bg-partial-tint px-3 py-2">
            <p className="text-12 font-medium text-partial">The extraction did not satisfy the contract</p>
            <ul className="mt-1 space-y-0.5">
              {call.validationErrors.map((err) => (
                <li key={err} className="text-12 leading-snug text-muted">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* --- the conversation ------------------------------------------------------------- */}
        {!call.live && call.turns.length ? (
          <div className="border-t border-divider pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="label">
                The conversation — <span className="font-mono tabular-nums">{call.turns.length}</span> turns
              </p>
              <Button size="sm" variant="ghost" onClick={() => setShowTranscript((v) => !v)}>
                {showTranscript ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showTranscript ? <Transcript turns={call.turns} maxHeight={420} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

/**
 * The condition checks, as sentences.
 *
 * `checkSentence` is the authority on wording and on what is worth saying at all: it returns null
 * for "unknown" and for the uninformative side of `too_hot` / `too_cold`, so a screen never shows
 * "House is warm enough" next to "Dangerously hot indoors". Unknowns are counted rather than listed
 * — a field the call never established is worth knowing about, but not worth nine grey chips.
 */
function Checks({ checks }: { checks: Record<string, string> }) {
  const said: { text: string; good: boolean }[] = []
  let unknown = 0
  for (const [field, value] of Object.entries(checks)) {
    if (String(value).toLowerCase() === 'unknown') {
      unknown += 1
      continue
    }
    const sentence = checkSentence(field, value)
    if (sentence) said.push(sentence)
  }
  if (!said.length && !unknown) return null
  return (
    <div>
      <p className="label mb-1.5">What the call established</p>
      <div className="flex flex-wrap gap-1.5">
        {said.map((s) => (
          <span
            key={s.text}
            className={cx(
              'inline-flex items-center rounded-pill px-2 py-0.5 text-12',
              s.good ? 'border border-border bg-surface text-muted' : 'bg-rejected-tint font-medium text-rejected',
            )}
          >
            {s.text}
          </span>
        ))}
        {unknown ? (
          <span className="inline-flex items-center rounded-pill bg-ground px-2 py-0.5 text-12 text-muted">
            <span className="font-mono tabular-nums">{unknown}</span>
            <span className="ml-1">never came up</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Why the understanding layer decided what it decided, in the person's own words.
 *
 * This is the panel that lets a coordinator disagree with the machine about her own neighbour, so
 * an empty one says so out loud rather than rendering as a blank space: "read the transcript,
 * quoted nothing" is a real and different state from "never ran".
 */
function Evidence({ evidence, meta }: { evidence: Record<string, string>; meta: ReconcileMeta | null }) {
  const rows = Object.entries(evidence)
  return (
    <div className="rounded border border-border bg-strip px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="label">The words that decided each field</p>
        {meta ? (
          <p className="text-11 text-faint">
            {meta.model || meta.reconciler}
            {meta.latency_ms != null ? (
              <>
                {' · '}
                <span className="font-mono tabular-nums">{(meta.latency_ms / 1000).toFixed(1)}s</span>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {rows.length ? (
        <dl className="space-y-2">
          {rows.map(([field, quote]) => (
            <div key={field}>
              <dt className="font-mono text-11 text-faint">{field}</dt>
              <dd className="mt-0.5 text-13 italic leading-relaxed text-text">“{quote}”</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-12 leading-snug text-muted">
          The transcript was re-read{meta?.fields.length ? ` for ${meta.fields.join(', ')}` : ''}, but no quote came back
          with the answer. The values above stand on the extraction alone.
        </p>
      )}
    </div>
  )
}
