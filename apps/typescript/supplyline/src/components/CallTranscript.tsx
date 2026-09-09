'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Truck, ChevronDown } from 'lucide-react';

// Carrier avatar color palette
const CARRIER_COLORS = [
  { bg: '#EDE0FC', icon: '#2A1264' }, // Purple
  { bg: '#DFF5E8', icon: '#1D954A' }, // Green
  { bg: '#FDECC8', icon: '#92400E' }, // Amber
  { bg: '#DCE9FE', icon: '#1E40AF' }, // Blue
] as const;

function getCarrierColor(carrierId: string, carriers: { id: string }[]): number {
  const idx = carriers.findIndex((c) => c.id === carrierId);
  return idx >= 0 ? idx % CARRIER_COLORS.length : 0;
}

function getRoundBadgeClass(round: number): string {
  if (round === 1) {
    return 'bg-brand-light text-brand';
  }
  return 'bg-amber-100 text-amber-800';
}

export default function CallTranscript() {
  const { state } = useStore();
  const [selectedCarrier, setSelectedCarrier] = useState<string>('all');
  const [filterOpen, setFilterOpen] = useState(false);

  const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);
  const loadQuotes = activeLoad
    ? state.quotes
        .filter((q) => q.loadId === activeLoad.id)
        .sort((a, b) => a.round - b.round)
    : [];

  if (loadQuotes.length === 0) {
    return null;
  }

  // Filter by selected carrier
  const filteredQuotes =
    selectedCarrier === 'all'
      ? loadQuotes
      : loadQuotes.filter((q) => q.carrierId === selectedCarrier);

  // Get unique carriers from quotes
  const uniqueCarrierIds = [...new Set(loadQuotes.map((q) => q.carrierId))];
  const carrierList = uniqueCarrierIds
    .map((id) => state.carriers.find((c) => c.id === id))
    .filter(Boolean) as { id: string; name: string }[];

  const selectedCarrierName =
    selectedCarrier === 'all'
      ? 'All Carriers'
      : state.carriers.find((c) => c.id === selectedCarrier)?.name ?? 'All Carriers';

  return (
    <div className="mt-6 rounded-xl border border-surface-border bg-surface-card p-6 shadow-sm">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-bold text-ink">Call Transcripts</h3>

        {/* Carrier filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className="flex items-center gap-2 rounded-lg border border-surface-border px-3 py-2 text-sm text-ink transition-colors hover:bg-surface-page"
          >
            {selectedCarrierName}
            <ChevronDown size={16} className="text-ink-subtle" />
          </button>

          {filterOpen && (
            <>
              {/* Backdrop to close dropdown */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setFilterOpen(false)}
              />
              {/* Dropdown menu */}
              <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-surface-border bg-surface-card py-1 shadow-lg">
                <button
                  onClick={() => {
                    setSelectedCarrier('all');
                    setFilterOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-page ${
                    selectedCarrier === 'all' ? 'font-medium text-brand' : 'text-ink'
                  }`}
                >
                  All Carriers
                </button>
                {carrierList.map((carrier) => (
                  <button
                    key={carrier.id}
                    onClick={() => {
                      setSelectedCarrier(carrier.id);
                      setFilterOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-surface-page ${
                      selectedCarrier === carrier.id ? 'font-medium text-brand' : 'text-ink'
                    }`}
                  >
                    {carrier.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transcript list */}
      <div className="space-y-3">
        {filteredQuotes.map((quote) => {
          const carrier = state.carriers.find((c) => c.id === quote.carrierId);
          const colorIdx = getCarrierColor(quote.carrierId, state.carriers);
          const colors = CARRIER_COLORS[colorIdx];

          return (
            <div
              key={quote.id}
              className="rounded-lg border border-surface-border bg-surface-page p-4"
            >
              {/* Row header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Avatar icon */}
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <Truck size={18} style={{ color: colors.icon }} />
                  </div>

                  {/* Carrier name */}
                  <span className="text-sm font-semibold text-ink">
                    {carrier?.name}
                  </span>

                  {/* Round badge */}
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getRoundBadgeClass(
                      quote.round
                    )}`}
                  >
                    Round {quote.round}
                  </span>
                </div>

                {/* Timestamp */}
                <span className="text-sm text-ink-subtle">
                  {new Date(quote.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Transcript section */}
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Transcript
                </p>
                <div className="mt-1 rounded-md bg-surface-card p-3 text-sm italic text-ink-muted">
                  &ldquo;{quote.transcript || 'No transcript available.'}&rdquo;
                </div>
              </div>

              {/* Evidence section (when available) */}
              {quote.evidence && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Evidence
                  </p>
                  <p className="mt-1 text-sm text-ink">{quote.evidence}</p>
                </div>
              )}

              {/* Bottom meta row */}
              <div className="mt-3 flex items-center gap-4 text-sm text-ink-subtle">
                <span>
                  Available:{' '}
                  <span className="font-medium text-ink">{quote.available}</span>
                </span>
                <span>
                  Pickup:{' '}
                  <span className="font-medium text-ink">{quote.pickupConfirmed}</span>
                </span>
                {quote.quotedRate !== null && (
                  <span>
                    Rate:{' '}
                    <span className="font-medium text-ink">
                      ${quote.quotedRate.toLocaleString()}
                    </span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
