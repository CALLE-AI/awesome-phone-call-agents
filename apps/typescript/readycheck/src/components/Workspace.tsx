import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  Clock3,
  Download,
  FileText,
  FlaskConical,
  MessageSquare,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { CaseDetail } from '../api';
import type { Plan, SessionInfo, Task } from '../domain/model';
import { taskSchema } from '../domain/model';
import { displayValue, rankResults, validateTask } from '../domain/evaluator';
import { DecisionGuide } from './DecisionGuide';
import { CheckJourney } from './CheckJourney';
import { InquiryProgress } from './InquiryProgress';
import { checkProgress, pendingFacts } from '../domain/progress';
import { nextUsefulQuestion } from '../domain/decisions';
import { sampleCandidates } from '../domain/samples';
import { Requirements } from './Requirements';
import { Evidence, type FactReview } from './Evidence';
import { EmptyState, Modal, ModeBadge, StatusIcon } from './Shared';
export interface WorkspaceActions {
  save: (task: Task) => void;
  sample: (ids: string[]) => void;
  followup: (id: string, field?: string) => void;
  prepare: (ids: string[], followup?: string, focusField?: string) => void;
  approve: (plan: Plan) => void;
  continue: (id: string) => void;
  stop: () => void;
  remove: () => void;
  outcome: (candidateId: string, state: string, note: string) => void;
  review: (candidateId: string, version: number, review: FactReview) => void;
  acknowledge: (inquiryId: string) => void;
  refresh: () => void;
  recover: (inquiryId: string) => void;
  reconcile: (inquiryId: string, vendorId: string) => void;
}
export function Workspace({
  record,
  session,
  busy,
  actions,
  preview,
  onClosePreview,
  onBack,
}: {
  record: CaseDetail;
  session: SessionInfo;
  busy: boolean;
  actions: WorkspaceActions;
  preview: Plan | null;
  onClosePreview: () => void;
  onBack: () => void;
}) {
  const [version, setVersion] = useState(record.currentVersion),
    [task, setTask] = useState(record.revisions.at(-1)!.task),
    [selected, setSelected] = useState<string[]>(sampleCandidates(task.template).map((c) => c.id)),
    [evidence, setEvidence] = useState<string | null>(null),
    [tab, setTab] = useState<'comparison' | 'activity'>('comparison'),
    [samplePreview, setSamplePreview] = useState<string | null>(null),
    [focusField, setFocusField] = useState<string | undefined>(),
    [outcome, setOutcome] = useState<{ id: string; state: string } | null>(null),
    [note, setNote] = useState(''),
    [deleting, setDeleting] = useState(false),
    [consent, setConsent] = useState(false),
    [adding, setAdding] = useState(false),
    [reconciling, setReconciling] = useState<string | null>(null),
    [vendorId, setVendorId] = useState(''),
    [clock, setClock] = useState(() => new Date());
  const revision = record.revisions.find((r) => r.version === version) || record.revisions.at(-1)!;
  const dirty = JSON.stringify(task) !== JSON.stringify(revision.task),
    readOnly = version !== record.currentVersion;
  const storageKey = `readycheck-draft-v1:${session.user.id}:${record.id}:${version}`;
  useEffect(() => {
    setVersion(record.currentVersion);
  }, [record.currentVersion]);
  useEffect(() => {
    try {
      const saved = readOnly ? null : localStorage.getItem(storageKey);
      const parsed = saved ? taskSchema.safeParse(JSON.parse(saved)) : null;
      setTask(parsed?.success ? parsed.data : revision.task);
    } catch {
      setTask(revision.task);
    }
  }, [storageKey, revision.task, readOnly]);
  function changeTask(next: Task) {
    setTask(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* server save remains available */
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const rankings = rankResults(revision.task, revision.results, clock),
    passing = rankings.filter((x) => x.evaluation.verdict === 'pass').length;
  const evidenceEntry = rankings.find((x) => x.candidate.id === evidence);
  const candidates =
    record.mode === 'sample'
      ? sampleCandidates(task.template)
      : session.connection.recipients.map((r) => ({
          ...r,
          category: 'Consenting test participant',
          area: r.maskedPhone,
          initials: r.name
            .split(' ')
            .map((x) => x[0])
            .slice(0, 2)
            .join(''),
        }));
  const chosen = selected.filter((id) => candidates.some((c) => c.id === id));
  const activePlans = record.plans.filter((p) => p.version === version);
  const progress = checkProgress(record, activePlans, clock, version);
  const remaining = candidates.filter((c) => !revision.results.some((r) => r.id === c.id));
  const additions = chosen.filter((id) => remaining.some((c) => c.id === id));
  const canCheck =
    !readOnly &&
    !dirty &&
    !Object.keys(validateTask(task)).length &&
    !record.stopped &&
    chosen.length > 0;
  function askFollowup(id: string, field?: string) {
    setFocusField(field);
    if (record.mode === 'sample') setSamplePreview(id);
    else actions.prepare([id], id, field);
  }
  function chooseOutcome(id: string, state: string) {
    setOutcome({ id, state });
    setNote('');
  }
  return (
    <div className="workspace-page">
      <div className="workspace-heading">
        <button className="back-link" onClick={onBack}>
          <ArrowLeft size={15} />
          All checks
        </button>
        <div className="workspace-title-line">
          <div>
            <div className="workspace-label">
              <ModeBadge mode={record.mode} />
              <span className="revision-tag">Revision {version}</span>
            </div>
            <h1>{revision.task.title}</h1>
            <p>{revision.task.locality} · Requirements first. Evidence always.</p>
          </div>
          <div className="workspace-toolbar">
            <label className="revision-select">
              <span className="sr-only">View revision</span>
              <select
                value={version}
                onChange={(e) => {
                  setVersion(Number(e.target.value));
                }}
              >
                {record.revisions.map((r) => (
                  <option key={r.version} value={r.version}>
                    Revision {r.version}
                    {r.version === record.currentVersion ? ' · current' : ''}
                  </option>
                ))}
              </select>
            </label>
            <a
              className="button secondary"
              href={`/api/cases/${record.id}/export?version=${version}`}
            >
              <Download size={15} />
              Export
            </a>
            <button
              className="icon-button"
              aria-label="Delete this check"
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
      </div>
      <div className="provenance-banner">
        <FlaskConical size={17} />
        <span>
          {record.mode === 'sample' ? (
            <>
              You’re exploring a fictional scenario.{' '}
              <strong>All businesses and responses are samples. No calls are made.</strong>
            </>
          ) : (
            <>Controlled test mode. Calls require a reviewed plan and consenting test recipients.</>
          )}
        </span>
      </div>
      {readOnly ? (
        <div className="history-banner">
          You’re viewing a saved revision. Its results belong to the requirements shown here.
        </div>
      ) : null}
      <CheckJourney
        progress={progress}
        busy={busy}
        readOnly={readOnly}
        dirty={dirty}
        onAction={() => {
          if (progress.action === 'evidence' && progress.candidateId) {
            setEvidence(progress.candidateId);
            return;
          }
          const callStatus = ['calling', 'attention'].includes(progress.phase);
          setTab(progress.action === 'activity' && !callStatus ? 'activity' : 'comparison');
          requestAnimationFrame(() => {
            const target = document.getElementById(
              callStatus ? 'inquiry-progress' : 'comparison-results',
            );
            target?.scrollIntoView({ block: 'start' });
            target?.focus({ preventScroll: true });
          });
        }}
      />
      <div className="workspace-grid">
        <Requirements
          task={task}
          onChange={changeTask}
          onSave={() => {
            actions.save(task);
          }}
          dirty={dirty}
          busy={busy}
          readOnly={readOnly}
        />
        <section
          className="results-area"
          id="comparison-results"
          tabIndex={-1}
          aria-label="Results"
        >
          <div className="results-top">
            <div className="tabs">
              <button
                className={tab === 'comparison' ? 'active' : ''}
                onClick={() => setTab('comparison')}
              >
                Compare options<span>{revision.results.length}</span>
              </button>
              <button
                className={tab === 'activity' ? 'active' : ''}
                onClick={() => setTab('activity')}
              >
                Activity & outcomes
              </button>
            </div>
            <button
              className="icon-button"
              aria-label="Refresh saved results"
              onClick={actions.refresh}
              disabled={busy}
            >
              <RefreshCw size={16} />
            </button>
          </div>
          {tab === 'comparison' ? (
            <>
              {activePlans.length ? (
                <InquiryProgress
                  plans={activePlans}
                  busy={busy}
                  stopped={record.stopped}
                  onReview={(id) => {
                    const result = revision.results.find((r) => r.inquiryId === id);
                    if (result) setEvidence(result.id);
                  }}
                  onRecover={(id) => {
                    setReconciling(id);
                    setVendorId('');
                  }}
                  onContinue={actions.continue}
                  onStop={actions.stop}
                />
              ) : null}
              {dirty ? (
                <EmptyState title="Save your revised requirements.">
                  Your draft is preserved in this browser. Save a new revision to compare the
                  evidence against these changes.
                </EmptyState>
              ) : !revision.results.length ? (
                <>
                  <div className="candidate-picker">
                    <div className="panel-title">
                      <div>
                        <h2>Choose who to check with</h2>
                        <p className="muted">
                          Select up to three{' '}
                          {record.mode === 'sample'
                            ? 'fictional businesses'
                            : 'consenting test participants'}
                          .
                        </p>
                      </div>
                    </div>
                    {candidates.map((c) => (
                      <label
                        className={`candidate-choice ${chosen.includes(c.id) ? 'chosen' : ''}`}
                        key={c.id}
                      >
                        <input
                          type="checkbox"
                          checked={chosen.includes(c.id)}
                          disabled={
                            busy || readOnly || (!chosen.includes(c.id) && chosen.length >= 3)
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...chosen, c.id]
                                : chosen.filter((id) => id !== c.id),
                            )
                          }
                        />
                        <span className="business-avatar">{c.initials}</span>
                        <span>
                          <strong>{c.name}</strong>
                          <small>
                            {c.category} · {c.area}
                          </small>
                        </span>
                        {record.mode === 'sample' ? (
                          <span className="fictional-tag">Fictional</span>
                        ) : null}
                      </label>
                    ))}
                    {!candidates.length ? (
                      <p className="muted">
                        No test recipients are configured. Open Connection to review setup
                        requirements.
                      </p>
                    ) : null}
                    <div className="candidate-picker-footer">
                      <span>
                        <FileText size={15} />
                        Review the questions before proceeding
                      </span>
                      <button
                        className="button primary"
                        disabled={!canCheck || busy}
                        onClick={() =>
                          record.mode === 'sample'
                            ? setSamplePreview('initial')
                            : actions.prepare(chosen)
                        }
                      >
                        Preview inquiry
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                  <EmptyState title="A clear comparison starts with the right questions.">
                    Every answer will be checked against your must-haves. Missing details stay
                    visible, so you can decide with confidence.
                  </EmptyState>
                </>
              ) : (
                <>
                  <div className="comparison-summary">
                    <div>
                      <h2>
                        {passing
                          ? `${passing} option${passing === 1 ? '' : 's'} meet${passing === 1 ? 's' : ''} your checked requirements.`
                          : 'Every detail matters.'}
                      </h2>
                      <p>
                        {passing
                          ? 'Review the evidence, then choose your next step.'
                          : 'No confirmed match yet. Here’s what works — and what still needs an answer.'}
                      </p>
                    </div>
                    <span className="checked-count">
                      <CheckCheck size={17} />
                      {revision.results.length} checked
                    </span>
                  </div>
                  {!readOnly ? (
                    <DecisionGuide
                      task={revision.task}
                      results={revision.results}
                      now={clock}
                      disabled={busy || dirty || record.stopped}
                      canCall={
                        record.mode === 'sample' ||
                        (session.connection.configured && session.connection.authorized)
                      }
                      onQuestion={askFollowup}
                      onApply={(next) => {
                        changeTask(next);
                        actions.save(next);
                      }}
                      onEvidence={setEvidence}
                    />
                  ) : null}
                  <div className="result-cards">
                    {rankings.map(({ candidate: c, evaluation: e }, index) => {
                      const latest = record.outcomes.filter((o) => o.candidateId === c.id).at(-1),
                        blocked = e.blockers[0],
                        advice = nextUsefulQuestion(revision.task, c, clock);
                      return (
                        <article className={`result-card result-${e.verdict}`} key={c.id}>
                          <div className="result-card-top">
                            <span className="business-avatar">{c.initials}</span>
                            <div className="business-heading">
                              <h3>{c.name}</h3>
                              <p>
                                {c.category} · {c.area}
                              </p>
                            </div>
                            <span className="option-number">0{index + 1}</span>
                          </div>
                          <div className={`verdict-pill ${e.verdict}`}>
                            <StatusIcon verdict={e.verdict} />
                            {e.label}
                          </div>
                          <div className="result-checks">
                            {e.checks.map((check) => (
                              <div className="result-check" key={check.requirement.id}>
                                <span>
                                  {check.requirement.label}
                                  {check.requirement.importance === 'preference' ? (
                                    <small> preference</small>
                                  ) : null}
                                </span>
                                <span>
                                  <StatusIcon verdict={check.verdict} />
                                  {check.verdict === 'pass'
                                    ? 'Confirmed'
                                    : check.verdict === 'fail'
                                      ? 'Doesn’t meet'
                                      : check.verdict === 'unknown'
                                        ? 'Unconfirmed'
                                        : check.verdict === 'conflict'
                                          ? 'Conflicting'
                                          : 'Needs recheck'}
                                </span>
                              </div>
                            ))}
                          </div>
                          {blocked ? (
                            <div className={`blocker-callout ${e.verdict}`}>
                              <strong>{blocked.requirement.label}</strong>
                              <p>{blocked.reason}</p>
                            </div>
                          ) : (
                            <div className="match-callout">
                              <Check size={16} />
                              <p>
                                All must-haves have supporting evidence. Reconfirm before arranging.
                              </p>
                            </div>
                          )}
                          <div className="result-card-footer">
                            <button className="text-button" onClick={() => setEvidence(c.id)}>
                              View evidence
                              <ArrowUpRight size={14} />
                            </button>
                            <span>
                              {c.mode === 'sample' ? 'Fictional sample' : 'Live test'} ·{' '}
                              {new Date(c.checkedAt).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {!readOnly ? (
                            <div className="result-next-action">
                              {advice.kind === 'ask' ? (
                                <button
                                  className="button secondary"
                                  disabled={
                                    busy ||
                                    dirty ||
                                    record.stopped ||
                                    (record.mode !== 'sample' &&
                                      !(
                                        session.connection.configured &&
                                        session.connection.authorized
                                      ))
                                  }
                                  onClick={() => askFollowup(c.id, advice.field)}
                                >
                                  <MessageSquare size={14} />
                                  Preview one-question follow-up
                                </button>
                              ) : null}
                              <button
                                className={`button ${e.verdict === 'pass' ? 'primary' : 'subtle'}`}
                                disabled={busy || latest?.state === 'completed'}
                                onClick={() =>
                                  chooseOutcome(
                                    c.id,
                                    latest?.state === 'selected'
                                      ? 'arrangement_confirmed'
                                      : latest?.state === 'arrangement_confirmed'
                                        ? 'completed'
                                        : 'selected',
                                  )
                                }
                              >
                                {latest?.state === 'selected'
                                  ? 'Confirm arrangement'
                                  : latest?.state === 'arrangement_confirmed'
                                    ? 'Mark completed'
                                    : latest?.state === 'completed'
                                      ? 'Completed by you'
                                      : 'Save to shortlist'}
                                <ArrowRight size={14} />
                              </button>
                              {latest &&
                              latest.state !== 'closed_without_success' &&
                              latest.state !== 'completed' ? (
                                <button
                                  className="text-button muted"
                                  onClick={() => chooseOutcome(c.id, 'closed_without_success')}
                                >
                                  Close without success
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                          {e.verdict !== 'pass' ? (
                            <p className="question-advice">{advice.reason}</p>
                          ) : null}
                          {latest ? (
                            <p className="outcome-tag">
                              <Check size={12} />
                              You marked this {latest.state.replaceAll('_', ' ')}
                            </p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                  {remaining.length && !readOnly ? (
                    <button
                      className="button secondary"
                      disabled={busy || dirty || record.stopped}
                      onClick={() => setAdding(true)}
                    >
                      <Plus size={14} />
                      Add a candidate
                    </button>
                  ) : null}
                  <div className="results-disclaimer">
                    <Clock3 size={15} />
                    <p>
                      Answers reflect the time checked. Availability can change. You arrange any
                      booking, purchase, or service.
                    </p>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="activity-panel">
              <h2>The story of this check</h2>
              <div className="activity-item">
                <span className="activity-dot" />
                <div>
                  <strong>Check created</strong>
                  <p>
                    {new Date(record.createdAt).toLocaleString()} ·{' '}
                    {record.mode === 'sample' ? 'Fictional sample' : 'Controlled live'}
                  </p>
                </div>
              </div>
              {record.revisions.map((r) => (
                <div className="activity-item" key={r.version}>
                  <span className="activity-dot" />
                  <div>
                    <strong>Revision {r.version} saved</strong>
                    <p>
                      {new Date(r.createdAt).toLocaleString()} · {r.task.requirements.length}{' '}
                      requirements · {r.results.length} results
                    </p>
                  </div>
                </div>
              ))}
              {record.outcomes.map((o) => (
                <div className="activity-item" key={o.id}>
                  <span className="activity-dot filled" />
                  <div>
                    <strong>{o.state.replaceAll('_', ' ')} — recorded by you</strong>
                    <p>
                      {revision.results.find((r) => r.id === o.candidateId)?.name || o.candidateId}{' '}
                      · {new Date(o.at).toLocaleString()}
                    </p>
                    {o.note ? <p>{o.note}</p> : null}
                  </div>
                </div>
              ))}
              {!record.outcomes.length ? (
                <p className="muted">
                  No outcome has been recorded. Checking a business never automatically confirms an
                  arrangement.
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
      {evidenceEntry ? (
        <Evidence
          candidate={evidenceEntry.candidate}
          evaluation={evidenceEntry.evaluation}
          task={revision.task}
          onClose={() => setEvidence(null)}
          busy={busy}
          onReview={(review) => actions.review(evidenceEntry.candidate.id, version, review)}
          onAcknowledge={
            evidenceEntry.candidate.inquiryId &&
            !pendingFacts(evidenceEntry.candidate).length &&
            activePlans.some((p) =>
              p.inquiries.some(
                (i) => i.id === evidenceEntry.candidate.inquiryId && i.state === 'review_required',
              ),
            )
              ? () => actions.acknowledge(evidenceEntry.candidate.inquiryId!)
              : undefined
          }
        />
      ) : null}
      {samplePreview ? (
        <Modal
          title={
            samplePreview === 'initial' || samplePreview === 'additional'
              ? 'Preview your inquiry'
              : 'Preview a targeted follow-up'
          }
          onClose={() => setSamplePreview(null)}
          wide
        >
          <ModeBadge mode="sample" />
          <p className="modal-intro">
            These responses are fictional and describe the original sample request. This action
            makes no phone calls.
          </p>
          <div className="preview-recipients">
            {candidates
              .filter((c) =>
                samplePreview === 'initial' || samplePreview === 'additional'
                  ? (samplePreview === 'additional' ? additions : chosen).includes(c.id)
                  : c.id === samplePreview,
              )
              .map((c) => (
                <span key={c.id}>
                  <span className="small-dot" />
                  {c.name}
                </span>
              ))}
          </div>
          <h3>What we’ll check</h3>
          <ol className="question-list">
            {task.requirements
              .filter(
                (r) =>
                  samplePreview === 'initial' ||
                  samplePreview === 'additional' ||
                  (focusField
                    ? r.id === focusField
                    : rankings
                        .find((x) => x.candidate.id === samplePreview)
                        ?.evaluation.checks.some(
                          (c) => c.requirement.id === r.id && c.verdict !== 'pass',
                        )),
              )
              .map((r) => (
                <li key={r.id}>
                  <strong>{r.label}</strong>
                  <p>{r.question}</p>
                  <small>{displayValue(r, task.timeZone)}</small>
                </li>
              ))}
          </ol>
          {samplePreview !== 'initial' &&
          samplePreview !== 'additional' &&
          samplePreview !== 'repair-1' ? (
            <p className="muted">
              This scenario has no additional confirmed response. The follow-up will leave
              unanswered requirements unresolved.
            </p>
          ) : null}
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setSamplePreview(null)}>
              Keep reviewing
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (samplePreview === 'initial' || samplePreview === 'additional')
                  actions.sample(samplePreview === 'additional' ? additions : chosen);
                else actions.followup(samplePreview, focusField);
                setSamplePreview(null);
              }}
            >
              Load fictional{' '}
              {samplePreview === 'initial' || samplePreview === 'additional'
                ? 'responses'
                : 'follow-up'}
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      ) : null}
      {preview ? (
        <Modal
          title="Approve this exact live inquiry"
          onClose={() => {
            setConsent(false);
            onClosePreview();
          }}
          wide
        >
          <ModeBadge mode="live" />
          <p className="modal-intro">
            Up to {preview.recipients.length} consenting test recipients, contacted sequentially.
            You review material facts before continuing. Approval expires at{' '}
            {new Date(preview.expiresAt).toLocaleTimeString()}.
          </p>
          <div className="preview-recipients">
            {preview.recipients.map((r) => (
              <span key={r.id}>
                {r.name} · {r.maskedPhone}
              </span>
            ))}
          </div>
          <h3>Opening disclosure</h3>
          <blockquote className="disclosure">{preview.disclosure}</blockquote>
          <h3>Questions and requirements</h3>
          <p className="muted small">
            Your budget stays private. The caller asks for their price first and may ask once for a
            better price. It does not accept a quote or book anything. CALL-E controls the spoken
            conversation.
          </p>
          <ol className="question-list">
            {preview.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
          <details className="full-instructions">
            <summary>Full approved call instructions</summary>
            <pre>{preview.taskText}</pre>
          </details>
          <label className="consent-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I approve these recipients, questions, and disclosures. The configured test participants
            have consented. No bookings or transactions are authorized.
          </label>
          <div className="modal-actions">
            <button className="button secondary" onClick={onClosePreview}>
              Keep reviewing
            </button>
            <button
              className="button primary"
              disabled={!consent || busy}
              onClick={() => actions.approve(preview)}
            >
              <Phone size={15} />
              Approve and call first recipient
            </button>
          </div>
        </Modal>
      ) : null}
      {outcome ? (
        <Modal
          title={
            outcome.state === 'selected'
              ? 'Save this option to your shortlist'
              : outcome.state === 'arrangement_confirmed'
                ? 'Confirm your arrangement'
                : outcome.state === 'completed'
                  ? 'Record that the task is complete'
                  : 'Close without success'
          }
          onClose={() => setOutcome(null)}
        >
          <p className="modal-intro">
            {outcome.state === 'selected'
              ? 'This saves your choice. It does not book, reserve, or guarantee anything.'
              : outcome.state === 'arrangement_confirmed'
                ? 'Only confirm this if you have personally arranged the service, rental, or visit.'
                : 'This is your record of what happened. The inquiry does not make this decision.'}
          </p>
          {record.mode === 'sample' ? (
            <p className="sample-note">This outcome stays labeled as part of a fictional sample.</p>
          ) : null}
          <label>
            Note (optional)
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
            />
          </label>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setOutcome(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                actions.outcome(outcome.id, outcome.state, note);
                setOutcome(null);
              }}
            >
              Confirm my update
              <Check size={15} />
            </button>
          </div>
        </Modal>
      ) : null}
      {adding ? (
        <Modal title="Add a candidate" onClose={() => setAdding(false)}>
          <p className="modal-intro">
            Existing evidence stays in this case. Choose another candidate to check.
          </p>
          {remaining.map((c) => (
            <label className="candidate-choice" key={c.id}>
              <input
                type="checkbox"
                checked={additions.includes(c.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id),
                  )
                }
              />
              <span>
                <strong>{c.name}</strong>
                <small>{c.area}</small>
              </span>
            </label>
          ))}
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy || !additions.length || additions.length > 3}
              onClick={() => {
                if (record.mode === 'sample') {
                  setSamplePreview('additional');
                  setAdding(false);
                } else {
                  actions.prepare(additions);
                  setAdding(false);
                }
              }}
            >
              Preview additional inquiry
              <ArrowRight size={15} />
            </button>
          </div>
        </Modal>
      ) : null}
      {reconciling ? (
        <Modal title="Recover an existing call" onClose={() => setReconciling(null)}>
          <p className="modal-intro">
            Find the original call ID in your CALL-E account. ReadyCheck will only read it and
            attach it if the provider returns matching inquiry metadata. This never redials.
          </p>
          {(() => {
            const inquiry = record.plans
              .flatMap((p) => p.inquiries)
              .find((i) => i.id === reconciling);
            return (
              <div className="notice">
                {inquiry?.recoveredVendorId ? (
                  <p>
                    Saved call reference: <code>{inquiry.recoveredVendorId}</code>
                  </p>
                ) : null}
                {inquiry?.recoveryAttempted ? (
                  <p>
                    Request recovery was already attempted. Use the original call ID below for
                    read-only verification.
                  </p>
                ) : (
                  <>
                    <p>
                      If the response was lost, you can retry the exact approved request once.
                      CALL-E uses the original key to recover an existing call. If the first request
                      never arrived, this may start the approved call now.
                    </p>
                    <button
                      className="button secondary"
                      disabled={
                        busy || !session.connection.configured || !session.connection.authorized
                      }
                      onClick={() => {
                        actions.recover(reconciling);
                        setReconciling(null);
                      }}
                    >
                      Recover original request once
                    </button>
                  </>
                )}
              </div>
            );
          })()}
          <label>
            Existing CALL-E call ID
            <input
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="modal-actions">
            <button
              className="button primary"
              disabled={busy || !vendorId.trim()}
              onClick={() => {
                actions.reconcile(reconciling, vendorId.trim());
                setReconciling(null);
              }}
            >
              Check and recover existing call
            </button>
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal title="Delete this check?" onClose={() => setDeleting(false)}>
          <p className="modal-intro">
            Your case, revisions, and evidence will be removed from this workspace. Queued calls
            will stop. An already active call may still finish, and external provider retention
            follows its own terms.
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setDeleting(false)}>
              Keep check
            </button>
            <button className="button danger-button" disabled={busy} onClick={actions.remove}>
              Delete check
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
