import { appointmentRecovery } from "../workflows/appointment-recovery";

export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <section>
      <h2>{appointmentRecovery.title}</h2>
      <p>
        Missed and unconfirmed appointments cost service businesses chair time and revenue,
        and recovering them means a front desk re-dialing customers by hand. Appointment
        Recovery places one safe, policy-constrained CALL-E phone call and returns a
        structured disposition with a concrete next action.
      </p>
      <p>{appointmentRecovery.summary}</p>
      <p className="muted">
        This is the first workflow in a planned family of reusable, safety-contracted phone
        workflows. Lead qualification and service coordination are natural successors.
      </p>
      <button onClick={onStart}>Configure a recovery call</button>
    </section>
  );
}
