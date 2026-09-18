import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { useHazard } from '../../state/hazard'
import { fmtTime } from '../../lib/utils'
import type { CorrespondenceDraft, IncidentDocument } from '../../types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'

/**
 * The paperwork a case produces: ICS forms and message drafts, all written by the operator agents
 * from the record, none of them sent or signed by software.
 *
 * The after-call pipeline writes the ICS-214 activity log on its own the moment a call has been
 * understood, so this usually has something in it before anyone opens the card. The buttons are for
 * the rest: a general message to the fire department, a call script for an agency, an update for
 * family. Each lands here live — the stream says `document.generated` / `correspondence.drafted`
 * and this re-reads — rather than on the next page load.
 */
export function Paperwork({
  incidentId,
  agencyWaiting,
  operatorName,
}: {
  incidentId: string
  agencyWaiting: boolean
  operatorName: string
}) {
  const { stream } = useHazard()
  const [docs, setDocs] = useState<IncidentDocument[]>([])
  const [drafts, setDrafts] = useState<CorrespondenceDraft[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Bumps whenever the stream reports new paperwork for THIS case, so the lists re-read themselves.
  const revision = useMemo(
    () =>
      stream.events.filter((e) => {
        if (!['document.generated', 'correspondence.drafted', 'aftercall.finished'].includes(e.type)) return false
        const p = (e.payload ?? {}) as Record<string, unknown>
        return p.incident_id === incidentId
      }).length,
    [stream.events, incidentId],
  )

  const load = useCallback(async () => {
    try {
      const [d, m] = await Promise.all([
        api.documents({ incident_id: incidentId }),
        api.correspondence({ incident_id: incidentId }),
      ])
      setDocs(d)
      setDrafts(m)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [incidentId])

  useEffect(() => {
    void load()
  }, [load, revision])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const writing = (key: string) => busy === key

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" disabled={!!busy}
          onClick={() => void run('214', () => api.generateDocument({ form: 'ICS-214', incident_id: incidentId, prepared_by: operatorName }))}>
          {writing('214') ? 'Writing ICS-214…' : 'Write ICS-214 log'}
        </Button>
        <Button size="sm" variant="secondary" disabled={!!busy}
          onClick={() => void run('213', () => api.generateDocument({ form: 'ICS-213', incident_id: incidentId, prepared_by: operatorName }))}>
          {writing('213') ? 'Writing ICS-213…' : 'Write ICS-213 message'}
        </Button>
        {agencyWaiting ? (
          <Button size="sm" variant="secondary" disabled={!!busy}
            onClick={() => void run('agency', () => api.draftCorrespondence({ kind: 'agency', incident_id: incidentId }))}>
            {writing('agency') ? 'Drafting…' : 'Draft agency call script'}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" disabled={!!busy}
          onClick={() => void run('family', () => api.draftCorrespondence({ kind: 'family', incident_id: incidentId }))}>
          {writing('family') ? 'Drafting…' : 'Draft family update'}
        </Button>
      </div>
      {busy ? (
        <p className="text-12 text-faint">An operator agent is writing this from the record — a few seconds.</p>
      ) : null}
      {error ? <p className="text-12 text-rejected">{error}</p> : null}

      {docs.length === 0 && drafts.length === 0 && !busy ? (
        <p className="text-12 text-muted">Nothing written yet. The activity log is written automatically once the call is understood.</p>
      ) : null}

      {docs.map((d) => (
        <article key={d.id} className="rounded border border-border bg-surface">
          <button type="button" onClick={() => setOpen(open === d.id ? null : d.id)}
            className="flex w-full flex-wrap items-baseline gap-x-2 px-2.5 py-2 text-left hover:bg-active">
            <Badge tone="neutral" size="sm">{d.form}</Badge>
            <span className="text-13 font-semibold text-text">{d.title || d.form}</span>
            <span className="font-mono text-11 text-faint">{d.generated_by} · {fmtTime(d.created_at)}</span>
            <span className="ml-auto">
              {d.approved ? <Badge tone="verified" size="sm">signed · {d.approved_by}</Badge> : <Badge tone="neutral" size="sm">unsigned</Badge>}
            </span>
          </button>
          {open === d.id ? (
            <div className="border-t border-divider px-2.5 py-2">
              <pre className="whitespace-pre-wrap font-sans text-12 leading-relaxed text-text">{d.body}</pre>
              {!d.approved ? (
                <Button size="sm" variant="secondary" className="mt-2" disabled={!!busy || !operatorName}
                  onClick={() => void run(`sign-${d.id}`, () => api.approveDocument(d.id, operatorName))}>
                  Sign as {operatorName || 'the person on shift'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}

      {drafts.map((m) => (
        <article key={m.id} className="rounded border border-border bg-surface">
          <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)}
            className="flex w-full flex-wrap items-baseline gap-x-2 px-2.5 py-2 text-left hover:bg-active">
            <Badge tone="neutral" size="sm">{m.channel}</Badge>
            <span className="text-13 font-semibold text-text">{m.subject || `To ${m.to_name || 'recipient'}`}</span>
            <span className="font-mono text-11 text-faint">{m.drafted_by} · {fmtTime(m.created_at)}</span>
            <span className="ml-auto"><Badge tone="neutral" size="sm">draft · not sent</Badge></span>
          </button>
          {open === m.id ? (
            <div className="border-t border-divider px-2.5 py-2">
              {m.to_name ? <p className="text-12 text-muted">To {m.to_name}</p> : null}
              <pre className="mt-1 whitespace-pre-wrap font-sans text-12 leading-relaxed text-text">{m.body}</pre>
              {m.status_note ? <p className="mt-1 text-11 text-faint">{m.status_note}</p> : null}
              {!m.approved ? (
                <Button size="sm" variant="secondary" className="mt-2" disabled={!!busy || !operatorName}
                  onClick={() => void run(`ok-${m.id}`, () => api.approveCorrespondence(m.id, operatorName))}>
                  Approve as {operatorName || 'the person on shift'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}
