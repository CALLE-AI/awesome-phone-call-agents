import { useEffect, useRef, useState } from "react";
import { ACCESS_CODE_HEADER } from "../access";
import { maskE164 } from "../calle";
import type { CalleRunResult } from "../calle";
import { formatElapsed, formatTimestamp, humanizeOutcome } from "../format";
import { buildRecoveryResult } from "../workflows/appointment-recovery/result";
import type { RecoveryRequest, RecoveryResult } from "../workflows/appointment-recovery/types";

const POLL_INTERVAL_MS = 3000;

interface Props {
  request: RecoveryRequest;
  callId: string;
  accessCode: string;
  onResult: (result: RecoveryResult) => void;
}

interface Activity {
  ts: string;
  level: string;
  message: string;
}

interface StatusPayload {
  status: string;
  activity?: Activity[];
  /** Present once the run is terminal. Untrusted call output. */
  calle_result?: CalleRunResult | null;
  error?: string;
}

export function LiveCall({ request, callId, accessCode, onResult }: Props) {
  const [status, setStatus] = useState("starting");
  const [elapsed, setElapsed] = useState(0);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const feed = useRef<HTMLUListElement>(null);

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
        if (payload.activity) setActivity(payload.activity);
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

  // Follow the conversation as it arrives. Assigning scrollTop rather than
  // animating keeps this out of the way of prefers-reduced-motion.
  useEffect(() => {
    const element = feed.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activity]);

  return (
    <section className="screen">
      <div className="screen-head">
        <h2>Call in progress</h2>
        <p className="lede">
          Calling {request.customer.given_name} at{" "}
          <span className="tabular">{maskE164(request.customer.phone_e164)}</span>.
        </p>
      </div>

      <div className="card">
        <div className="call-status">
          <span className="call-state">{humanizeOutcome(status)}</span>
          <span className="call-timer tabular">{formatElapsed(elapsed)}</span>
        </div>
      </div>

      {/* The activity feed is the conversation as it happens. It was already
          being polled and thrown away; showing it is what makes this screen
          worth watching, and it is what the operator will be asked about. */}
      <div className="card">
        <h3 className="card-title">Live activity</h3>
        {activity.length === 0 ? (
          <p className="transcript-empty">
            Waiting for the first update from the call…
          </p>
        ) : (
          <ul className="transcript" ref={feed}>
            {activity.map((entry, index) => (
              <li key={`${entry.ts}-${index}`} data-level={entry.level}>
                <time dateTime={entry.ts}>{formatTimestamp(entry.ts)}</time>
                {/* Untrusted call output: rendered as text, never as markup. */}
                <p>{entry.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="muted">
        Long calls are normal. This screen keeps polling until the call reaches a terminal
        state, then reads what was actually agreed.
      </p>

      {error && (
        <div className="alert" role="alert">
          <h3>Lost track of the call</h3>
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}
