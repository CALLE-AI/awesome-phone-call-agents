'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessContactDto, WorkflowDto } from '@dial/schemas';
import { ContextFields, missingRequired, type ContextField } from './context-fields';

/**
 * Run a workflow: pick recipients, give the call its context (an appointment
 * time, a service), and either call now or schedule. The server creates one
 * run and durable jobs; the browser never talks to CALL-E.
 */

export function RunWorkflow({ businessId, workflowId }: { businessId: string; workflowId: string }) {
  const router = useRouter();
  const [workflow, setWorkflow] = useState<WorkflowDto | null>(null);
  const [contextFields, setContextFields] = useState<ContextField[]>([]);
  const [contacts, setContacts] = useState<BusinessContactDto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [context, setContext] = useState<Record<string, string>>({});
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    proxied
      .listWorkflows(businessId)
      .then((r) => {
        const found = r.workflows.find((w) => w.id === workflowId) ?? null;
        setWorkflow(found);
        const template = r.templates.find((t) => t.id === found?.template);
        setContextFields(template?.contextFields ?? []);
      })
      .catch(() => setError('Could not load that workflow.'));
    proxied
      .listBusinessContacts(businessId)
      .then((r) => setContacts(r.contacts))
      .catch(() => setError('Could not load contacts.'));
  }, [businessId, workflowId]);

  async function start(runNow: boolean) {
    if (!workflow || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await proxied.createRun(businessId, workflow.id, {
        contactIds: [...selected],
        scheduledAt: runNow || !when ? null : new Date(when).toISOString(),
        context,
      });
      router.push(`/business/${businessId}/runs`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the run.');
      setBusy(false);
    }
  }

  const blocking = missingRequired(contextFields, context);

  return (
    <div className="task-body">
      <header className="page-header">
        <h1 className="page-title">Run: {workflow?.name ?? '…'}</h1>
        <p className="page-subtitle">
          {workflow
            ? `${workflow.templateLabel} · speaks ${workflow.defaultLocale} · calls ${workflow.callingHours.startHour}:00–${workflow.callingHours.endHour}:00 local time`
            : ''}
        </p>
      </header>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {contextFields.length > 0 ? (
        <section className="card">
          <div className="card-label">What the call is about</div>
          <p className="field-hint" style={{ marginBottom: 'var(--space-lg)' }}>
            Details Dial mentions on the call — not when the call is placed.
          </p>
          <ContextFields
            fields={contextFields}
            values={context}
            onChange={(id, value) => setContext((prev) => ({ ...prev, [id]: value }))}
            idPrefix="ctx"
          />
        </section>
      ) : null}

      <section className="card">
        <div className="card-label">Recipients</div>
        {contacts === null ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : contacts.length === 0 ? (
          <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
            No contacts yet — add customers under the Contacts tab first.
          </p>
        ) : (
          contacts.map((contact) => {
            const optedOut = contact.doNotCall || Boolean(contact.optedOutAt);
            const isSelected = selected.has(contact.id);
            return (
              <label key={contact.id} className="business-result-row" style={{ cursor: optedOut ? 'not-allowed' : 'pointer' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    disabled={optedOut}
                    checked={isSelected}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(contact.id)) next.delete(contact.id);
                        else next.add(contact.id);
                        return next;
                      })
                    }
                  />
                  <span>
                    <span className="business-result-line">{contact.name}</span>
                    <span className="business-result-meta"> {contact.phoneE164}</span>
                    {optedOut ? (
                      <span className="business-chip" style={{ marginLeft: 8 }}>
                        opted out
                      </span>
                    ) : null}
                  </span>
                </span>
              </label>
            );
          })
        )}
      </section>

      <section className="card">
        <div className="card-label">When should Dial call?</div>
        <p className="field-hint" style={{ marginBottom: 'var(--space-lg)' }}>
          Leave this empty to start calling straight away.
        </p>
        <div className="field">
          <label htmlFor="run-when">Start calling at</label>
          <input id="run-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        {/*
          Saying what is missing beats disabling a button silently, and beats
          letting the server reject the run after the click.
        */}
        {blocking.length > 0 ? (
          <p className="field-hint" role="status">
            Fill in {blocking.map((f) => f.label.toLowerCase()).join(' and ')} first.
          </p>
        ) : null}
        <div className="button-row">
          <button
            className="button"
            data-variant="primary"
            disabled={busy || selected.size === 0 || blocking.length > 0}
            onClick={() => void start(true)}
          >
            {busy ? 'Starting…' : `Call now (${selected.size})`}
          </button>
          <button
            className="button"
            disabled={busy || selected.size === 0 || !when || blocking.length > 0}
            onClick={() => void start(false)}
          >
            Schedule
          </button>
        </div>
      </section>
    </div>
  );
}
