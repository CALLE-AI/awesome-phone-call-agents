import type { Metadata } from "next";
import { PublicPage } from "../components/site-chrome";

export const metadata: Metadata = {
  title: "SpareScout Privacy",
  description: "What SpareScout stores, why it is needed, and how sourcing records can be deleted.",
};

export default function PrivacyPage() {
  return (
    <PublicPage
      eyebrow="Privacy"
      title="Collect what the sourcing decision needs—and no more."
      intro="This notice describes the current hackathon pilot, not a generally available commercial service."
    >
      <section className="privacy-list">
        <article><h2>Request data</h2><p>Vehicle and part details, fitment reference, budget, location, deadline, market, language, and supplier business contacts are used to create the reviewed call plan.</p></article>
        <article><h2>Call records</h2><p>Approval timestamps, provider call identifiers, status, summaries, confidence, evidence, and structured supplier quotes are retained for audit and comparison.</p></article>
        <article><h2>Authorization and consent record</h2><p>Live plans require an authenticated operator and exact server allowlist match, then store the consent attestation and authorized calling window. SpareScout does not infer consent from possessing or submitting a number.</p></article>
        <article><h2>Protected display</h2><p>Full supplier numbers are needed by the trusted server to place an approved call. User-facing plans and history mask them, and signed browser approval data removes them entirely.</p></article>
        <article><h2>History access</h2><p>Each request receives a separate random history credential remembered by the originating browser. The server stores only its cryptographic hash and refuses history reads without the credential.</p></article>
        <article><h2>What is excluded</h2><p>SpareScout does not ask for payment cards, banking credentials, or authority to purchase. Do not enter unrelated personal or sensitive information.</p></article>
        <article><h2>Thirty-day retention</h2><p>Sourcing requests and their related supplier, approval, call, quote, and webhook records are pruned after 30 days when the service next handles database activity.</p></article>
        <article><h2>Your deletion control</h2><p>The browser-held history credential can permanently delete its matching durable request at any time. Forgetting a request on one device removes only that device’s credential.</p></article>
        <article><h2>Fixture mode</h2><p>The public demo path uses synthetic contacts and generated outcomes. It does not send the request data to a phone recipient.</p></article>
      </section>
      <p className="source-note">Last updated 31 August 2026. Live testing must use authorized contacts and follow applicable calling, recording, and privacy rules.</p>
    </PublicPage>
  );
}
