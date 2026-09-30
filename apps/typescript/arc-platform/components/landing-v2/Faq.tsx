import { FAQ } from "./content"
import { SecHead, Wrap } from "./parts"

/**
 * F. <details>/<summary>. The answer opens with grid-template-rows 0fr -> 1fr,
 * so it animates without anyone measuring a height, and the "+" rotates 45deg
 * into a "x" rather than swapping glyphs.
 */
export function Faq() {
  return (
    <section id="faq" className="py-16 md:py-24">
      <Wrap>
        <SecHead title={FAQ.title} accent={FAQ.titleAccent} />
        <div className="max-w-[720px]">
          {FAQ.items.map((f) => (
            <details key={f.q} className="border-b border-border">
              <summary className="relative cursor-pointer py-6 pr-10 text-body font-medium text-text">
                {f.q}
                <span
                  aria-hidden
                  className="faq-plus absolute top-1/2 right-1 -translate-y-1/2 font-display text-h3 leading-none text-lilac-deep"
                >
                  +
                </span>
              </summary>
              <div className="faq-body">
                <div>
                  <p className="max-w-[60ch] pb-6 text-small text-text-muted">{f.a}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </Wrap>
    </section>
  )
}
