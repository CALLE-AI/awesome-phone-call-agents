import { getRuntimeMode } from "@/lib/config/server";
import Link from "next/link";

const steps = [
  ["Ask", "Call a normal phone number and speak naturally."],
  ["Search", "Retrieve current information during the conversation."],
  ["Remember", "Send short details by SMS when requested."],
  ["Act", "Confirm before reminders or outbound calls are created."],
] as const;

export default function Home() {
  const mode = getRuntimeMode();

  return (
    <main>
      <section className="hero" id="top">
        <p className="eyebrow">Your phone assistant workspace</p>
        <h1>Start a call.<br />Keep the details.</h1>
        <p className="lede">
          Have a conversation, answer the questions that matter, and text the
          information your customer asked for after the call.
        </p>
        <div className="workspace-actions"><Link className="workspace-primary" href="/calls">Open calls <span aria-hidden="true">→</span></Link><Link className="workspace-secondary" href="/followups">View SMS follow-ups</Link><span className="mode" data-mode={mode}>{mode} mode</span></div>
        <div className="notice" role="status">
          <strong>Choose your next step</strong>
          <span>
            Use Calls to start a conversation, SMS follow-ups to track requested answers,
            or Briefings to prepare information before a call. Live calls and messages
            require setup and the customer’s permission.
          </span>
        </div>
      </section>

      <section className="journey" aria-labelledby="journey-heading">
        <div>
          <p className="eyebrow">One familiar number</p>
          <h2 id="journey-heading">A simple path from question to action</h2>
        </div>
        <ol>
          {steps.map(([title, description], index) => (
            <li key={title}>
              <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="boundaries" aria-labelledby="boundaries-heading">
        <div>
          <p className="eyebrow">Built around permission</p>
          <h2 id="boundaries-heading">The caller stays in control.</h2>
        </div>
        <p>
          The assistant identifies itself as AI. It will require clear confirmation
          before sending messages, saving reminders, contacting family or asking
          CALL-E to place an outbound call.
        </p>
      </section>
    </main>
  );
}
