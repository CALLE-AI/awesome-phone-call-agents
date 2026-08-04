import { NEXT_ACTIONS } from "../types";
import type { RecoveryResult } from "../types";

interface Props {
  result: RecoveryResult;
  onRestart: () => void;
}

export function ResultScreen({ result, onRestart }: Props) {
  return (
    <section>
      <h2>Result</h2>
      <dl>
        <dt>Outcome</dt>
        <dd>
          <strong>{result.outcome}</strong>
        </dd>
        {result.confirmed_time && (
          <>
            <dt>Agreed time</dt>
            <dd>{result.confirmed_time}</dd>
          </>
        )}
        <dt>Customer intent</dt>
        <dd>{result.customer_intent}</dd>
        <dt>Next action</dt>
        <dd>
          <strong>{NEXT_ACTIONS[result.outcome]}</strong>
        </dd>
        {result.notes && (
          <>
            <dt>Notes (untrusted call output, shown as text)</dt>
            <dd>{result.notes}</dd>
          </>
        )}
        <dt>Call id</dt>
        <dd>{result.call_id}</dd>
      </dl>
      <button onClick={onRestart}>Start another recovery</button>
    </section>
  );
}
