import { PROBLEM } from "./content"
import { SecHead, Wrap } from "./parts"
import { Reveal } from "./Reveal"

/* The three pastels are fields, in order. BRANDING.md section 9: token names,
   never a hex. */
const FIELDS = ["bg-lilac", "bg-blush", "bg-butter"]

export function Problem() {
  return (
    <section className="bg-surface py-16 md:py-24">
      <Wrap>
        <SecHead title={PROBLEM.title} accent={PROBLEM.titleAccent} lede={PROBLEM.lede} />
        <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-3">
          {PROBLEM.cards.map((c, i) => (
            <Reveal key={c.h} delay={i * 110}>
              <div className="card-lift flex h-full flex-col gap-4 rounded-card border border-border bg-bg p-7 shadow-card">
                <span
                  aria-hidden
                  className={`step-badge type-data flex size-9 items-center justify-center rounded-pill text-ink ${FIELDS[i % FIELDS.length]}`}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-h3 text-text">{c.h}</h3>
                <p className="text-small text-text-muted">{c.p}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Wrap>
    </section>
  )
}
