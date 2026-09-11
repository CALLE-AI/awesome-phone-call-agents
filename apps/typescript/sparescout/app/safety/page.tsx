import type { Metadata } from "next";
import { PublicPage } from "../components/site-chrome";

export const metadata: Metadata = {
  title: "SpareScout Safety",
  description: "Approval gates, disclosure, data minimization, dry runs, and no-purchase boundaries for supplier calls.",
};

const controls = [
  ["Authenticated operator", "Both live endpoints require a private operator credential. A consent checkbox alone never authorizes a call."],
  ["Authorized recipients", "Every live number must exactly match the server-side allowlist and carry a documented consent window."],
  ["Explicit approval", "Browser approval data is time-limited and contains no phone values; execution reloads the authoritative plan privately."],
  ["AI disclosure", "The call task instructs SpareScout to identify itself as an AI assistant collecting a quote for a buyer."],
  ["Information only", "Calls may ask about price, stock, fitment, delivery, and whether a later hold is possible. They cannot reserve, order, pay, purchase, or commit."],
  ["Masked recipients", "The approval screen, browser token, and public history expose no full supplier number. Full numbers remain server-side for authorized execution."],
  ["Fail-closed live mode", "A fixture plan can never become live because configuration changes. Live execution requires a live plan, operator authentication, an allowlist match, and trusted server credentials."],
  ["Traceable outcomes", "Requests, approvals, call runs, confidence, evidence, and normalized quotes are stored together for review."],
  ["Professional boundaries", "SpareScout provides no medical, legal, or financial advice and is never an emergency service. Those topics stop the sourcing workflow and remain with qualified local services or professionals."],
] as const;

export default function SafetyPage() {
  return (
    <PublicPage
      eyebrow="Safety by design"
      title="A phone call is a real-world side effect. We treat it like one."
      intro="SpareScout separates planning, approval, calling, comparison, and any later reservation into distinct decisions."
    >
      <section className="control-grid">
        {controls.map(([title, text], index) => (
          <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{text}</p></article>
        ))}
      </section>

      <section className="boundary-panel">
        <div><p className="section-kicker">Hard boundary</p><h2>Quote gathering is not purchasing authority.</h2></div>
        <p>SpareScout rejects substitute-part acceptance and records missing information as unknown. Selecting an offer in the interface only prepares a separate reservation preview; it does not contact the seller.</p>
      </section>
    </PublicPage>
  );
}
