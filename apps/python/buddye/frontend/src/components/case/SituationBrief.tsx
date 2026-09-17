import type { SituationBrief as Brief } from './caseApi'

/**
 * The model-written summary, above the call data it summarises.
 *
 * Two things this component is careful about, both of them about trust rather than looks:
 *
 * It is **labelled as written by a model**, always. A coordinator acting on this at 2am is entitled
 * to know which sentences a machine composed and which are the record. The hard data sits directly
 * below and is never replaced by this.
 *
 * It **shows its confidence**, including when that is low. A short or confused call produces a
 * weak brief, and hiding that would be the one failure mode that actually costs someone something:
 * a summary that reads as certain when the call established very little.
 */
export function SituationBriefCard({ brief, state }: { brief: Brief | null; state: string }) {
  if (state === 'waiting') {
    return (
      <div className="rounded border border-dashed border-edge bg-strip px-4 py-3">
        <div className="flex items-center gap-2 text-12 text-faint">
          <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-faint" />
          Writing the situation brief — the call data below is complete and does not wait for it.
        </div>
      </div>
    )
  }
  // No brief and not waiting: say nothing. The page is whole without it, and an error box for a
  // summary that never arrived would imply something is broken when nothing is.
  if (!brief || !brief.generated) return null

  const confidence = brief.confidence
  const tone =
    confidence === 'high' ? 'text-verified-text' : confidence === 'medium' ? 'text-partial' : 'text-faint'

  return (
    <section className="rounded border border-border bg-surface shadow-panel">
      <header className="flex items-center justify-between border-b border-divider px-4 py-2">
        <span className="label">Situation brief</span>
        <span className="flex items-center gap-3 text-11 text-faint">
          <span className={tone}>confidence: {confidence}</span>
          <span className="rounded-pill bg-strip px-1.5 py-0.5 font-mono">written by a model</span>
        </span>
      </header>
      <div className="space-y-3 px-4 py-3">
        <p className="text-15 font-semibold leading-snug text-text">{brief.headline}</p>
        {brief.brief && <p className="text-13 leading-relaxed text-muted">{brief.brief}</p>}
        {(brief.next_step || brief.watch_for) && (
          <dl className="space-y-2 border-t border-divider pt-3">
            {brief.next_step && (
              <div className="flex gap-3">
                <dt className="label w-24 shrink-0 pt-0.5">Next step</dt>
                <dd className="text-13 text-text">{brief.next_step}</dd>
              </div>
            )}
            {brief.watch_for && (
              <div className="flex gap-3">
                <dt className="label w-24 shrink-0 pt-0.5">Watch for</dt>
                <dd className="text-13 text-muted">{brief.watch_for}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </section>
  )
}
