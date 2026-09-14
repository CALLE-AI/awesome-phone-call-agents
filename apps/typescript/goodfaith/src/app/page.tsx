// File: src/app/page.tsx
import { QuoteForm } from "@/components/QuoteForm";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { isLive } from "@/lib/env";

export default function Home() {
  const mode = isLive() ? "live" : "mock";
  return (
    <>
      <SiteHeader mode={mode} />

      <main id="main" className="mx-auto max-w-5xl px-6 pb-4 pt-14 md:pt-20">
        <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          {/* Hero — lead with the trust guarantee (E-4). */}
          <div className="animate-fade-in">
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/60 px-3 py-1 text-xs font-medium uppercase tracking-widest text-accent">
              The trust guarantee
            </p>
            <h1 className="font-serif text-[2.5rem] leading-[1.08] tracking-tight md:text-6xl">
              Every price we rank traces to the exact sentence a clinic said.
              <span className="text-accent"> Or we refuse to rank it.</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-paper-300">
              GoodFaith is an AI agent that phones imaging clinics for a self-pay cash price, insists on an
              apples-to-apples quote on the call, and shows you the true landed cost, with the receipt.
            </p>

            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <dt className="text-xs uppercase tracking-widest text-paper-500">Same city, same day</dt>
                <dd className="mt-1 font-serif text-2xl tnum">
                  <span className="text-accent">$400</span>
                  <span className="mx-2 text-paper-500">→</span>
                  <span className="text-paper-200">$2,000+</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-widest text-paper-500">for the same MRI</dt>
                <dd className="mt-1 text-sm leading-tight text-paper-400">
                  Lumbar spine without contrast
                  <br />
                  CPT&nbsp;72148
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-paper-500">
              Real-world self-pay range for a lumbar MRI, drawn from published cash-price data. The
              $438 figure below is our live demo winner, recomputed from the sample transcript.
            </p>

            <p className="mt-8 max-w-lg text-sm leading-relaxed text-paper-400">
              No fabricated numbers. Expand any winner in the results to hear the exact sentence a clinic said and the
              moment in the transcript it was said.
            </p>
          </div>

          {/* Primary action */}
          <div className="lg:pt-2">
            <QuoteForm mode={mode} />
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
