import { useState } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical, Radio } from 'lucide-react';
import type { SessionInfo, Task } from '../domain/model';
import { defaultTask, draftFromText, templateMeta, withAcquisition } from '../domain/templates';
import { Modal, InlineError } from './Shared';
import { Requirements } from './Requirements';

export interface NewCheckStart {
  template: Task['template'];
  text?: string;
  mode?: 'sample' | 'live';
}
export function NewCheck({
  initial,
  session,
  busy,
  error,
  onClose,
  onCreate,
  onConnection,
}: {
  initial: NewCheckStart;
  session: SessionInfo;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (task: Task, mode: 'sample' | 'live') => void;
  onConnection: () => void;
}) {
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState(initial.template);
  const [description, setDescription] = useState(initial.text || '');
  const [acquisition, setAcquisition] = useState<'rental' | 'purchase'>('rental');
  const [mode, setMode] = useState<'sample' | 'live'>(initial.mode || 'sample');
  const [task, setTask] = useState<Task | null>(null);
  const [reviewedSource, setReviewedSource] = useState('');
  const ready = session.connection.configured && session.connection.authorized;
  function review() {
    const source = JSON.stringify({ template, acquisition, description });
    if (task && reviewedSource === source) {
      setStep(2);
      return;
    }
    let next = description.trim()
      ? draftFromText(template, description.trim()).task
      : defaultTask(template);
    if (template === 'rental') {
      next = withAcquisition(next, acquisition);
      if (acquisition === 'purchase' && !description.trim()) {
        next.title = 'Buy a projector for a workshop';
        next.description =
          'Buy an Epson EB-FH52 projector with HDMI, up to $1,200 all-in, for collection on Friday.';
        next.requirements.find((r) => r.id === 'budget')!.value = 120000;
      }
    }
    setTask(next);
    setReviewedSource(source);
    setStep(2);
  }
  return (
    <Modal
      title={step === 1 ? 'Start a new check' : 'Make the requirements yours'}
      onClose={onClose}
    >
      <div className="new-check-flow">
        <p className="step-caption">
          Step {step} of 2 · {step === 1 ? 'Choose your starting point' : 'Review before saving'}
        </p>
        {error ? <InlineError message={error} /> : null}
        {step === 1 ? (
          <>
            <label>
              What do you need to check?
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as Task['template'])}
              >
                {Object.entries(templateMeta).map(([id, meta]) => (
                  <option key={id} value={id}>
                    {meta.title}
                  </option>
                ))}
              </select>
            </label>
            {template === 'rental' ? (
              <label>
                Purchase or rental
                <select
                  value={acquisition}
                  onChange={(e) => setAcquisition(e.target.value as 'rental' | 'purchase')}
                >
                  <option value="rental">Rent it</option>
                  <option value="purchase">Buy it</option>
                </select>
              </label>
            ) : null}
            <label>
              Describe your request <span className="muted">(optional)</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What item or service, where, when, and within what budget?"
              />
            </label>
            <fieldset className="check-paths">
              <legend>How would you like to check?</legend>
              <label className={mode === 'sample' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="check-path"
                  value="sample"
                  checked={mode === 'sample'}
                  onChange={() => setMode('sample')}
                />
                <FlaskConical size={20} />
                <span>
                  <strong>Explore a fictional example</strong>
                  <small>Try the workflow with sample businesses and responses.</small>
                </span>
              </label>
              <label className={mode === 'live' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="check-path"
                  value="live"
                  checked={mode === 'live'}
                  disabled={!ready}
                  onChange={() => setMode('live')}
                />
                <Radio size={20} />
                <span>
                  <strong>Make a real inquiry</strong>
                  <small>
                    {ready
                      ? 'Choose approved recipients and review the call plan before dispatch.'
                      : 'Connect CALL-E and authorize your account to enable real inquiries.'}
                  </small>
                </span>
              </label>
            </fieldset>
            {!ready ? (
              <button className="text-button" onClick={onConnection}>
                View connection setup <ArrowRight size={14} />
              </button>
            ) : null}
            <button className="button primary full" disabled={busy} onClick={review}>
              Review requirements <ArrowRight size={16} />
            </button>
          </>
        ) : task ? (
          <>
            <p className="notice new-check-notice">
              {mode === 'sample'
                ? 'Example responses stay tied to the original fictional scenario. Changing your request may leave requirements unanswered.'
                : 'Saving creates your check. You will select recipients and approve an exact inquiry before any call.'}
            </p>
            {description.trim() ? (
              <p className="muted small">
                Your description is saved verbatim. The starter helper recognizes a simple budget;
                review and edit the service, model, dates, and other details below.
              </p>
            ) : null}
            <Requirements
              task={task}
              onChange={setTask}
              initialEditing
              dirty
              busy={busy}
              saveLabel="Create check"
              onSave={() => onCreate(task, mode)}
            />
            <button className="text-button" onClick={() => setStep(1)} disabled={busy}>
              <ArrowLeft size={14} /> Back to starting point
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
