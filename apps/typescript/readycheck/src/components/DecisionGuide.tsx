import { useState } from 'react';
import { ArrowRight, SlidersHorizontal, MessageSquare } from 'lucide-react';
import type { CandidateResult, Task } from '../domain/model';
import {
  bestNextQuestion,
  previewLimits,
  whatWouldWork,
  type WhatIfOption,
} from '../domain/decisions';
import { evaluateCandidate, displayValue } from '../domain/evaluator';
import { InlineError, Modal, StatusIcon } from './Shared';
const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);

export function DecisionGuide({
  task,
  results,
  now,
  disabled,
  canCall,
  onQuestion,
  onApply,
  onEvidence,
}: {
  task: Task;
  results: CandidateResult[];
  now: Date;
  disabled: boolean;
  canCall: boolean;
  onQuestion: (candidateId: string, field: string) => void;
  onApply: (task: Task) => void;
  onEvidence: (candidateId: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const best = bestNextQuestion(task, results, now);
  const options = results.flatMap((candidate) => {
    const option = whatWouldWork(task, candidate, now);
    return option ? [{ candidate, option }] : [];
  });
  const selectedOption = options.find((x) => x.candidate.id === selected);
  const fits = results.some((c) => evaluateCandidate(task, c, now).verdict === 'pass');
  if (fits) return null;
  return (
    <>
      <section className="decision-guide" aria-label="Ways forward">
        <div className="decision-path">
          <span className="decision-eyebrow">
            <MessageSquare size={15} /> Resolve an answer
          </span>
          <h3>{best?.advice.decisive ? 'The one question left' : 'The next useful question'}</h3>
          {best ? (
            <>
              <p className="decision-candidate">
                {best.candidate.name} · {best.advice.remaining} question
                {best.advice.remaining === 1 ? '' : 's'} unresolved
              </p>
              <blockquote>{best.advice.question}</blockquote>
              <p>{best.advice.reason}</p>
              <button
                className="button secondary"
                disabled={disabled || !canCall}
                onClick={() => onQuestion(best.candidate.id, best.advice.field)}
              >
                Preview one-question follow-up <ArrowRight size={14} />
              </button>
              {!canCall ? (
                <p className="small muted">
                  Enable controlled calling in Connection to preview a live follow-up.
                </p>
              ) : null}
            </>
          ) : (
            <p>
              No useful follow-up is suggested from the current evidence. Review unanswered facts or
              consider an option that meets your must-haves.
            </p>
          )}
        </div>
        <div className="decision-path">
          <span className="decision-eyebrow">
            <SlidersHorizontal size={15} /> Explore your limits
          </span>
          <h3>What would make this work?</h3>
          {options.length ? (
            <>
              <p>These options have confirmed totals. Preview a limit change before deciding.</p>
              <ul className="tradeoff-options">
                {options.map(({ candidate, option }) => (
                  <li key={candidate.id}>
                    <strong>{candidate.name}</strong>
                    <span>
                      {option.changes
                        .map((c) => `${c.label}: ${money(c.from)} → ${money(c.to)}`)
                        .join(' · ')}
                    </span>
                    <button
                      className="text-button"
                      disabled={disabled}
                      onClick={() => setSelected(candidate.id)}
                    >
                      Preview limit change <ArrowRight size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              No supported budget-only change makes an option fit. Missing answers, estimates, and
              changes to service or dates need more evidence.
            </p>
          )}
          <p className="small muted">
            Your original requirements stay saved. Previewing makes no call.
          </p>
        </div>
      </section>
      {selectedOption ? (
        <LimitPreview
          key={selectedOption.candidate.id}
          task={task}
          candidate={selectedOption.candidate}
          option={selectedOption.option}
          now={now}
          disabled={disabled}
          onClose={() => setSelected(null)}
          onApply={(next) => {
            onApply(next);
            setSelected(null);
          }}
          onEvidence={() => {
            setSelected(null);
            onEvidence(selectedOption.candidate.id);
          }}
        />
      ) : null}
    </>
  );
}

function LimitPreview({
  task,
  candidate,
  option,
  now,
  disabled,
  onClose,
  onApply,
  onEvidence,
}: {
  task: Task;
  candidate: CandidateResult;
  option: WhatIfOption;
  now: Date;
  disabled: boolean;
  onClose: () => void;
  onApply: (next: Task) => void;
  onEvidence: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(option.changes.map((c) => [c.field, (c.to / 100).toFixed(2)])),
  );
  const [error, setError] = useState('');
  const values = Object.fromEntries(
    Object.entries(inputs).map(([id, input]) => [
      id,
      /^\d+(?:\.\d{1,2})?$/.test(input) ? Math.round(Number(input) * 100) : NaN,
    ]),
  );
  const preview = previewLimits(task, candidate, option, values, now);
  const ready = preview.valid && preview.evaluation.verdict === 'pass';
  return (
    <Modal title="Preview a limit change" onClose={onClose} wide>
      <p className="modal-intro">
        Explore whether {candidate.name} fits with different limits. This uses the same evidence and
        its original expiry.
      </p>
      <div className="limit-editors">
        {option.changes.map((change) => (
          <div className="limit-editor" key={change.field}>
            <label>
              {change.label} in USD
              <input
                type="number"
                min={change.from / 100}
                step="0.01"
                value={inputs[change.field]}
                onChange={(e) => {
                  setError('');
                  setInputs({ ...inputs, [change.field]: e.target.value });
                }}
              />
            </label>
            <p className="small muted">
              Current: {money(change.from)} · Minimum supported limit: {money(change.to)}
            </p>
            {change.facts.map((fact) => (
              <blockquote key={fact.id}>{fact.raw}</blockquote>
            ))}
          </div>
        ))}
      </div>
      <div className={`limit-verdict ${ready ? 'pass' : ''}`} role="status">
        <strong>
          {ready ? 'Would meet the checked requirements' : 'Still does not meet every requirement'}
        </strong>
        <p>
          {preview.valid
            ? 'No new provider statement is assumed.'
            : 'Enter a valid amount at or above your current limit, with no more than two decimal places.'}
        </p>
      </div>
      <ul className="scenario-checks" aria-label="Preview requirement checks">
        {preview.evaluation.checks.map((check) => (
          <li key={check.requirement.id}>
            <StatusIcon verdict={check.verdict} />
            <span>
              <strong>{check.requirement.label}</strong> ·{' '}
              {displayValue(check.requirement, task.timeZone)}
              <small>{check.reason}</small>
            </span>
          </li>
        ))}
      </ul>
      {error ? <InlineError message={error} /> : null}
      <p className="small muted">
        Saving creates a new revision. Earlier requirements, quotations, and call approvals remain
        in history. This does not book or purchase anything.
      </p>
      <div className="modal-actions">
        <button className="text-button" onClick={onEvidence}>
          Inspect source evidence
        </button>
        <button className="button secondary" onClick={onClose}>
          Keep original requirements
        </button>
        <button
          className="button primary"
          disabled={!ready || disabled}
          onClick={() => {
            const fresh = previewLimits(task, candidate, option, values, new Date());
            if (!fresh.valid || fresh.evaluation.verdict !== 'pass') {
              setError(
                'The evidence no longer supports this preview. Refresh the saved results before applying.',
              );
              return;
            }
            onApply(fresh.task);
          }}
        >
          Apply as new revision <ArrowRight size={14} />
        </button>
      </div>
    </Modal>
  );
}
