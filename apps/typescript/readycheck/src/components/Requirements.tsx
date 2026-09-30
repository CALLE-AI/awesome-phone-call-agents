import { Plus, Trash2, Info, Save } from 'lucide-react';
import type { Requirement, Task } from '../domain/model';
import { displayValue, validateTask } from '../domain/evaluator';
import { instantToLocal, localToInstant } from '../domain/time';
import { useState } from 'react';
import { withAcquisition } from '../domain/templates';
export function Requirements({
  task,
  onChange,
  onSave,
  dirty,
  busy,
  readOnly = false,
  initialEditing = false,
  saveLabel = 'Save new revision',
}: {
  task: Task;
  onChange: (task: Task) => void;
  onSave: () => void;
  dirty: boolean;
  busy: boolean;
  readOnly?: boolean;
  initialEditing?: boolean;
  saveLabel?: string;
}) {
  const [editing, setEditing] = useState(initialEditing),
    [dateErrors, setDateErrors] = useState<Record<string, string>>({});
  const errors = validateTask(task);
  const update = (id: string, patch: Partial<Requirement>) =>
    onChange({
      ...task,
      requirements: task.requirements.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  const dates = (id: string, value: string, field?: 'start' | 'end') => {
    try {
      const instant = localToInstant(value, task.timeZone);
      const r = task.requirements.find((r) => r.id === id)!;
      update(id, {
        value: field && typeof r.value === 'object' ? { ...r.value, [field]: instant } : instant,
      });
      setDateErrors((prev) => ({ ...prev, [id]: '' }));
    } catch {
      setDateErrors((prev) => ({ ...prev, [id]: 'Enter an unambiguous local date and time.' }));
    }
  };
  function input(r: Requirement) {
    const v = r.value;
    if (r.kind === 'boolean')
      return (
        <select
          aria-label={r.label}
          value={String(v)}
          onChange={(e) => update(r.id, { value: e.target.value === 'true' })}
        >
          <option value="true">Yes, required</option>
          <option value="false">No</option>
        </select>
      );
    if (r.kind === 'deadline')
      return (
        <input
          type="datetime-local"
          aria-label={r.label}
          value={typeof v === 'string' ? instantToLocal(v, task.timeZone) : ''}
          onChange={(e) => dates(r.id, e.target.value)}
        />
      );
    if (r.kind === 'window' && typeof v === 'object')
      return (
        <div className="window-inputs">
          <label>
            From
            <input
              aria-label={`${r.label} start`}
              type="datetime-local"
              value={instantToLocal(v.start, task.timeZone)}
              onChange={(e) => dates(r.id, e.target.value, 'start')}
            />
          </label>
          <label>
            Until
            <input
              aria-label={`${r.label} end`}
              type="datetime-local"
              value={instantToLocal(v.end, task.timeZone)}
              onChange={(e) => dates(r.id, e.target.value, 'end')}
            />
          </label>
          <label>
            Minimum usable minutes
            <input
              type="number"
              min="1"
              max="1440"
              value={v.minimumMinutes || 1}
              onChange={(e) =>
                update(r.id, { value: { ...v, minimumMinutes: Number(e.target.value) } })
              }
            />
          </label>
        </div>
      );
    if (r.kind === 'max' || r.kind === 'min')
      return (
        <div className="number-input">
          {r.unit === 'USD' ? <span>$</span> : null}
          <input
            aria-label={r.label}
            type="number"
            min="0"
            step={r.unit === 'USD' ? '0.01' : '1'}
            value={typeof v === 'number' ? (r.unit === 'USD' ? v / 100 : v) : 0}
            onChange={(e) =>
              update(r.id, {
                value: Math.round(Number(e.target.value) * (r.unit === 'USD' ? 100 : 1)),
              })
            }
          />
        </div>
      );
    return (
      <input
        aria-label={r.label}
        value={String(v)}
        maxLength={500}
        onChange={(e) => update(r.id, { value: e.target.value })}
      />
    );
  }
  return (
    <section className={`requirements-panel ${editing && !readOnly ? 'is-editing' : ''}`}>
      <div className="panel-title">
        <h2>Your requirements</h2>
        {!readOnly ? (
          <button className="text-button" onClick={() => setEditing(!editing)}>
            {editing ? 'Done editing' : 'Edit'}
          </button>
        ) : null}
      </div>
      <p className="panel-description">The details that make an option work for you.</p>
      {Object.entries(errors)
        .filter(([id]) => !task.requirements.some((r) => r.id === id))
        .map(([id, message]) => (
          <p className="field-error" role="alert" key={id}>
            {message}
          </p>
        ))}
      {editing && !readOnly ? (
        <div className="requirement-editor">
          {task.template === 'rental' ? (
            <label>
              How do you need the item?
              <select
                aria-label="Purchase or rental"
                value={task.acquisition || 'rental'}
                onChange={(e) =>
                  onChange(withAcquisition(task, e.target.value as 'rental' | 'purchase'))
                }
              >
                <option value="rental">Rent it</option>
                <option value="purchase">Buy it</option>
              </select>
            </label>
          ) : null}
          <label>
            Check name
            <input
              value={task.title}
              maxLength={100}
              onChange={(e) => onChange({ ...task, title: e.target.value })}
            />
          </label>
          <label>
            City or locality
            <input
              value={task.locality}
              onChange={(e) => onChange({ ...task, locality: e.target.value })}
            />
          </label>
          <label>
            Time zone
            <select
              value={task.timeZone}
              onChange={(e) => onChange({ ...task, timeZone: e.target.value })}
            >
              {[
                'America/Chicago',
                'America/New_York',
                'America/Denver',
                'America/Los_Angeles',
                'America/Phoenix',
                'Pacific/Honolulu',
                'America/Anchorage',
                'UTC',
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="locality-line">
          {task.locality}
          <span>{task.timeZone.replace('America/', '').replaceAll('_', ' ')}</span>
        </div>
      )}
      <div className="requirements-list">
        {task.requirements.map((r, i) => (
          <div className="requirement-row" key={r.id}>
            <div className="requirement-label">
              <span className="req-number">{String(i + 1).padStart(2, '0')}</span>
              <span>{r.label}</span>
              {r.importance === 'preference' ? (
                <span className="preference-label">Nice to have</span>
              ) : (
                <span className="must-dot" title="Must-have" />
              )}
            </div>
            {editing && !readOnly ? (
              <div className="requirement-controls">
                {input(r)}
                {r.id === 'item' && r.kind === 'exact' ? (
                  <div className="alternative-editor">
                    <p className="muted small">
                      Only the named model is accepted unless you add alternatives below. Each
                      alternative needs its own price and availability evidence.
                    </p>
                    {(r.alternatives || []).map((alternative, index) => (
                      <div className="alternative-input" key={index}>
                        <input
                          aria-label={`Accepted alternative ${index + 1}`}
                          value={alternative}
                          maxLength={100}
                          onChange={(e) =>
                            update(r.id, {
                              alternatives: r.alternatives!.map((value, i) =>
                                i === index ? e.target.value : value,
                              ),
                            })
                          }
                        />
                        <button
                          className="icon-button"
                          aria-label={`Remove alternative ${index + 1}`}
                          onClick={() =>
                            update(r.id, {
                              alternatives: r.alternatives!.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    {(r.alternatives?.length || 0) < 3 ? (
                      <button
                        className="text-button"
                        onClick={() =>
                          update(r.id, { alternatives: [...(r.alternatives || []), ''] })
                        }
                      >
                        <Plus size={14} /> Accept another model
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="requirement-small-controls">
                  <select
                    aria-label={`${r.label} importance`}
                    value={r.importance}
                    onChange={(e) =>
                      update(r.id, { importance: e.target.value as Requirement['importance'] })
                    }
                  >
                    <option value="must">Must-have</option>
                    <option value="preference">Preference</option>
                  </select>
                  {r.id.startsWith('custom') ? (
                    <button
                      className="icon-button"
                      aria-label={`Remove ${r.label}`}
                      onClick={() =>
                        onChange({
                          ...task,
                          requirements: task.requirements.filter((x) => x.id !== r.id),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
                <label className="question-label">
                  Question to ask
                  <textarea
                    value={r.question}
                    onChange={(e) => update(r.id, { question: e.target.value })}
                    maxLength={500}
                    rows={2}
                  />
                </label>
              </div>
            ) : (
              <p className="requirement-value">{displayValue(r, task.timeZone)}</p>
            )}
            {errors[r.id] || dateErrors[r.id] ? (
              <p className="field-error" role="alert">
                {errors[r.id] || dateErrors[r.id]}
              </p>
            ) : null}
          </div>
        ))}
      </div>
      {editing &&
      !readOnly &&
      task.requirements.filter((r) => r.id.startsWith('custom')).length < 2 ? (
        <button
          className="add-requirement"
          onClick={() => {
            const id = `custom-${Date.now().toString(36)}`;
            onChange({
              ...task,
              requirements: [
                ...task.requirements,
                {
                  id,
                  label: 'Additional requirement',
                  kind: 'boolean',
                  value: true,
                  importance: 'must',
                  unit: 'none',
                  question: 'Please describe the specific yes/no question to ask.',
                },
              ],
            });
          }}
        >
          <Plus size={15} />
          Add a factual requirement
        </button>
      ) : null}
      {editing
        ? task.requirements
            .filter((r) => r.id.startsWith('custom'))
            .map((r) => (
              <div className="custom-name" key={r.id}>
                <label>
                  Custom field name
                  <input
                    value={r.label}
                    maxLength={100}
                    onChange={(e) => update(r.id, { label: e.target.value })}
                  />
                </label>
                <label>
                  Check type
                  <select
                    value={r.kind}
                    onChange={(e) => {
                      const kind = e.target.value as Requirement['kind'];
                      update(r.id, { kind, value: kind === 'boolean' ? true : '', unit: 'none' });
                    }}
                  >
                    <option value="boolean">Yes / no</option>
                    <option value="exact">Exact answer</option>
                    <option value="manual">Manual judgment</option>
                  </select>
                </label>
              </div>
            ))
        : null}
      {dirty && !readOnly ? (
        <button
          className="button primary full"
          disabled={
            busy || Object.values(dateErrors).some(Boolean) || Object.keys(errors).length > 0
          }
          onClick={onSave}
        >
          <Save size={15} />
          {saveLabel}
        </button>
      ) : null}
      <div className="requirement-note">
        <Info size={15} />
        <p>Every must-have needs current evidence. A missing answer stays unresolved.</p>
      </div>
    </section>
  );
}
