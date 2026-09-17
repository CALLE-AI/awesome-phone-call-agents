import { Pill } from './Pill'
import { AlertIcon, BoltIcon } from './Icons'
import { factLabel, factValue, fmtWallTime } from '../lib/utils'
import { sweepIsRunning, sweepLabel, sweepTone } from '../lib/status'
import type { Hazard, StreamState } from '../types'

const SEVERITY_TONE: Record<string, 'rejected' | 'partial' | 'accent' | 'grey'> = {
  emergency: 'rejected',
  extreme: 'rejected',
  warning: 'partial',
  watch: 'accent',
  advisory: 'accent',
}

/**
 * The hazard, its facts, and the button that starts the calling.
 *
 * `profile.describe()` is the backend's own one-line reading of the hazard, and the chips below it
 * are the raw numbers that produced it. Both are shown: the sentence is what a tired volunteer
 * reads, the numbers are what she checks it against.
 */
export function HazardHeader({
  hazard,
  hazards,
  stream,
  onSelect,
  onStart,
  starting,
  callsDone,
}: {
  hazard: Hazard
  hazards: Hazard[]
  stream: StreamState
  onSelect: (id: string) => void
  onStart: () => void
  starting: boolean
  callsDone: number
}) {
  const running = sweepIsRunning(stream.sweepState) && !!stream.sweepState
  const queued = stream.queued
  const facts = Object.entries(hazard.facts ?? {})
  const chips = facts.filter(([, v]) => typeof v !== 'string' || v.length <= 28)
  const notes = facts.filter(([, v]) => typeof v === 'string' && v.length > 28)
  const severityTone = SEVERITY_TONE[hazard.severity?.toLowerCase()] ?? 'partial'

  return (
    <section className="card mb-4 overflow-hidden">
      {hazards.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-divider bg-strip px-2 py-1.5">
          {hazards.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => onSelect(h.id)}
              className={
                h.id === hazard.id
                  ? 'shrink-0 rounded bg-surface px-2.5 py-1.5 text-12 font-medium text-text shadow-sm'
                  : 'shrink-0 rounded px-2.5 py-1.5 text-12 text-muted hover:text-text'
              }
            >
              {h.headline}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 py-3.5">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <span className="mt-0.5 shrink-0 text-rejected">
            {hazard.profile?.cuts_power ? <BoltIcon size={20} /> : <AlertIcon size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-22 font-semibold leading-tight tracking-tight text-text">{hazard.headline}</h1>
            <p className="mt-1 text-13 leading-snug text-muted">{hazard.profile?.describe}</p>
          </div>
          <Pill tone={severityTone}>{hazard.severity}</Pill>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map(([k, v]) => (
            <span key={k} className="chip">
              <span className="text-faint">{factLabel(k)}</span>
              <span className="font-medium text-text">{factValue(k, v)}</span>
            </span>
          ))}
        </div>
        {notes.map(([k, v]) => (
          <p key={k} className="mt-2 text-12 leading-snug text-muted">
            {String(v)}
          </p>
        ))}

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-11 text-faint">
          {hazard.source && <span>Source: {hazard.source}</span>}
          {hazard.starts_at && (
            <span>
              {fmtWallTime(hazard.starts_at)}
              {hazard.ends_at ? ` – ${fmtWallTime(hazard.ends_at)}` : ''}
            </span>
          )}
          <span>Declared by {hazard.declared_by}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-divider bg-strip px-4 py-3">
        {stream.sweepState ? (
          <>
            <Pill tone={sweepTone(stream.sweepState)}>{sweepLabel(stream.sweepState)}</Pill>
            <div className="flex min-w-[140px] flex-1 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-edge">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: queued ? `${Math.min(100, Math.round((callsDone / queued) * 100))}%` : '0%' }}
                />
              </div>
              <span className="shrink-0 font-mono text-11 text-muted">
                {callsDone}/{queued || '—'} called
              </span>
            </div>
            {!running && (
              <button type="button" className="btn-secondary" onClick={onStart} disabled={starting}>
                Sweep again
              </button>
            )}
          </>
        ) : (
          <>
            <span className="flex-1 text-12 text-muted">
              Nobody has been called about this yet. Starting a sweep rings every neighbour who opted in.
            </span>
            <button type="button" className="btn-primary" onClick={onStart} disabled={starting}>
              {starting ? 'Starting…' : 'Start calling'}
            </button>
          </>
        )}
      </div>

      {stream.sweepError && (
        <p className="border-t border-rejected/20 bg-rejected-tint px-4 py-2 text-12 text-rejected">{stream.sweepError}</p>
      )}
    </section>
  )
}
