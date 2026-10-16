'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { proxied, ApiError } from '@/lib/api';
import type { BusinessContactDto, WorkflowDto } from '@dial/schemas';
import { ContextFields, missingRequired, type ContextField } from './context-fields';
import { ImportContacts } from './import-contacts';

/**
 * The business's customer list: add, edit, search, opt out, and start a run
 * for selected contacts. The browser never places provider calls -- running
 * creates one server-side run and durable jobs.
 */

export function ContactsManager({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [contacts, setContacts] = useState<BusinessContactDto[] | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowDto[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runWorkflowId, setRunWorkflowId] = useState('');
  const [runContext, setRunContext] = useState<Record<string, string>>({});
  const [templates, setTemplates] = useState<Array<{ id: string; contextFields: ContextField[] }>>([]);
  const [runWhen, setRunWhen] = useState('');
  const [runBusy, setRunBusy] = useState(false);

  const load = useCallback(() => {
    proxied
      .listBusinessContacts(businessId, query.trim() || undefined)
      .then((r) => setContacts(r.contacts))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load contacts.'),
      );
  }, [businessId, query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    proxied
      .listWorkflows(businessId)
      .then((r) => {
        const runnable = r.workflows.filter((w) => w.enabled && w.direction === 'outbound');
        setWorkflows(runnable);
        setTemplates(r.templates);
        if (runnable[0]) setRunWorkflowId((prev) => prev || runnable[0]!.id);
      })
      .catch(() => undefined);
  }, [businessId]);

  async function addContact() {
    setError(null);
    try {
      await proxied.createBusinessContact(businessId, { name: name.trim(), phone: phone.trim() });
      setName('');
      setPhone('');
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that contact.');
    }
  }

  async function toggleOptOut(contact: BusinessContactDto) {
    try {
      await proxied.updateBusinessContact(businessId, contact.id, { doNotCall: !contact.doNotCall });
      load();
    } catch {
      setError('Could not update that contact.');
    }
  }

  async function remove(contact: BusinessContactDto) {
    if (!window.confirm(`Delete ${contact.name}?`)) return;
    try {
      await proxied.deleteBusinessContact(businessId, contact.id);
      load();
    } catch {
      setError('Could not delete that contact.');
    }
  }

  async function startRun(runNow: boolean) {
    if (!runWorkflowId || selected.size === 0) return;
    setRunBusy(true);
    setError(null);
    try {
      await proxied.createRun(businessId, runWorkflowId, {
        contactIds: [...selected],
        scheduledAt: runNow ? null : runWhen ? new Date(runWhen).toISOString() : null,
        context: runContext,
      });
      setSelected(new Set());
      router.push(`/business/${businessId}/runs`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the run.');
    } finally {
      setRunBusy(false);
    }
  }

  const runWorkflow = workflows.find((w) => w.id === runWorkflowId) ?? null;
  const runFields = templates.find((t) => t.id === runWorkflow?.template)?.contextFields ?? [];
  const runBlocking = missingRequired(runFields, runContext);

  return (
    <>
      <div className="business-toolbar">
        <div>
          <h2 className="business-toolbar-title">Contacts</h2>
          <p className="business-toolbar-sub">The customers Dial can call for you.</p>
        </div>
      </div>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {/*
        Placed above the single-contact form: somebody arriving with a list of
        four hundred customers should not have to scroll past a form for
        adding one.
      */}
      <ImportContacts businessId={businessId} onImported={load} />

      <section className="card">
        <div className="card-label">Add a customer</div>
        <div className="field-row" style={{ alignItems: 'end' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-name">Name</label>
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-phone">Phone</label>
            <input id="c-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+353…" />
          </div>
          <button className="button" disabled={!name.trim() || !phone.trim()} onClick={() => void addContact()}>
            Add
          </button>
        </div>
      </section>

      {selected.size > 0 && workflows.length > 0 ? (
        <section className="card">
          <div className="card-label">
            Run a workflow for {selected.size} contact{selected.size === 1 ? '' : 's'}
          </div>

          <div className="field">
            <label htmlFor="r-workflow">Workflow</label>
            <select
              id="r-workflow"
              value={runWorkflowId}
              onChange={(e) => {
                setRunWorkflowId(e.target.value);
                // Each template asks for different details; carrying the old
                // answers across would attach them to fields that never
                // requested them.
                setRunContext({});
              }}
            >
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {/*
            The template's own fields, rather than one box posted into
            whichever field happened to be listed first.
          */}
          <ContextFields
            fields={runFields}
            values={runContext}
            onChange={(id, value) => setRunContext((prev) => ({ ...prev, [id]: value }))}
            idPrefix="qr"
          />

          {/*
            Two different times sit on this panel: when the appointment is,
            and when Dial should ring. They were labelled "Context" and
            "Schedule", which said nothing about the difference.
          */}
          <div className="field">
            <label htmlFor="r-when">When should Dial call?</label>
            <input
              id="r-when"
              type="datetime-local"
              value={runWhen}
              onChange={(e) => setRunWhen(e.target.value)}
            />
            <p className="field-hint">Leave empty to start calling straight away.</p>
          </div>

          {runBlocking.length > 0 ? (
            <p className="field-hint" role="status">
              Fill in {runBlocking.map((f) => f.label.toLowerCase()).join(' and ')} first.
            </p>
          ) : null}

          <div className="button-row">
            <button
              className="button"
              data-variant="primary"
              disabled={runBusy || runBlocking.length > 0}
              onClick={() => void startRun(true)}
            >
              {runBusy ? 'Starting…' : 'Call now'}
            </button>
            <button
              className="button"
              disabled={runBusy || !runWhen || runBlocking.length > 0}
              onClick={() => void startRun(false)}
            >
              Schedule
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="card-label">Contacts</div>
        <div className="field">
          <label htmlFor="c-search">Search</label>
          <input id="c-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, phone, email…" />
        </div>

        {contacts === null ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
        ) : contacts.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>Nobody here yet.</p>
        ) : (
          contacts.map((contact) => {
            const isSelected = selected.has(contact.id);
            return (
              <div key={contact.id} className="business-result-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
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
                  <div>
                    <div className="business-result-line">
                      {contact.name}
                      {contact.doNotCall || contact.optedOutAt ? (
                        <span className="business-chip" style={{ marginLeft: 8 }}>
                          opted out
                        </span>
                      ) : null}
                    </div>
                    <div className="business-result-meta">
                      {contact.phoneE164}
                      {contact.email ? ` · ${contact.email}` : ''}
                    </div>
                  </div>
                </label>
                <div className="button-row" style={{ margin: 0 }}>
                  <button className="button" onClick={() => void toggleOptOut(contact)}>
                    {contact.doNotCall || contact.optedOutAt ? 'Allow calls' : 'Opt out'}
                  </button>
                  <button className="button" data-variant="danger" onClick={() => void remove(contact)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
