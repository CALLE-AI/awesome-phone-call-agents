import { useEffect, useState } from "react";
import { ACCESS_CODE_HEADER } from "../access";
import { maskE164 } from "../calle";
import type { CalleRunResult } from "../calle";
import { buildRecoveryResult } from "../workflows/appointment-recovery/result";
import type { RecoveryRequest, RecoveryResult } from "../workflows/appointment-recovery/types";

const POLL_INTERVAL_MS = 3000;

interface Props {
  request: RecoveryRequest;
  callId: string;
  accessCode: string;
  onResult: (result: RecoveryResult) => void;
}

interface StatusPayload {
  status: string;
  activity?: { ts: string; level: string; message: string }[];
  /** Present once the run is terminal. Untrusted call output. */
  calle_result?: CalleRunResult | null;
  error?: string;
}

export function LiveCall({ request, callId, accessCode, onResult }: Props) {
  const [status, setStatus] = useState("starting");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const startedAt = Date.now();
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(callId)}`, {
          headers: { [ACCESS_CODE_HEADER]: accessCode },
        });
        const payload = (await response.json()) as StatusPayload;
        if (cancelled) return;
        if (!response.ok) {
          setError(payload.error ?? `Status check failed with status ${response.status}.`);
          return;
        }
        setStatus(payload.status);
        if (payload.calle_result !== undefined) {
          onResult(
            buildRecoveryResult({
              request,
              status: payload.status,
              calle: payload.calle_result,
              runId: callId,
            }),
          );
          return;
        }
      } catch {
        if (!cancelled) setError("Lost contact with the server. The call may still be running.");
      }
    }

    const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    const clockTimer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    void poll();
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      clearInterval(clockTimer);
    };
  }, [callId, accessCode, onResult]);

  return (
    <section>
      <h2>Call in progress</h2>
      <p>
        Calling {request.customer.given_name} at {maskE164(request.customer.phone_e164)}.
      </p>
      <p>
        Status: <strong>{status}</strong> · {elapsed}s elapsed
      </p>
      <p className="muted">
        Long calls are normal. This screen keeps polling until the call reaches a terminal state.
      </p>
      {error && <p className="errors">{error}</p>}
    </section>
  );
}
