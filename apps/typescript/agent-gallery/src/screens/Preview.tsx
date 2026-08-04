import { appointmentRecovery } from "../workflows/appointment-recovery/workflow";
import { maskE164 } from "../calle";
import { formatDateTime, formatWindow } from "../format";
import type { RecoveryRequest } from "../workflows/appointment-recovery/types";

interface Props {
  request: RecoveryRequest;
  onAuthorize: () => void;
  onBack: () => void;
}

export function Preview({ request, onAuthorize, onBack }: Props) {
  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Dry-run preview</h2>
        <p className="lede">
          The complete plan, assembled without a single network call. Nothing has been dialed
          and nothing has been sent to CALL-E.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">The call</h3>
        <dl className="spec">
          <dt>Calling</dt>
          <dd>
            {request.customer.given_name} at{" "}
            <span className="tabular">{maskE164(request.customer.phone_e164)}</span>
          </dd>

          <dt>On behalf of</dt>
          <dd>
            {request.business.name}
            <br />
            <span className="muted">
              {request.business.timezone} · callback{" "}
              <span className="tabular">{maskE164(request.business.callback_number_e164)}</span>
            </span>
          </dd>

          <dt>About</dt>
          <dd>
            {request.appointment.status === "missed" ? "Missed" : "Unconfirmed"}{" "}
            {request.appointment.service}
            <br />
            <span className="muted">
              originally {formatDateTime(request.appointment.original_time)}
            </span>
          </dd>

          <dt>May offer</dt>
          <dd>
            <ul>
              {request.replacement_windows.map((window, index) => (
                <li key={index}>{formatWindow(window.start, window.end)}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </div>

      <div className="card">
        <h3 className="card-title">The safety contract</h3>
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

      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={onAuthorize}>
          Continue to authorization
        </button>
      </div>
    </section>
  );
}
