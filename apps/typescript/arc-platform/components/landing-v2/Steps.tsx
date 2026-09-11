import { STEPS } from "./content"
import { Reveal } from "./Reveal"
import { SecHead, Wrap } from "./parts"

/** Five columns with dashed dividers on desktop; a stacked list under 900px,
 *  where the divider moves to the top of each item. */
export function Steps() {
  return (
    <section id="how" className="py-16 md:py-24">
      <Wrap>
        <SecHead title={STEPS.title} accent={STEPS.titleAccent} lede={STEPS.lede} />
        {/* Five cards rather than five columns divided by dashed rules. The
            dividers were doing the work a card edge does better, and a row of
            cards that arrive in order reads as a sequence you move through. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[900px]:grid-cols-5">
          {STEPS.items.map((s, i) => {
            const last = i === STEPS.items.length - 1
            return (
              <Reveal key={s.n} delay={i * 130}>
                <div
                  className={[
                    "card-lift flex h-full flex-col gap-3 rounded-card border p-5 shadow-card",
                    /* The gate is the point of the section, so it is the one
                       card that is filled rather than outlined. */
                    last ? "border-lilac-deep bg-lilac" : "border-border bg-surface",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={[
                      "step-badge type-data flex size-9 items-center justify-center rounded-pill",
                      last ? "bg-ink text-paper" : "bg-lilac text-ink",
                    ].join(" ")}
                  >
                    {s.n}
                  </span>
                  <h3 className={last ? "font-display text-h3 text-ink" : "font-display text-h3 text-text"}>
                    {s.h}
                  </h3>
                  <p className={last ? "text-small text-ink/70" : "text-small text-text-muted"}>{s.p}</p>
                  <span
                    className={[
                      "type-data mt-auto w-fit rounded-pill px-2.5 py-1",
                      last ? "bg-paper text-ink" : "bg-lilac text-ink",
                    ].join(" ")}
                  >
                    {s.t}
                  </span>
                </div>
              </Reveal>
            )
          })}
        </div>
      </Wrap>
    </section>
  )
}
