'use client';

import { useStore } from '@/lib/store';
import { compareRound1Quotes, determineFinalWinner } from '@/lib/comparison';
import { negotiateWithCarrier, generateRecommendationSummary, createBooking } from '@/app/actions';
import { Bell, Plus } from 'lucide-react';
import SupplyLineLogo from './SupplyLineLogo';
import LoadCard from './LoadCard';
import LoadStatusStepper from './LoadStatusStepper';
import BookingConfirmation from './BookingConfirmation';
import CallTranscript from './CallTranscript';

export default function LoadDashboard() {
  const { state, startNegotiation, addNegotiationQuote, setRecommendationSummary, addBooking, resetDemo, setError } = useStore();
  const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);

  const loadQuotes = activeLoad
    ? state.quotes.filter((q) => q.loadId === activeLoad.id)
    : [];

  const round1Quotes = loadQuotes.filter((q) => q.round === 1);
  const round2Quotes = loadQuotes.filter((q) => q.round === 2);

  const handleNegotiate = async () => {
    startNegotiation();

    try {
      const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);
      if (!activeLoad) throw new Error('No active load');

      const comparison = compareRound1Quotes(round1Quotes);
      if (!comparison.shouldNegotiate || !comparison.negotiationTarget) {
        throw new Error('No negotiation target — gap too small');
      }

      const quote = await negotiateWithCarrier(
        activeLoad.id,
        comparison.negotiationTarget.carrierId,
        comparison.lowestQuote.quotedRate!
      );

      addNegotiationQuote(quote);

      const finalResult = determineFinalWinner(round1Quotes, quote);
      const summary = await generateRecommendationSummary(
        activeLoad.id,
        finalResult.winner.carrierId,
        finalResult.winner.quotedRate!,
        finalResult.runnerUp.carrierId,
        finalResult.runnerUp.quotedRate!,
        finalResult.savingsVsOriginal,
        finalResult.savingsVsNextBest,
        finalResult.wasNegotiated
      );
      setRecommendationSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Negotiation failed');
    }
  };

  const handleBookCarrier = async () => {
    try {
      const activeLoad = state.loads.find((l) => l.id === state.activeLoadId);
      if (!activeLoad) throw new Error('No active load');

      const finalResult = determineFinalWinner(round1Quotes, round2Quotes[0]);

      const booking = await createBooking(
        activeLoad.id,
        finalResult.winner.id,
        finalResult.winner.quotedRate!,
        finalResult.savingsVsOriginal,
        finalResult.savingsVsNextBest
      );

      addBooking(booking);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    }
  };

  const validRound1Quotes = round1Quotes.filter((q) => q.quotedRate !== null);

  const showNegotiateButton =
    validRound1Quotes.length >= 2 &&
    round2Quotes.length === 0 &&
    activeLoad?.status === 'quoted';

  const showFinalComparison = round2Quotes.length > 0 && activeLoad?.status !== 'booked';

  let finalResult = null;
  if (showFinalComparison && round1Quotes.length >= 2) {
    finalResult = determineFinalWinner(round1Quotes, round2Quotes[0]);
  }

  const isBooked = activeLoad?.status === 'booked';

  return (
    <div className="min-h-screen bg-surface-page">
      {/* Header / Top Bar */}
      <header className="border-b border-surface-border bg-surface-card px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <SupplyLineLogo className="h-9 w-9" />
            <div>
              <h1 className="text-lg font-semibold text-ink">SupplyLine</h1>
              <p className="text-xs text-ink-muted">Freight Sourcing Agent</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-page hover:text-ink"
              aria-label="Notifications"
            >
              <Bell size={20} />
            </button>
            <button className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover">
              <Plus size={16} />
              New Load
            </button>
            {isBooked && (
              <button
                onClick={resetDemo}
                className="rounded-lg border border-surface-border bg-surface-card px-4 py-2.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-page hover:text-ink"
              >
                Reset Demo
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Centered content wrapper */}
      <div className="mx-auto w-full max-w-[1300px]">
        {/* Outer row: sidenav + right content */}
        <div className="flex items-start gap-20 p-6">
          {/* Independent left sidenav */}
          <aside className="w-[300px] shrink-0 pt-10">
            <LoadStatusStepper
              status={activeLoad?.status ?? 'uncovered'}
              isSourcing={state.isSourcing && state.activeLoadId === activeLoad?.id}
              currentRound={state.currentRound}
            />
          </aside>

          {/* Right content column */}
          <div className="flex-1 min-w-0">
            <h2 className="mb-6 text-lg font-semibold text-ink">Load Board</h2>

            <div className="space-y-6">
            {activeLoad && <LoadCard load={activeLoad} />}

            {round1Quotes.length > 0 && !isBooked && (
              <div className="rounded-lg border border-surface-border bg-surface-card p-6 shadow-sm">
                <h3 className="mb-4 text-md font-semibold text-ink">Round 1 Quotes</h3>
                <div className="space-y-3">
                  {round1Quotes.map((quote) => {
                    const carrier = state.carriers.find((c) => c.id === quote.carrierId);
                    return (
                      <div
                        key={quote.id}
                        className="flex items-center justify-between rounded-md border border-surface-border bg-surface-page p-4"
                      >
                        <div>
                          <p className="font-medium text-ink">{carrier?.name}</p>
                          <p className="text-sm text-ink-muted">
                            Available: {quote.available} • Pickup: {quote.pickupConfirmed}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-bold text-ink">
                            {quote.quotedRate ? `$${quote.quotedRate.toLocaleString()}` : 'No quote'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {showNegotiateButton && (
                  <button
                    onClick={handleNegotiate}
                    disabled={state.isSourcing}
                    className={`mt-4 rounded-md px-4 py-2 text-sm font-medium ${
                      state.isSourcing
                        ? 'cursor-not-allowed bg-surface-border text-ink-subtle'
                        : 'bg-orange-600 text-white hover:bg-orange-700'
                    }`}
                  >
                    {state.isSourcing ? 'Negotiating...' : 'Negotiate Best Rate'}
                  </button>
                )}

                {round1Quotes.length > 0 && validRound1Quotes.length < 2 && (
                  <p className="mt-4 text-sm text-red-600">
                    Need at least 2 valid quoted rates to compare
                  </p>
                )}
              </div>
            )}

            {showFinalComparison && finalResult && (
              <div className="rounded-lg border-2 border-green-200 bg-success-bg p-6 shadow-sm">
                <h3 className="mb-4 text-md font-semibold text-green-900">Final Recommendation</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink">
                        {state.carriers.find((c) => c.id === finalResult.winner.carrierId)?.name}
                        {finalResult.wasNegotiated && (
                          <span className="ml-2 rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">
                            Negotiated
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {finalResult.wasNegotiated
                          ? 'Rate secured through negotiation'
                          : 'Best original quote'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-green-700">
                        ${finalResult.winner.quotedRate?.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 rounded-md bg-surface-card p-4">
                    <div>
                      <p className="text-xs text-ink-muted">Saved vs original quote</p>
                      <p className="text-lg font-semibold text-success">
                        ${finalResult.savingsVsOriginal.toLocaleString()}
                        {finalResult.savingsVsOriginal > 0 && (
                          <span className="ml-1 text-sm">
                            ({Math.round((finalResult.savingsVsOriginal / (finalResult.winner.quotedRate! + finalResult.savingsVsOriginal)) * 100)}%)
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-muted">Saved vs next best</p>
                      <p className="text-lg font-semibold text-success">
                        ${finalResult.savingsVsNextBest.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {state.recommendationSummary && (
                    <div className="rounded-md border border-brand-light bg-brand-light p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                        AI Recommendation
                      </p>
                      <p className="mt-1 text-sm text-ink">
                        {state.recommendationSummary}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={handleBookCarrier}
                    className="w-full rounded-md bg-success px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Book Carrier
                  </button>
                </div>
              </div>
            )}

            {isBooked && <BookingConfirmation />}
            </div>
          </div>
        </div>

        {/* Call Transcripts — below both columns, same centered wrapper */}
        <div className="px-6">
          {loadQuotes.length > 0 && <CallTranscript />}
        </div>

        {state.error && (
          <div className="mx-6 mt-4 rounded-md bg-red-50 p-4 text-red-700">
            <p className="text-sm font-medium">Error: {state.error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
