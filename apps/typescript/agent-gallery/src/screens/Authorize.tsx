import { useState } from "react";
import { maskE164 } from "../lib/mask";
import type { RecoveryRequest } from "../types";

interface Props {
  request: RecoveryRequest;
  onStarted: (callId: string) => void;
  onBack: () => void;
}

export function Authorize({ request, onStarted, onBack }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function placeCall() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = (await response.json()) as { call_id?: string; error?: string };
      if (!response.ok || !payload.call_id) {
        setError(payload.error ?? `Call creation failed with status ${response.status}.`);
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
      {error && <p className="errors">{error}</p>}
      <div className="actions">
        <button onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button onClick={placeCall} disabled={!confirmed || submitting}>
          {submitting ? "Placing call…" : "Place the call"}
        </button>
      </div>
    </section>
  );
}
