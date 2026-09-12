import { describe, it, expect } from 'vitest';
import {
  CALL_FAMILIES,
  type CallRecord,
  type BusinessCandidate,
  type DialTask,
} from '@dial/schemas';
import { compareOutcomes } from '../comparison.js';

function candidate(id: string, name: string, extra: Partial<BusinessCandidate> = {}): BusinessCandidate {
  return {
    id,
    name,
    category: 'phone_repair',
    address: '1 Test Street',
    latitude: 53.35,
    longitude: -6.26,
    phoneE164: '+35315550100',
    phoneRaw: '01 555 0100',
    website: null,
    source: 'osm',
    sourceUrl: null,
    rating: null,
    reviewCount: null,
    distanceMeters: 2100,
    openingHours: null,
    phoneVerified: true,
    verificationSources: [],
    ...extra,
  };
}

function call(id: string, candidateId: string, result: Record<string, unknown> | null, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    id,
    taskId: 't1',
    candidateId,
    businessName: candidateId,
    phoneMasked: '+35***00',
    providerCallId: `calle_${id}`,
    providerStatus: 'completed',
    disposition: result ? 'answered_useful' : 'needs_review',
    structuredResult: result,
    summary: null,
    completionConfidence: { score: 0.9, label: 'high' },
    evidence: [],
    transcript: [],
    failureCode: null,
    failureMessage: null,
    startedAt: '2026-08-19T15:40:00.000Z',
    completedAt: '2026-08-19T15:42:00.000Z',
    ...extra,
  };
}

const baseTask: Pick<DialTask, 'taskFamily' | 'constraints' | 'objective'> = {
  taskFamily: 'research_compare',
  objective: 'Cheapest iPhone 13 screen replacement today',
  constraints: {
    budget: null,
    date: null,
    timeWindow: null,
    distanceKm: null,
    partySize: null,
    preferredBrands: [],
    excludedBusinesses: [],
    candidateLimit: null,
    additional: {},
  },
};

describe('compareOutcomes — repair quotes', () => {
  const candidates = new Map([
    ['c1', candidate('c1', 'FixLab')],
    ['c2', candidate('c2', 'MobileCare')],
    ['c3', candidate('c3', 'iRepair')],
  ]);

  it('ranks by verified price and states the tally honestly', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 12,
      calls: [
        call('a', 'c1', { can_repair: 'yes', quoted_price: 89, currency: 'EUR', same_day_available: 'yes', confidence: 'high' }),
        call('b', 'c2', { can_repair: 'yes', quoted_price: 120, currency: 'EUR', confidence: 'high' }),
        call('c', 'c3', { can_repair: 'no', confidence: 'high' }),
      ],
    });

    expect(result.best?.candidate.name).toBe('FixLab');
    expect(result.best?.normalizedPrice).toBe(89);
    expect(result.alternatives[0]?.candidate.name).toBe('MobileCare');
    expect(result.tally).toMatchObject({ discovered: 12, contacted: 3, answered: 3, comparable: 2 });
  });

  it('never claims to be cheapest overall — only cheapest among those contacted', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 12,
      calls: [call('a', 'c1', { can_repair: 'yes', quoted_price: 89, currency: 'EUR', confidence: 'high' })],
    });
    expect(result.headline).toMatch(/among the 1 business that gave Dial a comparable price/i);
    expect(result.headline).not.toMatch(/cheapest in|city|anywhere|overall/i);
  });

  it('treats a null structured result as unusable rather than a zero-price win', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 5,
      calls: [
        call('a', 'c1', null),
        call('b', 'c2', { can_repair: 'yes', quoted_price: 150, currency: 'EUR', confidence: 'high' }),
      ],
    });
    expect(result.best?.candidate.name).toBe('MobileCare');
    expect(result.unusable).toHaveLength(1);
    expect(result.unusable[0]?.normalizedPrice).toBeNull();
  });

  it('reports honestly when nobody answered', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 9,
      calls: [
        call('a', 'c1', null, { disposition: 'no_answer' }),
        call('b', 'c2', null, { disposition: 'no_answer' }),
      ],
    });
    expect(result.best).toBeNull();
    expect(result.headline).toMatch(/none answered/i);
  });
});

describe('compareOutcomes — service quotes and budgets', () => {
  const candidates = new Map([
    ['p1', candidate('p1', 'QuickFlow')],
    ['p2', candidate('p2', 'DrainCo')],
  ]);

  it('folds the callout fee into the comparable price', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.service_quote,
      candidatesById: candidates,
      discoveredCount: 6,
      calls: [
        // Headline price is lower, but the callout fee makes it dearer overall.
        call('a', 'p1', { service_available: 'yes', estimated_price: 90, callout_fee: 60, currency: 'USD', confidence: 'high' }),
        call('b', 'p2', { service_available: 'yes', estimated_price: 130, callout_fee: 0, currency: 'USD', confidence: 'high' }),
      ],
    });
    expect(result.best?.candidate.name).toBe('DrainCo');
    expect(result.alternatives[0]?.normalizedPrice).toBe(150);
    expect(result.alternatives[0]?.normalizationNotes.join(' ')).toMatch(/callout fee/i);
  });

  it('says so plainly when nobody met the budget, and invents nobody', () => {
    const result = compareOutcomes({
      task: {
        ...baseTask,
        constraints: { ...baseTask.constraints, budget: { comparator: 'max', amount: 150, currency: 'USD' } },
      },
      family: CALL_FAMILIES.service_quote,
      candidatesById: candidates,
      discoveredCount: 6,
      calls: [
        call('a', 'p1', { service_available: 'yes', estimated_price: 200, callout_fee: 0, currency: 'USD', confidence: 'high' }),
        call('b', 'p2', { service_available: 'yes', estimated_price: 240, callout_fee: 0, currency: 'USD', confidence: 'high' }),
      ],
    });
    expect(result.caveats.join(' ')).toMatch(/no business dial contacted confirmed a price under usd 150/i);
  });

  it('refuses to convert between currencies', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.service_quote,
      candidatesById: candidates,
      discoveredCount: 4,
      calls: [
        call('a', 'p1', { service_available: 'yes', estimated_price: 90, currency: 'USD', confidence: 'high' }),
        call('b', 'p2', { service_available: 'yes', estimated_price: 80, currency: 'EUR', confidence: 'high' }),
      ],
    });
    expect(result.caveats.join(' ')).toMatch(/more than one currency and were not converted/i);
  });
});

describe('compareOutcomes — reservations', () => {
  it('reports a confirmation only when a booking was actually made', () => {
    const candidates = new Map([['r1', candidate('r1', 'Trattoria Uno')]]);
    const result = compareOutcomes({
      task: { ...baseTask, taskFamily: 'reservation' },
      family: CALL_FAMILIES.reservation,
      candidatesById: candidates,
      discoveredCount: 3,
      calls: [
        call('a', 'r1', {
          availability: 'available',
          booking_made: 'yes',
          confirmation_code: 'AB12',
          time: '19:00',
          confidence: 'high',
        }),
      ],
    });
    expect(result.headline).toMatch(/confirmed with Trattoria Uno/i);
    expect(result.headline).toMatch(/AB12/);
  });

  it('does not claim a booking when availability was checked but nothing was booked', () => {
    const candidates = new Map([['r1', candidate('r1', 'Trattoria Uno')]]);
    const result = compareOutcomes({
      task: { ...baseTask, taskFamily: 'reservation' },
      family: CALL_FAMILIES.reservation,
      candidatesById: candidates,
      discoveredCount: 3,
      calls: [call('a', 'r1', { availability: 'available', booking_made: 'no', confidence: 'high' })],
    });
    expect(result.headline).not.toMatch(/confirmed/i);
    expect(result.headline).toMatch(/best verified option/i);
  });
});


describe('what the notes column carries', () => {
  const candidates = new Map([
    ['c1', candidate('c1', 'FixLab', { distanceMeters: 1700 })],
    ['c2', candidate('c2', 'MobileCare', { distanceMeters: 600 })],
  ]);

  /**
   * The comparison table has its own Distance column. Distance was also being
   * pushed into `highlights`, so every row printed "1.7 km away" twice, side
   * by side -- and because only three highlights fit, it pushed a real answer
   * out of view.
   */
  it('keeps distance out of the notes', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 5,
      calls: [
        call('a', 'c1', {
          can_repair: 'yes',
          quoted_price: 89,
          currency: 'EUR',
          same_day_available: 'yes',
          warranty: '90-day warranty',
          confidence: 'high',
        }),
      ],
    });

    const notes = result.best!.highlights;
    expect(notes).toContain('Same day');
    expect(notes).toContain('90-day warranty');
    expect(notes.some((n) => /km away/.test(n))).toBe(false);
  });

  it('still gives distance as a reason this one won', () => {
    // The card that shows rank reasons has no distance column of its own, so
    // dropping it entirely would lose a genuine reason.
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 5,
      calls: [call('a', 'c1', { can_repair: 'yes', quoted_price: 89, currency: 'EUR', confidence: 'high' })],
    });

    expect(result.best!.rankReasons.some((r) => r === '1.7 km away')).toBe(true);
  });

  it('carries the disposition, so an empty notes cell can say why', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 5,
      calls: [
        call('a', 'c1', null, { disposition: 'no_answer' }),
        call('b', 'c2', null, { disposition: 'voicemail' }),
      ],
    });

    const all = [result.best, ...result.alternatives, ...result.unusable].filter(Boolean);
    const dispositions = all.map((o) => o!.disposition);
    expect(dispositions).toContain('no_answer');
    expect(dispositions).toContain('voicemail');
    // And nothing was invented about businesses that never spoke.
    for (const outcome of all) expect(outcome!.highlights).toEqual([]);
  });
});


describe('ranking is not price alone', () => {
  /**
   * The case that exposed it:
   *
   *   Business A  $50  no availability
   *   Business B  $65  available today
   *   Business C  $60  available tomorrow
   *
   * Sorting on price alone recommends A, which said it cannot do the thing
   * the user asked for. The code did exactly that while its own comment
   * claimed availability and rating were considered.
   */
  const candidates = new Map([
    ['a', candidate('a', 'Business A', { distanceMeters: 500, rating: 4.0, reviewCount: 10 })],
    ['b', candidate('b', 'Business B', { distanceMeters: 900, rating: 4.5, reviewCount: 200 })],
    ['c', candidate('c', 'Business C', { distanceMeters: 700, rating: 4.2, reviewCount: 50 })],
  ]);

  const today = {
    ...baseTask,
    constraints: { ...baseTask.constraints, date: '2026-09-01' },
  };

  it('prefers the business that can do it when asked, over the cheaper one that cannot', () => {
    const result = compareOutcomes({
      task: today,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 3,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 50, currency: 'USD', same_day_available: 'no', confidence: 'high' }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 65, currency: 'USD', same_day_available: 'yes', confidence: 'high' }),
        call('c', 'c', { can_repair: 'yes', quoted_price: 60, currency: 'USD', same_day_available: 'no', confidence: 'high' }),
      ],
    });

    expect(result.best?.candidate.name).toBe('Business B');
  });

  it('says plainly that a cheaper option existed, and why it lost', () => {
    // Otherwise a user reading the table would spot the $50 before Dial
    // admitted to it.
    const result = compareOutcomes({
      task: today,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 3,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 50, currency: 'USD', same_day_available: 'no', confidence: 'high' }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 65, currency: 'USD', same_day_available: 'yes', confidence: 'high' }),
      ],
    });

    const caveats = result.caveats.join(' ');
    expect(caveats).toMatch(/Business A quoted less/);
    expect(caveats).toMatch(/could not do it when you asked/);
    expect(result.best?.rankReasons).toContain('Can do it when you asked');
  });

  it('still ranks on price when the user named no timing', () => {
    // Most requests are like this. Inventing a timing preference would
    // reorder results around something nobody asked about.
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 3,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 50, currency: 'USD', same_day_available: 'no', confidence: 'high' }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 65, currency: 'USD', same_day_available: 'yes', confidence: 'high' }),
      ],
    });

    expect(result.best?.candidate.name).toBe('Business A');
    expect(result.best?.meetsTiming).toBeNull();
    // Nothing to apologise for: the cheapest did win.
    expect(result.caveats.join(' ')).not.toMatch(/quoted less/);
  });

  it('does not promote a business on a maybe', () => {
    // "unknown" availability is not a promise. Ranking above a cheaper option
    // is a claim, and a claim needs evidence.
    const result = compareOutcomes({
      task: today,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 2,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 50, currency: 'USD', confidence: 'high' }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 65, currency: 'USD', confidence: 'high' }),
      ],
    });

    expect(result.best?.candidate.name).toBe('Business A');
  });

  it('breaks a price tie on the answer it is surest about', () => {
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: candidates,
      discoveredCount: 2,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 60, currency: 'USD', confidence: 'high' }, {
          completionConfidence: { score: 0.2, label: 'low' },
        }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 60, currency: 'USD', confidence: 'high' }, {
          completionConfidence: { score: 0.95, label: 'high' },
        }),
      ],
    });

    expect(result.best?.candidate.name).toBe('Business B');
    expect(result.best?.confidence).toBe('high');
  });

  it('breaks a remaining tie on rating, then on how many rated it', () => {
    const sameEverything = new Map([
      ['a', candidate('a', 'Fewer Reviews', { rating: 4.8, reviewCount: 3, distanceMeters: 500 })],
      ['b', candidate('b', 'Many Reviews', { rating: 4.8, reviewCount: 400, distanceMeters: 500 })],
    ]);
    const result = compareOutcomes({
      task: baseTask,
      family: CALL_FAMILIES.repair_quote,
      candidatesById: sameEverything,
      discoveredCount: 2,
      calls: [
        call('a', 'a', { can_repair: 'yes', quoted_price: 60, currency: 'USD', confidence: 'high' }),
        call('b', 'b', { can_repair: 'yes', quoted_price: 60, currency: 'USD', confidence: 'high' }),
      ],
    });

    // 4.8 from three people is not better evidence than 4.8 from four hundred.
    expect(result.best?.candidate.name).toBe('Many Reviews');
  });
});
