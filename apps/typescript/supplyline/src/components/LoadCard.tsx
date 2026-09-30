'use client';

import { Load } from '@/lib/types';
import { useStore } from '@/lib/store';
import { callCarriersForQuotes } from '@/app/actions';
import { Phone } from 'lucide-react';

interface LoadCardProps {
  load: Load;
}

export default function LoadCard({ load }: LoadCardProps) {
  const { state, startSourcing, addQuotes, setError } = useStore();

  const handleSourceCarriers = async () => {
    startSourcing();

    try {
      const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);
      if (!activeLoad) {
        throw new Error('No active load found');
      }

      const quotes = await callCarriersForQuotes(activeLoad.id);
      addQuotes(quotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to source carriers');
    }
  };

  const isSourcing = state.isSourcing && state.activeLoadId === load.id;
  const isActive = load.status !== 'uncovered' && load.status !== 'booked';

  // Compute best rate from round 1 quotes for this load
  const loadQuotes = state.quotes.filter((q) => q.loadId === load.id && q.round === 1);
  const validQuotes = loadQuotes.filter((q) => q.quotedRate !== null);
  const bestRate = validQuotes.length > 0
    ? Math.min(...validQuotes.map((q) => q.quotedRate!))
    : null;

  // Compute average rate for delta display
  const avgRate = validQuotes.length > 1
    ? validQuotes.reduce((sum, q) => sum + q.quotedRate!, 0) / validQuotes.length
    : null;

  const deltaVsAvg = bestRate !== null && avgRate !== null
    ? Math.round(avgRate - bestRate)
    : null;

  return (
    <div className="relative rounded-xl border border-surface-border bg-surface-card p-6 shadow-sm">
      {/* Brand accent bar on left edge */}
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl bg-brand" />

      {/* LIVE LOAD badge */}
      {isActive && (
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-success">
          <span className="h-1 w-1 rounded-full bg-success" />
          LIVE LOAD
        </div>
      )}

      {/* Route + Best Rate row */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Route */}
          <h3 className="text-2xl font-bold text-ink">
            {load.origin} → {load.destination}
          </h3>

          {/* Meta line */}
          <p className="mt-1 text-sm text-ink-muted">
            {load.equipmentType} • {load.weight.toLocaleString()} lbs • Pickup: {load.pickupDate}
          </p>
        </div>

        {/* Best Rate panel */}
        {validQuotes.length > 0 && (
          <div className="flex shrink-0 flex-col items-end">
            <span className="text-xs font-medium text-ink-subtle">Best Rate (so far)</span>
            {bestRate !== null ? (
              <>
                <span className="mt-1 text-3xl font-bold text-brand">
                  ${bestRate.toLocaleString()}
                </span>
                {deltaVsAvg !== null && deltaVsAvg > 0 && (
                  <span className="mt-0.5 text-sm font-medium text-success">
                    ↓ ${deltaVsAvg.toLocaleString()} vs avg
                  </span>
                )}
              </>
            ) : (
              <span className="mt-1 text-3xl font-bold text-ink-subtle">—</span>
            )}
          </div>
        )}
      </div>

      {/* Source Carriers button */}
      <div className="mt-5 flex items-center gap-4">
        <button
          onClick={handleSourceCarriers}
          disabled={isSourcing || load.status !== 'uncovered'}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            isSourcing || load.status !== 'uncovered'
              ? 'cursor-not-allowed border border-surface-border bg-surface-page text-ink-subtle'
              : 'border border-brand text-brand hover:bg-brand-light'
          }`}
        >
          <Phone size={16} />
          {isSourcing ? 'Sourcing...' : 'Source Carriers'}
        </button>

        {state.error && state.activeLoadId === load.id && (
          <p className="text-sm text-red-600">{state.error}</p>
        )}
      </div>
    </div>
  );
}
