import { formatDateTime, humanizeOutcome } from "../format";
import { NEXT_ACTIONS } from "../workflows/appointment-recovery/types";
import type { Outcome, RecoveryResult } from "../workflows/appointment-recovery/types";

interface Props {
  result: RecoveryResult;
  onRestart: () => void;
}

/**
 * Visual tone per outcome.
 *
 * `declined` is deliberately neutral rather than critical: a customer who does
 * not want to rebook is a clean, correct result, not a failure. Only a call
 * that did not complete is treated as critical, and everything needing a human
 * is caution.
 */
const TONE: Record<Outcome, string> = {
  confirmed: "positive",
  rescheduled: "positive",
  declined: "neutral",
  no_agreement: "caution",
  uncertain: "caution",
  unreachable: "caution",
  timed_out: "caution",
  failed: "critical",
};

export function ResultScreen({ result, onRestart }: Props) {
  return (
    <section className="screen">
      <div className="card">
        <div className="outcome" data-tone={TONE[result.outcome]}>
          <span className="outcome-label">Outcome</span>
          <span className="outcome-value">{humanizeOutcome(result.outcome)}</span>
        </div>
      </div>

      {/* The recommended action is why the operator is on this screen at all,
          so it sits above the supporting detail rather than under it. */}
      <div className="next-action">
        <strong>Next action</strong>
        {NEXT_ACTIONS[result.outcome]}
      </div>

      <div className="card">
        <h3 className="card-title">Detail</h3>
        <dl className="spec">
          {result.confirmed_time && (
            <>
              <dt>Agreed time</dt>
              <dd>{formatDateTime(result.confirmed_time)}</dd>
            </>
          )}

          <dt>Customer intent</dt>
          <dd>{humanizeOutcome(result.customer_intent)}</dd>

          <dt>Follow-up</dt>
          <dd>{result.follow_up_required ? "Required" : "Not required"}</dd>

          <dt>Call id</dt>
          <dd className="mono">{result.call_id}</dd>
        </dl>
      </div>

      {result.notes && (
        <div className="card">
          <h3 className="card-title">What the call reported</h3>
          {/* Untrusted call output, shown as quoted text so it never reads as
              part of the interface or as an instruction. */}
          <p className="quote">{result.notes}</p>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={onRestart}>
          Start another recovery
        </button>
      </div>
    </section>
  );
}
