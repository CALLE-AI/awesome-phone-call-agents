'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { proxied, ApiError } from '@/lib/api';
import type { WorkflowDto } from '@dial/schemas';

/**
 * Workflows: the reusable phone jobs. Toggling one off stops future runs;
 * deleting it removes its runs with it, exactly like the rest of Dial.
 */

export function WorkflowsManager({ businessId }: { businessId: string }) {
  const [workflows, setWorkflows] = useState<WorkflowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    proxied
      .listWorkflows(businessId)
      .then((r) => setWorkflows(r.workflows))
      .catch((caught) =>
        setError(caught instanceof ApiError ? caught.message : 'Could not load workflows.'),
      );
  }, [businessId]);

  useEffect(load, [load]);

  async function toggle(workflow: WorkflowDto) {
    try {
      await proxied.updateWorkflow(businessId, workflow.id, { enabled: !workflow.enabled });
      load();
    } catch {
      setError('Could not update that workflow.');
    }
  }

  async function remove(workflow: WorkflowDto) {
    if (!window.confirm(`Delete "${workflow.name}" and its run history?`)) return;
    try {
      await proxied.deleteWorkflow(businessId, workflow.id);
      load();
    } catch {
      setError('Could not delete that workflow.');
    }
  }

  return (
    <>
      <div className="business-toolbar">
        <div>
          <h2 className="business-toolbar-title">Workflows</h2>
          <p className="business-toolbar-sub">The phone jobs Dial can run for you.</p>
        </div>
        <Link className="button" data-variant="primary" href={`/business/${businessId}/workflows/new`}>
          New workflow
        </Link>
      </div>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      {workflows === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      ) : workflows.length === 0 ? (
        <section className="card">
          <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
            No workflows yet. Create one to give Dial its first job.
          </p>
        </section>
      ) : (
        workflows.map((workflow) => (
          <section key={workflow.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="business-result-line">
                  {workflow.name}
                  {workflow.enabled ? null : (
                    <span className="business-chip" data-tone="warning" style={{ marginLeft: 8 }}>
                      Paused
                    </span>
                  )}
                </div>
                <div className="business-result-meta">
                  {workflow.templateLabel} · calls {workflow.callingHours.startHour}:00–
                  {workflow.callingHours.endHour}:00
                </div>
              </div>
              <div className="button-row" style={{ margin: 0 }}>
                <Link className="button" href={`/business/${businessId}/workflows/${workflow.id}/run`}>
                  Run
                </Link>
                <button className="button" onClick={() => void toggle(workflow)}>
                  {workflow.enabled ? 'Pause' : 'Enable'}
                </button>
                <button className="button" data-variant="danger" onClick={() => void remove(workflow)}>
                  Delete
                </button>
              </div>
            </div>
          </section>
        ))
      )}
    </>
  );
}
