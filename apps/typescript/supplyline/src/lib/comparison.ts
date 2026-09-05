import { Quote } from './types';

export const NEGOTIATION_THRESHOLD = 50; // Minimum dollar gap to bother negotiating

export interface ComparisonResult {
  lowestQuote: Quote;
  highestQuote: Quote;
  gap: number;
  shouldNegotiate: boolean;
  negotiationTarget: Quote | null; // The higher-quoted carrier to call back
}

/**
 * Compares round 1 quotes deterministically.
 * Returns who to negotiate with and whether the gap justifies it.
 */
export function compareRound1Quotes(quotes: Quote[]): ComparisonResult {
  if (quotes.length < 2) {
    throw new Error('Need at least 2 quotes to compare');
  }

  const validQuotes = quotes.filter((q) => q.quotedRate !== null);
  if (validQuotes.length < 2) {
    throw new Error('Need at least 2 valid quoted rates to compare');
  }

  const sorted = [...validQuotes].sort((a, b) => (a.quotedRate! - b.quotedRate!));
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];

  const gap = highest.quotedRate! - lowest.quotedRate!;
  const shouldNegotiate = gap > NEGOTIATION_THRESHOLD;

  return {
    lowestQuote: lowest,
    highestQuote: highest,
    gap,
    shouldNegotiate,
    negotiationTarget: shouldNegotiate ? highest : null,
  };
}

export interface FinalResult {
  winner: Quote;
  runnerUp: Quote;
  savingsVsOriginal: number;
  savingsVsNextBest: number;
  wasNegotiated: boolean;
}

/**
 * Compares the negotiated round-2 result against round-1 quotes.
 * Returns the actual best final rate and savings calculations.
 */
export function determineFinalWinner(
  round1Quotes: Quote[],
  round2Quote: Quote
): FinalResult {
  const validR1 = round1Quotes.filter((q) => q.quotedRate !== null);
  const allQuotes = [...validR1, round2Quote].filter((q) => q.quotedRate !== null);

  const sorted = [...allQuotes].sort((a, b) => (a.quotedRate! - b.quotedRate!));
  const winner = sorted[0];
  const runnerUp = sorted[1];

  const originalHighQuote = round1Quotes.find((q) => q.carrierId === round2Quote.carrierId);
  const savingsVsOriginal = originalHighQuote?.quotedRate
    ? originalHighQuote.quotedRate - winner.quotedRate!
    : 0;

  const savingsVsNextBest = runnerUp?.quotedRate
    ? runnerUp.quotedRate - winner.quotedRate!
    : 0;

  return {
    winner,
    runnerUp,
    savingsVsOriginal,
    savingsVsNextBest,
    wasNegotiated: winner.round === 2,
  };
}
