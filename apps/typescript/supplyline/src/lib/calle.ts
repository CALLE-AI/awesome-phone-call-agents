import { Load, Carrier, Quote } from './types';

/**
 * Creates the task text for Round 1: asking carriers for availability and rate quotes.
 */
export function createQuoteTask(load: Load): string {
  return `You are a freight broker calling a trucking carrier to check availability and get a rate quote for a truckload shipment.

Load details:
- Origin: ${load.origin}
- Destination: ${load.destination}
- Equipment type: ${load.equipmentType}
- Pickup date: ${load.pickupDate}
- Weight: ${load.weight.toLocaleString()} lbs

Please:
1. Confirm if you have a truck available for this lane on the pickup date
2. Quote your all-in rate (in US dollars) to cover this load
3. Confirm if the pickup date works for your schedule

Be professional, direct, and concise. If you cannot cover the load, say so clearly.`;
}

/**
 * MOCK version for testing without real phone calls.
 * Returns deterministic fake quotes matching the PRD demo data.
 */
export async function mockCallCarriersForQuotes(
  load: Load,
  carriers: Carrier[]
): Promise<Quote[]> {
  const now = new Date().toISOString();

  // Demo data from PRD Section 6
  const mockRates: Record<string, number> = {
    'carrier-a': 1800, // Rockridge Transport LLC
    'carrier-b': 1650, // Prairie Line Carriers
  };

  return carriers.map((carrier) => ({
    id: `quote-${load.id}-${carrier.id}-r1`,
    loadId: load.id,
    carrierId: carrier.id,
    round: 1 as const,
    available: 'yes' as const,
    quotedRate: mockRates[carrier.id] || 1700,
    pickupConfirmed: 'yes' as const,
    evidence: `Carrier confirmed availability and quoted $${mockRates[carrier.id] || 1700} for the Chicago to Atlanta lane.`,
    transcript: `[Mock transcript] ${carrier.name}: "Yes, we can cover that. Our rate is $${mockRates[carrier.id] || 1700} all-in, pickup on ${load.pickupDate} works for us."`,
    timestamp: now,
  }));
}

/**
 * Creates the task text for Round 2: negotiation call to the higher-quoted carrier.
 */
export function createNegotiationTask(load: Load, competingRate: number): string {
  return `You are a freight broker calling back a trucking carrier to negotiate a better rate.

Load details:
- Origin: ${load.origin}
- Destination: ${load.destination}
- Equipment type: ${load.equipmentType}
- Pickup date: ${load.pickupDate}
- Weight: ${load.weight.toLocaleString()} lbs

A competing carrier has quoted $${competingRate.toLocaleString()} to cover this load.

Your goal: Ask if they can match or beat that rate to win the load. Be professional but firm. If they can't match, ask for their best counter-offer. If they refuse to negotiate, note that clearly.`;
}

/**
 * MOCK version for round 2 negotiation testing.
 * Returns a deterministic negotiated quote for the target carrier.
 */
export async function mockNegotiateWithCarrier(
  load: Load,
  carrier: Carrier,
  competingRate: number
): Promise<Quote> {
  const now = new Date().toISOString();

  // Demo data: Rockridge (carrier-a) negotiates down from $1,800 to $1,620
  // when confronted with Prairie Line's $1,650
  const mockNegotiatedRates: Record<string, number> = {
    'carrier-a': 1620, // Rockridge drops to beat Prairie Line by $30
  };

  const negotiatedRate = mockNegotiatedRates[carrier.id] || competingRate - 20;

  return {
    id: `quote-${load.id}-${carrier.id}-r2`,
    loadId: load.id,
    carrierId: carrier.id,
    round: 2,
    available: 'yes',
    quotedRate: negotiatedRate,
    pickupConfirmed: 'yes',
    evidence: `Carrier negotiated and agreed to $${negotiatedRate} after being presented with a competing quote of $${competingRate}.`,
    transcript: `[Mock transcript] ${carrier.name}: "Well, $${competingRate.toLocaleString()} is tight for us... but since you need it covered tomorrow, I can do $${negotiatedRate.toLocaleString()}."`,
    timestamp: now,
  };
}
