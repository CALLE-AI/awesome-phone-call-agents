import { HERO, RATE_DESK } from "./content"
import { RateTicker } from "./RateTicker"
import { Mark } from "@/components/ui/mark"
import { BtnGhost, BtnPrimary, Wrap } from "./parts"

/**
 * D. Hero entrance: six items, 500ms each, 80ms apart, once on load. Pure CSS
 * with animation-delay and fill-mode both, so nothing waits on hydration.
 *
 * A. The rate desk ticker lives in RateTicker - it needs the reduced-motion
 * preference, which only the client knows.
 */
export function Hero() {
  return (
    <section className="py-[56px] md:pt-[88px] md:pb-[72px]">
      <Wrap className="grid grid-cols-1 items-center gap-14 min-[900px]:grid-cols-[1.15fr_.85fr]">
        <div>
          <div
            className="rise mb-5 flex items-center gap-2 type-label text-text-muted"
            style={{ animationDelay: "0ms" }}
          >
            <span className="live-dot size-2 flex-none rounded-pill bg-success" />
            {HERO.kicker}
          </div>

          <h1
            className="rise mb-6 font-display text-display text-text"
            style={{ animationDelay: "80ms" }}
          >
            {/* Mark goes behind ONE word, not the second sentence.

                Overridden at the call site rather than in the component,
                because the defaults are right at body size and wrong at
                display size. Measured: 0.15em padding on a 56px heading is
                8.5px each way, which made the painted box 84px tall against a
                59px line-height - so the highlight sat on the words in the
                lines above and below. Vertical padding is zero here and the
                horizontal is halved.

                Lilac rather than butter: cooler, and it is the same pastel the
                step badges use, so the page has one accent instead of two. Wrapping the
                whole clause produced a three-line butter slab - the component's
                own note says it is "a block behind key words" and stops working
                when it repeats or sprawls. The app's original hero marked
                exactly this word. */}
            {HERO.title.split("never")[0]}
            <Mark className="bg-lilac px-[0.06em] py-0">never</Mark>
            {HERO.title.split("never")[1]} {HERO.titleAccent}
          </h1>

          <p
            className="rise mb-8 max-w-2xl text-body text-text-muted"
            style={{ animationDelay: "160ms" }}
          >
            {HERO.lede}
          </p>

          <div className="rise mb-5 flex flex-wrap gap-3.5" style={{ animationDelay: "240ms" }}>
            <BtnPrimary href="/sign-up">{HERO.primary}</BtnPrimary>
            <BtnGhost href="#how">{HERO.secondary}</BtnGhost>
          </div>

          <p className="rise text-small text-text-muted" style={{ animationDelay: "320ms" }}>
            {HERO.note.before}
            <b className="font-medium text-text">{HERO.note.bold}</b>
            {HERO.note.after}
          </p>
        </div>

        <div
          className="rise-card rounded-card border border-border bg-surface p-6 shadow-card"
          style={{ animationDelay: "400ms" }}
          aria-label="Recent confirmed rates from Arc's rate desk"
        >
          <div className="flex items-center justify-between border-b border-border pb-4 text-small font-medium text-text">
            <span>{RATE_DESK.label}</span>
            <span className="type-data flex items-center gap-2 text-text-muted">
              <span className="live-dot size-2 rounded-pill bg-success" />
              {RATE_DESK.live}
            </span>
          </div>

          <RateTicker />

        </div>
      </Wrap>
    </section>
  )
}
