'use server';

import { CalleClient } from '@call-e/calle';
import { Quote, Booking } from '@/lib/types';
import { initialLoads, initialCarriers } from '@/lib/data';
import {
  createQuoteTask,
  createNegotiationTask,
  mockCallCarriersForQuotes,
  mockNegotiateWithCarrier,
} from '@/lib/calle';
import { generateSummary } from '@/lib/kimi';
import { taskResultSchema, recipientResultSchema } from '@/schemas/quote-schema';

const calleClient = new CalleClient({
  apiKey: process.env.CALLE_API_KEY || '',
});

const MOCK_CALLS = process.env.MOCK_CALLS !== 'false';

/**
 * Server Action: Round 1 — call all carriers for quotes SEQUENTIALLY.
 * The SDK does NOT support multi-recipient arrays. Loop over carriers individually.
 */
export async function callCarriersForQuotes(loadId: string): Promise<Quote[]> {
  const load = initialLoads.find((l) => l.id === loadId);
  if (!load) throw new Error(`Load ${loadId} not found`);

  const carriers = initialCarriers;

  if (MOCK_CALLS) {
    return mockCallCarriersForQuotes(load, carriers);
  }

  const quotes: Quote[] = [];
  const now = new Date().toISOString();

  // SEQUENTIAL individual calls — SDK only supports single recipient
  for (const carrier of carriers) {
    const task = createQuoteTask(load);

    try {
      const response = await calleClient.calls.createAndWait({
        task,
        recipient: {
          phones: [carrier.phoneNumber], // SDK uses `phones` array, not `phoneNumber`
        },
        resultSchema: taskResultSchema,
        recipientResultSchema: recipientResultSchema,
      });

      const recipientResult = response.recipients?.[0];

      if (recipientResult?.structuredResult) {
        const sr = recipientResult.structuredResult;
        quotes.push({
          id: `quote-${load.id}-${carrier.id}-r1`,
          loadId: load.id,
          carrierId: carrier.id,
          round: 1,
          available: (['yes', 'no', 'unknown'].includes(sr.available as string) ? (sr.available as 'yes' | 'no' | 'unknown') : 'unknown'),
          quotedRate: typeof sr.quoted_rate === 'number' ? sr.quoted_rate : null,
          pickupConfirmed: (['yes', 'no', 'unknown'].includes(sr.pickup_confirmed as string) ? (sr.pickup_confirmed as 'yes' | 'no' | 'unknown') : 'unknown'),
          evidence: (sr.evidence as string) || '',
          transcript: recipientResult.summary || '',
          timestamp: now,
        });
      } else {
        quotes.push({
          id: `quote-${load.id}-${carrier.id}-r1`,
          loadId: load.id,
          carrierId: carrier.id,
          round: 1,
          available: 'unknown',
          quotedRate: null,
          pickupConfirmed: 'unknown',
          evidence: 'No structured result returned from call.',
          transcript: recipientResult?.summary || '',
          timestamp: now,
        });
      }
    } catch (err) {
      console.error(`CALL-E error for ${carrier.name}:`, err);
      quotes.push({
        id: `quote-${load.id}-${carrier.id}-r1`,
        loadId: load.id,
        carrierId: carrier.id,
        round: 1,
        available: 'unknown',
        quotedRate: null,
        pickupConfirmed: 'unknown',
        evidence: `Call failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        transcript: '',
        timestamp: now,
      });
    }
  }

  return quotes;
}

/**
 * Server Action: Round 2 — call the higher-quoted carrier back to negotiate.
 */
export async function negotiateWithCarrier(
  loadId: string,
  carrierId: string,
  competingRate: number
): Promise<Quote> {
  const load = initialLoads.find((l) => l.id === loadId);
  if (!load) throw new Error(`Load ${loadId} not found`);

  const carrier = initialCarriers.find((c) => c.id === carrierId);
  if (!carrier) throw new Error(`Carrier ${carrierId} not found`);

  if (MOCK_CALLS) {
    return mockNegotiateWithCarrier(load, carrier, competingRate);
  }

  const task = createNegotiationTask(load, competingRate);

  const response = await calleClient.calls.createAndWait({
    task,
    recipient: {
      phones: [carrier.phoneNumber],
    },
    resultSchema: taskResultSchema,
    recipientResultSchema: recipientResultSchema,
  });

  const now = new Date().toISOString();

  const recipientResult = response.recipients?.[0];

  if (recipientResult?.structuredResult) {
    const sr = recipientResult.structuredResult;
    return {
      id: `quote-${load.id}-${carrier.id}-r2`,
      loadId: load.id,
      carrierId: carrier.id,
      round: 2,
      available: (['yes', 'no', 'unknown'].includes(sr.available as string) ? (sr.available as 'yes' | 'no' | 'unknown') : 'unknown'),
      quotedRate: typeof sr.quoted_rate === 'number' ? sr.quoted_rate : null,
      pickupConfirmed: (['yes', 'no', 'unknown'].includes(sr.pickup_confirmed as string) ? (sr.pickup_confirmed as 'yes' | 'no' | 'unknown') : 'unknown'),
      evidence: (sr.evidence as string) || '',
      transcript: recipientResult.summary || '',
      timestamp: now,
    };
  }

  return {
    id: `quote-${load.id}-${carrier.id}-r2`,
    loadId: load.id,
    carrierId: carrier.id,
    round: 2,
    available: 'unknown',
    quotedRate: null,
    pickupConfirmed: 'unknown',
    evidence: 'No structured result returned from negotiation call.',
    transcript: recipientResult?.summary || '',
    timestamp: now,
  };
}

/**
 * Server Action: Generate AI recommendation summary using Kimi.
 */
export async function generateRecommendationSummary(
  loadId: string,
  winnerCarrierId: string,
  winnerRate: number,
  runnerUpCarrierId: string,
  runnerUpRate: number,
  savingsVsOriginal: number,
  savingsVsNextBest: number,
  wasNegotiated: boolean
): Promise<string> {
  const load = initialLoads.find((l) => l.id === loadId);
  const winnerCarrier = initialCarriers.find((c) => c.id === winnerCarrierId);
  const runnerUpCarrier = initialCarriers.find((c) => c.id === runnerUpCarrierId);

  if (!load || !winnerCarrier || !runnerUpCarrier) {
    throw new Error('Missing data for summary generation');
  }

  const prompt = `You are a freight broker assistant. Write a concise 2-3 sentence recommendation summary.

Load: ${load.origin} → ${load.destination}, ${load.equipmentType}, ${load.weight.toLocaleString()} lbs, pickup ${load.pickupDate}

Carriers quoted:
- ${winnerCarrier.name}: $${winnerRate.toLocaleString()}${wasNegotiated ? ' (negotiated down from original quote)' : ''}
- ${runnerUpCarrier.name}: $${runnerUpRate.toLocaleString()}

Winner: ${winnerCarrier.name}
Savings: $${savingsVsOriginal.toLocaleString()} vs their original quote, $${savingsVsNextBest.toLocaleString()} vs next best option

Write a professional summary explaining why ${winnerCarrier.name} is recommended. Mention the negotiation if applicable. Be specific with numbers. Keep it under 250 characters if possible.`;

  return generateSummary(prompt, {
    loadOrigin: load.origin,
    loadDestination: load.destination,
    equipmentType: load.equipmentType,
    weight: load.weight,
    pickupDate: load.pickupDate,
    winnerName: winnerCarrier.name,
    winnerRate,
    runnerUpName: runnerUpCarrier.name,
    runnerUpRate,
    savingsVsOriginal,
    savingsVsNextBest,
    wasNegotiated,
  });
}

/**
 * Server Action: Create a booking record for the winning quote.
 */
export async function createBooking(
  loadId: string,
  winningQuoteId: string,
  finalRate: number,
  savingsVsOriginal: number,
  savingsVsNextBest: number
): Promise<Booking> {
  const load = initialLoads.find((l) => l.id === loadId);
  if (!load) throw new Error(`Load ${loadId} not found`);

  const now = new Date().toISOString();

  const booking: Booking = {
    id: `booking-${loadId}-${Date.now()}`,
    loadId,
    winningQuoteId,
    finalRate,
    savingsVsOriginal,
    savingsVsNextBest,
    timestamp: now,
  };

  return booking;
}
