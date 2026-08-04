import { useState } from "react";
import { ACCESS_CODE_HEADER } from "../access";
import { maskE164 } from "../calle";
import type { RecoveryRequest } from "../workflows/appointment-recovery/types";

interface Props {
  request: RecoveryRequest;
  accessCode: string;
  onAccessCodeChange: (code: string) => void;
  onStarted: (callId: string) => void;
  onBack: () => void;
}

export function Authorize({
  request,
  accessCode,
  onAccessCodeChange,
  onStarted,
  onBack,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function placeCall() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json", [ACCESS_CODE_HEADER]: accessCode },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as { call_id?: string; error?: string };
      if (!response.ok || !payload.call_id) {
        setError(
          payload.error === "invalid_access_code"
            ? "That access code was not accepted. No call was placed."
            : (payload.error ?? `Call creation failed with status ${response.status}.`),
        );
        setSubmitting(false);
        return;
      }
      onStarted(payload.call_id);
    } catch {
      setError("Could not reach the server. No call state is known; do not retry blindly.");
      setSubmitting(false);
    }
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Authorize one live call</h2>
        <p className="lede">
          This is the only step that leaves dry-run mode. Pressing the button places one real
          phone call to a real person, and it cannot be recalled.
        </p>
      </div>

      <div className="card">
        <dl className="spec">
          <dt>Calling</dt>
          <dd>
            {request.customer.given_name} at{" "}
            <span className="tabular">{maskE164(request.customer.phone_e164)}</span>
          </dd>
          <dt>Calls placed</dt>
          <dd>Exactly one</dd>
        </dl>
      </div>

      <div className="card">
        <label className="consent">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={submitting}
          />
          I authorize exactly one call to this number, now.
        </label>
        <label className="field">
          Operator access code
          <input
            type="password"
            value={accessCode}
            onChange={(e) => onAccessCodeChange(e.target.value)}
            disabled={submitting}
            autoComplete="off"
          />
          <span className="field-hint">
            The checkbox records your consent; this code is what the server actually checks, so
            that only an authorized operator can spend a real call.
          </span>
        </label>
      </div>

      {error && (
        <div className="alert" role="alert">
          <h3>The call was not placed</h3>
          <p>{error}</p>
        </div>
      )}

      <div className="actions">
        <button onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button
          className="destructive"
          onClick={placeCall}
          disabled={!confirmed || !accessCode || submitting}
        >
          {submitting ? "Placing call…" : "Place the call"}
        </button>
      </div>
    </section>
  );
}
