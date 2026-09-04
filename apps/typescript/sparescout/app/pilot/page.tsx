import type { Metadata } from "next";
import { PublicPage } from "../components/site-chrome";
import { PilotMetricBoard } from "./pilot-metrics";

export const metadata: Metadata = {
  title: "SpareScout Pilot Evidence",
  description: "The pre-registered metrics and evidence standard for SpareScout's consenting supplier pilot.",
};

export default function PilotPage() {
  return (
    <PublicPage
      eyebrow="Pilot evidence"
      title="Measure the phone work, not the pitch."
      intro="The pilot has not started. This evidence board reads only durable live CALL-E records, excludes every fixture, and pre-registers the measures before consenting calls begin."
    >
      <PilotMetricBoard />
      <section className="public-split pilot-method">
        <div><p className="section-kicker">Minimum credible study</p><h2>Five requests, consenting businesses, one fixed rubric.</h2></div>
        <div className="prose-stack">
          <p>Each request should use a real vehicle and part, contact two or more businesses that agreed to receive an AI-assisted sourcing call, and preserve the resulting structured record.</p>
          <p>Fixture runs, unanswered calls, failures, and incomplete quotes stay in the denominator. No synthetic outcome will be presented as pilot evidence.</p>
        </div>
      </section>
    </PublicPage>
  );
}
