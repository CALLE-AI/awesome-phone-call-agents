import { appointmentRecovery } from "../workflows/appointment-recovery";
import { maskE164 } from "../lib/mask";
import type { RecoveryRequest } from "../types";

interface Props {
  request: RecoveryRequest;
  onAuthorize: () => void;
  onBack: () => void;
}

export function Preview({ request, onAuthorize, onBack }: Props) {
  return (
    <section>
      <h2>Dry-run preview</h2>
      <p className="mode-badge">No call has been placed. This is the complete plan.</p>
      <dl>
        <dt>Calling</dt>
        <dd>
          {request.customer.given_name} at {maskE164(request.customer.phone_e164)}
        </dd>
        <dt>On behalf of</dt>
        <dd>
          {request.business.name} ({request.business.timezone}), callback{" "}
          {maskE164(request.business.callback_number_e164)}
        </dd>
        <dt>About</dt>
        <dd>
          {request.appointment.status === "missed" ? "Missed" : "Unconfirmed"} appointment:{" "}
          {request.appointment.service} at {request.appointment.original_time}
        </dd>
        <dt>Windows the agent may offer</dt>
        <dd>
          <ul>
            {request.replacement_windows.map((window, index) => (
              <li key={index}>
                {window.start} to {window.end}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      <h3>The agent may</h3>
      <ul>
        {appointmentRecovery.agentMay.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <h3>The agent may never</h3>
      <ul>
        {appointmentRecovery.agentMayNot.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button onClick={onAuthorize}>Continue to authorization</button>
      </div>
    </section>
  );
}
