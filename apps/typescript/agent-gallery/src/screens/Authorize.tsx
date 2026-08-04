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
    <section>
      <h2>Authorize one live call</h2>
      <p>
        You are about to place one real phone call to {maskE164(request.customer.phone_e164)}.
        This is the only step that leaves dry-run mode.
      </p>
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
      </label>
      <p className="muted">
        The checkbox above records your consent. This code is what the server actually
        checks, so that only an authorized operator can spend a real call.
      </p>
      {error && <p className="errors">{error}</p>}
      <div className="actions">
        <button onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button onClick={placeCall} disabled={!confirmed || !accessCode || submitting}>
          {submitting ? "Placing call…" : "Place the call"}
        </button>
      </div>
    </section>
  );
}
