import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "../components/site-chrome";

export const metadata: Metadata = {
  title: "How SpareScout Works",
  description: "From a fitment request to approved CALL-E calls and structured supplier quotes.",
};

const steps = [
  ["01", "Describe the exact part", "Choose a supported market and language, then add vehicle, fitment reference, budget, deadline, and delivery area."],
  ["02", "Review the call plan", "SpareScout shows the purpose, masked recipients, questions, and hard boundaries before anything can run."],
  ["03", "Approve quote gathering", "CALL-E can contact several suppliers in one task, disclose that it is an AI assistant, and adapt to each conversation."],
  ["04", "Compare evidence", "Strict schemas normalize brand, condition, price, stock, delivery, compatibility, confidence, and the evidence behind each answer."],
] as const;

export default function HowItWorksPage() {
  return (
    <PublicPage
      eyebrow="How it works"
      title="From repeated calls to one reviewable decision."
      intro="SpareScout coordinates the full sourcing loop while keeping real-world side effects visible and reversible."
    >
      <section className="process-grid">
        {steps.map(([number, title, text]) => (
          <article key={number}><span>{number}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>

      <section className="architecture-panel">
        <div>
          <p className="section-kicker">Technical depth</p>
          <h2>CALL-E does the phone work. SpareScout makes it dependable.</h2>
        </div>
        <ul>
          <li><strong>Signed approval</strong><span>Plans expire after 15 minutes and cannot be changed after approval.</span></li>
          <li><strong>Idempotent execution</strong><span>Retries reuse the same provider key instead of duplicating calls.</span></li>
          <li><strong>Durable monitoring</strong><span>Queued and in-progress runs are polled without creating another task.</span></li>
          <li><strong>Structured evidence</strong><span>Every comparable field is stored with source evidence and unknown values stay unknown.</span></li>
        </ul>
      </section>

      <section className="public-callout compact-callout">
        <div><p className="section-kicker">Try it safely</p><h2>The full workflow is available in fixture mode.</h2></div>
        <p>It uses realistic structured results but cannot dial any number or reserve any item.</p>
        <Link className="inline-cta" href="/">Open the sourcing demo <span>→</span></Link>
      </section>
    </PublicPage>
  );
}
