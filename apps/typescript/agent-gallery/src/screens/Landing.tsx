import { appointmentRecovery } from "../workflows/appointment-recovery/workflow";

export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <section className="screen hero">
      <div className="screen-head">
        <h2>Recover the appointment, not just the call.</h2>
        <p className="lede">
          Missed and unconfirmed appointments cost service businesses chair time and revenue,
          and recovering them means a front desk re-dialing customers by hand. Appointment
          Recovery places one safe, policy-constrained CALL-E phone call and returns a
          structured disposition with a concrete next action.
        </p>
      </div>

      {/* The safety contract is the product, so it is on the first screen
          rather than buried behind the form. */}
      <div className="card">
        <h3 className="card-title">What the agent may and may never do</h3>
        <div className="policy">
          <ul className="policy-list" data-kind="may">
            {appointmentRecovery.agentMay.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <ul className="policy-list" data-kind="may-not">
            {appointmentRecovery.agentMayNot.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="muted">
        The first workflow in a planned family of reusable, safety-contracted phone workflows.
        Lead qualification and service coordination are natural successors.
      </p>

      <div className="actions">
        <button className="primary" onClick={onStart}>
          Configure a recovery call
        </button>
      </div>
    </section>
  );
}
