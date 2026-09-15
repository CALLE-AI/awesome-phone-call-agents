import { ArrowRight, Check, CircleAlert, LoaderCircle } from 'lucide-react';
import type { CheckProgress } from '../domain/progress';

const steps = ['Your request', 'Check options', 'Review answers', 'Your next step'];
export function CheckJourney({
  progress,
  busy,
  readOnly,
  dirty,
  onAction,
}: {
  progress: CheckProgress;
  busy: boolean;
  readOnly: boolean;
  dirty: boolean;
  onAction: () => void;
}) {
  return (
    <section className={`check-journey journey-${progress.phase}`} aria-label="Check progress">
      <ol className="journey-steps">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index < progress.step ? 'done' : index === progress.step ? 'current' : ''}
            aria-current={index === progress.step ? 'step' : undefined}
          >
            <span>{index < progress.step ? <Check size={13} /> : index + 1}</span>
            {step}
          </li>
        ))}
      </ol>
      <div className="journey-next">
        <div aria-live="polite">
          <span className="journey-caption">
            {progress.phase === 'calling' ? (
              <LoaderCircle className="inquiry-spinner" size={14} />
            ) : progress.phase === 'attention' ? (
              <CircleAlert size={14} />
            ) : null}
            {readOnly ? 'Saved revision' : dirty ? 'Unsaved changes' : progress.label}
          </span>
          <h2>{dirty ? 'Save your changes to update the comparison.' : progress.headline}</h2>
          <p>{dirty ? 'Your original request stays in the revision history.' : progress.detail}</p>
        </div>
        <button className="button secondary" disabled={busy || dirty} onClick={onAction}>
          {progress.actionLabel}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
