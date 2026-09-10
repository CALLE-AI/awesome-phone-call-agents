import { getRuntimeMode } from "@/lib/config/server";

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
      <nav aria-label="Product">
        <a className="brand" href="#top">Senior Phone AI</a>
        <span className="mode" data-mode={mode}>{mode} mode</span>
      </nav>

      <section className="hero" id="top">
        <p className="eyebrow">Voice is the interface</p>
        <h1>AI without the app.<br />Just call.</h1>
        <p className="lede">
          A phone-native assistant designed to help older people find information,
          remember important details and request simple actions through conversation.
        </p>
        <div className="notice" role="status">
          <strong>Local realtime harness available</strong>
          <span>The protected developer test is at <a href="/realtime">/realtime</a>. No phone call, message or recurring job can be created.</span>
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
