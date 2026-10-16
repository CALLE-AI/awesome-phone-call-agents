'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { proxied, ApiError } from '@/lib/api';

/**
 * Create a workflow from a template. The template decides the structured
 * result; nothing here is industry-specific code.
 */

const TEMPLATES = [
  {
    id: 'appointment_reminder',
    label: 'Appointment reminders',
    description: 'Call customers before an appointment and confirm, cancel, or offer a reschedule.',
  },
  {
    id: 'lead_callback',
    label: 'Customer callbacks',
    description: 'Call a lead, gauge interest, and agree a time for you to call back or visit.',
  },
  {
    id: 'general_followup',
    label: 'Custom phone job',
    description: 'Describe the goal in your own words. Dial returns a structured outcome for every call.',
  },
];

export default function NewWorkflowPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('appointment_reminder');
  const [goal, setGoal] = useState('');
  const [locale, setLocale] = useState('en');
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(19);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void proxied.getBusiness(businessId).then((b) => setLocale(b.locale)).catch(() => undefined);
  }, [businessId]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const workflow = await proxied.createWorkflow(businessId, {
        name: name.trim() || TEMPLATES.find((t) => t.id === template)!.label,
        template,
        goal: template === 'general_followup' ? goal.trim() : null,
        defaultLocale: locale,
        callingHours: { startHour, endHour },
      });
      router.push(`/business/${businessId}/workflows/${workflow.id}/run`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the workflow.');
      setBusy(false);
    }
  }

  return (
    <div className="task-body">
      <header className="page-header">
        <h1 className="page-title">New workflow</h1>
        <p className="page-subtitle">Pick what CALL-E should do. You can pause or rename it any time.</p>
      </header>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      <section className="card">
        <div className="field">
          <label htmlFor="nw-name">Workflow name</label>
          <input id="nw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={TEMPLATES.find((t) => t.id === template)!.label} />
        </div>
        <div className="field">
          <label>Template</label>
          {TEMPLATES.map((choice) => (
            <label key={choice.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', cursor: 'pointer' }}>
              <input type="radio" name="template" checked={template === choice.id} onChange={() => setTemplate(choice.id)} />
              <span>
                <span className="business-result-line">{choice.label}</span>
                <span className="business-result-meta" style={{ display: 'block' }}>{choice.description}</span>
              </span>
            </label>
          ))}
        </div>

        {template === 'general_followup' ? (
          <div className="field">
            <label htmlFor="nw-goal">What should the call achieve?</label>
            <textarea id="nw-goal" rows={3} maxLength={1000} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="field">
            <label htmlFor="nw-locale">Call language</label>
            <input id="nw-locale" value={locale} onChange={(e) => setLocale(e.target.value)} maxLength={20} />
          </div>
          <div className="field">
            <label htmlFor="nw-start">Calls allowed from</label>
            <select id="nw-start" value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${h}:00`}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="nw-end">Calls allowed until</label>
            <select id="nw-end" value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h + 1} value={h + 1}>{`${h + 1}:00`}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="button-row">
          <button className="button" data-variant="primary" disabled={busy || (template === 'general_followup' && goal.trim().length < 3)} onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create workflow'}
          </button>
        </div>
      </section>
    </div>
  );
}
