import "./LandingPage.css";

type Props = {
  onRequest: () => void;
  onStaff: () => void;
};

export function LandingPage({ onRequest, onStaff }: Props) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <button className="landing-brand" onClick={onRequest}>
          <span>TOMORROW IS CALLING</span>
          <small>Vehicle transport coordination</small>
        </button>
        <button className="button button--quiet" onClick={onStaff}>Staff console</button>
      </header>

      <section className="landing-hero">
        <p className="eyebrow">Vehicle transport, coordinated clearly</p>
        <h1>Request your vehicle transport. We’ll keep the handoff moving.</h1>
        <p className="landing-hero__copy">
          Tell us where your vehicle is going, when you need pickup and delivery, and who will be present. A transport coordinator will review your request and follow up before dispatch.
        </p>
        <div className="landing-actions">
          <button className="button button--primary" onClick={onRequest}>Make a transport request</button>
          <span>No payment-card information is collected in this form.</span>
        </div>
      </section>

      <section className="landing-steps" aria-labelledby="how-it-works">
        <p className="section-label">How it works</p>
        <h2 id="how-it-works">From request to driver dispatch.</h2>
        <div className="landing-step-grid">
          <article><b>01</b><h3>Send your request</h3><p>Share your vehicle, route, preferred transport windows, and contact details.</p></article>
          <article><b>02</b><h3>We confirm the details</h3><p>A coordinator reviews the request and CALL-E can contact you to confirm the transport information and answer routine questions.</p></article>
          <article><b>03</b><h3>Driver dispatch & updates</h3><p>Once the request is ready, a driver can be assigned. We keep you updated as pickup approaches and send confirmation by email.</p></article>
        </div>
      </section>
    </main>
  );
}
