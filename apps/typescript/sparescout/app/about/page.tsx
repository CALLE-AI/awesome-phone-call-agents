import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "../components/site-chrome";

export const metadata: Metadata = {
  title: "About SpareScout",
  description: "Why SpareScout turns hard-to-search auto-parts inventory into comparable, evidence-backed phone quotes.",
};

export default function AboutPage() {
  return (
    <PublicPage
      eyebrow="About SpareScout"
      title="The inventory exists. The search box often doesn’t."
      intro="SpareScout is a focused procurement assistant for the part of the auto-parts market that still runs through phone conversations."
    >
      <section className="public-split">
        <div>
          <p className="section-kicker">The problem</p>
          <h2>A correct part is more than a product name.</h2>
        </div>
        <div className="prose-stack">
          <p>Vehicle year, trim, chassis or VIN, OEM references, position, condition, and delivery timing can all change the answer. Many independent dealers have useful stock but incomplete or stale online listings.</p>
          <p>Buyers call shop after shop, repeat the same details, write down incompatible answers, and still risk choosing the wrong part. SpareScout gives that phone work a repeatable structure.</p>
        </div>
      </section>

      <section className="belief-grid" aria-label="Product principles">
        <article><span>01</span><h3>Phone-native</h3><p>The workflow exists because the freshest inventory answer is often spoken, not indexed.</p></article>
        <article><span>02</span><h3>Fitment-first</h3><p>A cheap quote is not a useful quote until the compatibility evidence is visible.</p></article>
        <article><span>03</span><h3>Human-decided</h3><p>Automation gathers and structures information. People approve calls and decide what happens next.</p></article>
      </section>

      <section className="public-callout">
        <div><p className="section-kicker">Built for worldwide use</p><h2>One workflow, localized to supported calling markets.</h2></div>
        <p>Market, spoken language, currency, number format, budget, and delivery location travel together. SpareScout currently exposes exactly the regions CALL-E supports rather than pretending every destination is callable.</p>
        <Link className="inline-cta" href="/markets">See supported markets <span>→</span></Link>
      </section>
    </PublicPage>
  );
}
