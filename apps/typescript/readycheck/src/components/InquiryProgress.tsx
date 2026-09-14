import { ArrowRight, Phone, Square } from 'lucide-react';
import type { Plan } from '../domain/model';
import { inquiryLabels } from '../domain/progress';

export function InquiryProgress({
  plans,
  busy,
  stopped,
  onReview,
  onRecover,
  onContinue,
  onStop,
}: {
  plans: Plan[];
  busy: boolean;
  stopped: boolean;
  onReview: (id: string) => void;
  onRecover: (id: string) => void;
  onContinue: (id: string) => void;
  onStop: () => void;
}) {
  return (
    <section
      className="live-runs"
      id="inquiry-progress"
      tabIndex={-1}
      aria-label="Inquiry progress"
    >
      <h3>
        <Phone size={16} /> Inquiry progress
      </h3>
      {plans.map((plan) => (
        <div className="run-card" key={plan.id}>
          <strong>{plan.followupFor ? 'Follow-up question' : 'Your approved inquiries'}</strong>
          {plan.inquiries.map((inquiry) => (
            <div key={inquiry.id} className="run-row">
              <div>
                <span>{plan.recipients.find((r) => r.id === inquiry.candidateId)?.name}</span>
                <small role="status">
                  {inquiry.state === 'observing' && inquiry.providerPhase
                    ? {
                        queued: 'Queued with CALL-E',
                        calling: 'CALL-E is handling the call',
                        finalizing: 'Call ended · preparing the transcript and answers',
                        waiting: 'Waiting for a provider update',
                      }[inquiry.providerPhase]
                    : inquiryLabels[inquiry.state]}
                </small>
                <small>
                  Updated{' '}
                  {new Date(inquiry.updatedAt).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </small>
                {inquiry.error ? <p role="status">{inquiry.error}</p> : null}
                {inquiry.vendorId ? (
                  <details className="call-reference">
                    <summary>Call reference</summary>
                    <code>{inquiry.vendorId}</code>
                  </details>
                ) : null}
              </div>
              {inquiry.state === 'dispatch_unknown' ? (
                <button className="text-button" onClick={() => onRecover(inquiry.id)}>
                  Reconcile existing call
                </button>
              ) : null}
              {inquiry.state === 'review_required' ? (
                <button className="button secondary" onClick={() => onReview(inquiry.id)}>
                  Review result <ArrowRight size={14} />
                </button>
              ) : null}
            </div>
          ))}
          {plan.status === 'approved' && plan.inquiries.some((i) => i.state === 'queued') ? (
            <button
              className="button secondary"
              disabled={
                busy ||
                plan.inquiries.some((i) =>
                  [
                    'claimed',
                    'dispatch_unknown',
                    'submitted',
                    'observing',
                    'review_required',
                  ].includes(i.state),
                )
              }
              onClick={() => onContinue(plan.id)}
            >
              Continue approved sequence <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      ))}
      {!stopped ? (
        <button className="text-button danger" disabled={busy} onClick={onStop}>
          <Square size={13} /> Stop future calls
        </button>
      ) : (
        <p className="muted">Future calls are stopped. An active call may still finish.</p>
      )}
    </section>
  );
}
