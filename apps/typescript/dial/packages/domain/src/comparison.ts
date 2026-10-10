import type {
  CallRecord,
  BusinessCandidate,
  ComparableOutcome,
  TaskResult,
  EvidenceTally,
  CallFamily,
  DialTask,
  CallDisposition,
} from '@dial/schemas';

/**
 * Section 15 / section 16. Turns raw call outcomes into a ranked, *defensible*
 * answer.
 *
 * The whole module is built around one rule: a claim may only be as strong as
 * the evidence collected. "Cheapest in the city" is never sayable. "Lowest
 * verified quote among the 4 that answered" is, and only when 4 answered.
 */

export interface ComparisonInput {
  task: Pick<DialTask, 'taskFamily' | 'constraints' | 'objective'>;
  family: CallFamily;
  calls: CallRecord[];
  candidatesById: Map<string, BusinessCandidate>;
  discoveredCount: number;
}

const YES = 'yes';

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A disposition that means the business actually gave us usable information. */
function isUsable(disposition: CallDisposition): boolean {
  return disposition === 'answered_useful';
}

/**
 * Did they say they can do it when the user asked for it?
 *
 * Only consulted when the user named a time. Deliberately conservative: a
 * clear yes is a yes, and everything else -- "unknown", a vague answer, no
 * answer at all -- is not treated as a promise. Ranking a business above a
 * cheaper one is a claim about it, and a claim needs evidence.
 */
function meetsRequestedTiming(result: Record<string, unknown> | null): boolean | null {
  if (!result) return null;

  if (result['same_day_available'] === YES) return true;
  if (result['same_day_available'] === 'no') return false;

  const availability = str(result['availability']);
  if (availability === 'available') return true;
  if (availability === 'unavailable') return false;
  // 'alternative_offered' means they can help, but not when asked. That is a
  // real answer and a real "no" to the timing question.
  if (availability === 'alternative_offered') return false;

  return null;
}

/** The provider's own confidence, reduced to three buckets we can order. */
function confidenceLabel(
  confidence: { label?: string; score?: number } | null,
): 'high' | 'medium' | 'low' | null {
  const label = confidence?.label?.toLowerCase();
  if (label === 'high' || label === 'medium' || label === 'low') return label;
  const score = confidence?.score;
  if (typeof score !== 'number') return null;
  return score >= 0.75 ? 'high' : score >= 0.4 ? 'medium' : 'low';
}

const CONFIDENCE_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function buildOutcome(
  call: CallRecord,
  candidate: BusinessCandidate,
  family: CallFamily,
  wantsTiming: boolean,
): ComparableOutcome {
  const result = call.structuredResult;
  const notes: string[] = [];
  const highlights: string[] = [];
  const conditions: string[] = [];

  let quotedPrice: number | null = null;
  let quotedCurrency: string | null = null;
  let normalizedPrice: number | null = null;

  if (result && family.priceField) {
    quotedPrice = num(result[family.priceField]);
    quotedCurrency = str(result['currency']);
    if (quotedPrice !== null && quotedPrice > 0) {
      normalizedPrice = quotedPrice;
      // A callout fee is money the user pays, so it belongs in the comparison.
      // Leaving it out would make the cheapest-looking option the wrong answer.
      const callout = num(result['callout_fee']);
      if (callout !== null && callout > 0) {
        normalizedPrice += callout;
        notes.push(`Includes ${quotedCurrency ?? ''} ${callout.toFixed(2)} callout fee`.trim());
      }
      if (result['price_includes_tax'] === 'no') {
        notes.push('Quote excludes tax');
      } else if (result['price_includes_tax'] === 'unknown') {
        notes.push('Unclear whether tax is included');
      }
      if (result['parts_included'] === 'no') notes.push('Parts not included');
    } else {
      quotedPrice = null;
    }
  }

  // Viability: did they say they can actually do the thing?
  let viable = false;
  if (result && family.viabilityField) {
    const v = result[family.viabilityField];
    viable = v === YES || v === 'available' || v === 'alternative_offered';
  }
  if (!isUsable(call.disposition)) viable = false;

  if (result) {
    if (result['same_day_available'] === YES) highlights.push('Same day');
    if (str(result['turnaround'])) highlights.push(String(result['turnaround']));
    if (str(result['warranty'])) highlights.push(String(result['warranty']));
    if (str(result['earliest_arrival'])) highlights.push(`Earliest: ${result['earliest_arrival']}`);
    if (result['parts_quality'] && result['parts_quality'] !== 'unknown') {
      highlights.push(String(result['parts_quality']).replace(/_/g, ' '));
    }
    if (str(result['time'])) highlights.push(String(result['time']));
    if (result['quote_binding'] === 'estimate') conditions.push('Estimate, not a fixed price');
    if (result['appointment_required'] === YES) conditions.push('Appointment required');
    for (const key of ['quote_conditions', 'additional_conditions', 'special_conditions', 'conditions']) {
      const c = str(result[key]);
      if (c) conditions.push(c);
    }
  }

  // Two fields can legitimately carry the same phrase ("within 24 hours" as both
  // turnaround and warranty, say). Showing it twice looks like a rendering bug,
  // so collapse duplicates while preserving order.
  const dedupe = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

  return {
    callId: call.id,
    candidate,
    normalizedPrice,
    normalizedCurrency: quotedCurrency,
    quotedPrice,
    quotedCurrency,
    normalizationNotes: notes,
    viable,
    meetsTiming: wantsTiming ? meetsRequestedTiming(result) : null,
    confidence: confidenceLabel(call.completionConfidence),
    highlights: dedupe(highlights),
    conditions: dedupe(conditions),
    rank: null,
    rankReasons: [],
    structuredResult: result,
    disposition: call.disposition,
  };
}

/**
 * Currencies are never converted. Without a rate source we would be inventing a
 * number and then ranking on it -- exactly the fabrication section 41 forbids.
 * Instead we compare within the majority currency and say so in the caveats.
 */
function dominantCurrency(outcomes: ComparableOutcome[]): string | null {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    if (o.normalizedPrice !== null && o.normalizedCurrency) {
      counts.set(o.normalizedCurrency, (counts.get(o.normalizedCurrency) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

export function compareOutcomes(input: ComparisonInput): TaskResult {
  const { calls, candidatesById, family, task, discoveredCount } = input;

  /*
   * Whether the user asked for a particular time at all.
   *
   * Most requests do not, and inventing a timing preference for them would
   * reorder results around something nobody asked about.
   */
  const wantsTiming = Boolean(task.constraints.date || task.constraints.timeWindow);

  const outcomes: ComparableOutcome[] = [];
  for (const call of calls) {
    const candidate = candidatesById.get(call.candidateId);
    if (!candidate) continue;
    outcomes.push(buildOutcome(call, candidate, family, wantsTiming));
  }

  // Only calls that were actually dispatched count as contacted. A planned row
  // that never got dialled must not inflate "we contacted N businesses" -- the
  // whole point of the tally is that every number in it is defensible.
  const contacted = calls.filter((c) => c.providerCallId !== null);
  const answered = contacted.filter((c) =>
    ['answered_useful', 'answered_no_answer_to_question', 'refused'].includes(c.disposition),
  ).length;

  const usable = outcomes.filter((o) => o.viable);
  const unusable = outcomes.filter((o) => !o.viable);

  const caveats: string[] = [];
  const currency = dominantCurrency(usable);

  // Budget filter, applied only where a real comparable price exists.
  const budget = task.constraints.budget;
  let inBudget = usable;
  if (budget && currency) {
    if (budget.currency !== currency) {
      caveats.push(
        `Your budget is in ${budget.currency} but quotes came back in ${currency}. Dial has not converted between them.`,
      );
    } else {
      const matching = usable.filter(
        (o) =>
          o.normalizedPrice === null ||
          (budget.comparator === 'max'
            ? o.normalizedPrice <= budget.amount
            : budget.comparator === 'min'
              ? o.normalizedPrice >= budget.amount
              : true),
      );
      if (matching.length === 0 && usable.length > 0) {
        caveats.push(
          `No business Dial contacted confirmed a price ${budget.comparator === 'max' ? 'under' : 'over'} ${budget.currency} ${budget.amount}.`,
        );
      } else {
        inBudget = matching;
      }
    }
  }

  const mixedCurrency = new Set(
    usable.map((o) => o.normalizedCurrency).filter((c): c is string => Boolean(c)),
  ).size > 1;
  if (mixedCurrency) {
    caveats.push('Quotes came back in more than one currency and were not converted.');
  }

  /*
   * Ranking, in stated order rather than as a score.
   *
   * The comment here used to promise availability and rating were considered.
   * They were not: the sort was `by price`, full stop. So a shop that said it
   * could not manage the day the user asked for still won on being fifty
   * cents cheaper.
   *
   * A weighted score would fix the ordering and break the product. Dial's
   * value is that it can always say WHY something won -- "lowest verified
   * quote among the two that answered" -- and no weighted sum can answer that
   * in a sentence. So this is lexicographic: each step is a reason, and the
   * first step that separates two options is the reason one beat the other.
   *
   *   1. can do it when the user asked   (only if the user asked)
   *   2. cheapest verified price
   *   3. the answer Dial is surest it heard correctly
   *   4. better rated, by more people
   *   5. nearer
   */
  const priced = inBudget.filter(
    (o) => o.normalizedPrice !== null && (!currency || o.normalizedCurrency === currency),
  );
  const unpriced = inBudget.filter((o) => !priced.includes(o));

  const byPreference = (a: ComparableOutcome, b: ComparableOutcome): number => {
    // 1. Timing the user actually asked for. Unknown ranks with "no": Dial
    //    will not promote a business over a cheaper one on a maybe.
    if (a.meetsTiming !== null || b.meetsTiming !== null) {
      const at = a.meetsTiming === true ? 0 : 1;
      const bt = b.meetsTiming === true ? 0 : 1;
      if (at !== bt) return at - bt;
    }

    // 2. Price, where both have one.
    if (a.normalizedPrice !== null && b.normalizedPrice !== null) {
      if (a.normalizedPrice !== b.normalizedPrice) return a.normalizedPrice - b.normalizedPrice;
    }

    // 3. Confidence in the answer itself.
    const ac = CONFIDENCE_ORDER[a.confidence ?? ''] ?? 1;
    const bc = CONFIDENCE_ORDER[b.confidence ?? ''] ?? 1;
    if (ac !== bc) return ac - bc;

    // 4. Rating, and then how many people rated it -- 5.0 from one review is
    //    not better evidence than 4.6 from four hundred.
    const ar = a.candidate.rating ?? 0;
    const br = b.candidate.rating ?? 0;
    if (ar !== br) return br - ar;
    const an = a.candidate.reviewCount ?? 0;
    const bn = b.candidate.reviewCount ?? 0;
    if (an !== bn) return bn - an;

    // 5. Nearer.
    return (a.candidate.distanceMeters ?? 1e9) - (b.candidate.distanceMeters ?? 1e9);
  };

  priced.sort(byPreference);
  unpriced.sort(byPreference);

  const ordered = family.priceField ? [...priced, ...unpriced] : [...unpriced, ...priced];

  ordered.forEach((outcome, index) => {
    outcome.rank = index + 1;
    const reasons: string[] = [];
    // Said first, because it is the reason this one is above a cheaper one.
    if (outcome.meetsTiming === true) reasons.push('Can do it when you asked');
    if (outcome.normalizedPrice !== null) {
      reasons.push(
        `${outcome.normalizedCurrency ?? ''} ${outcome.normalizedPrice.toFixed(2)} verified price`.trim(),
      );
    }
    for (const h of outcome.highlights.slice(0, 3)) reasons.push(h);
    /*
     * Distance belongs here but not in `highlights`.
     *
     * It is a genuine reason this option won, and the card that shows these
     * reasons has no distance of its own. The comparison table does, which is
     * why highlights no longer carry it -- the same row was printing "1.7 km
     * away" in two adjacent columns.
     */
    if (outcome.candidate.distanceMeters !== null) {
      reasons.push(`${(outcome.candidate.distanceMeters / 1000).toFixed(1)} km away`);
    }
    outcome.rankReasons = reasons;
  });

  const best = ordered[0] ?? null;

  /*
   * When the winner is not the cheapest, say so.
   *
   * Dial's headline is about a verified lowest price. The moment something
   * other than price decides the ranking, that framing is no longer the whole
   * truth, and a user comparing the table against the recommendation would
   * catch the discrepancy before Dial admitted it. Naming the cheaper option
   * and why it lost keeps the choice the user's to overrule.
   */
  if (best && best.normalizedPrice !== null) {
    const cheapest = ordered
      .filter((o) => o.normalizedPrice !== null)
      .reduce((a, b) => ((a.normalizedPrice ?? 0) <= (b.normalizedPrice ?? 0) ? a : b));

    if (cheapest !== best && (cheapest.normalizedPrice ?? 0) < best.normalizedPrice) {
      const money = `${cheapest.normalizedCurrency ?? ''} ${(cheapest.normalizedPrice ?? 0).toFixed(2)}`.trim();
      caveats.push(
        cheapest.meetsTiming === false
          ? `${cheapest.candidate.name} quoted less (${money}) but could not do it when you asked.`
          : `${cheapest.candidate.name} quoted less (${money}); Dial ranked it lower on the other details it gathered.`,
      );
    }
  }
  const tally: EvidenceTally = {
    discovered: discoveredCount,
    contacted: contacted.length,
    answered,
    comparable: ordered.length,
    verifiedAt: best ? (calls.find((c) => c.id === best.callId)?.completedAt ?? null) : null,
  };

  return {
    headline: buildHeadline(best, tally, family),
    best,
    alternatives: ordered.slice(1),
    unusable,
    tally,
    caveats,
  };
}

/**
 * The sentence the user reads first. It is generated from the tally, not from a
 * model, so it cannot overstate what was actually established.
 */
export function buildHeadline(
  best: ComparableOutcome | null,
  tally: EvidenceTally,
  family: CallFamily,
): string {
  if (tally.contacted === 0) {
    return 'Dial did not manage to contact any business for this request.';
  }
  if (!best) {
    if (tally.answered === 0) {
      return `Dial called ${tally.contacted} ${plural(tally.contacted, 'business', 'businesses')}, but none answered.`;
    }
    return `Dial spoke to ${tally.answered} of ${tally.contacted} ${plural(tally.contacted, 'business', 'businesses')}, but none could confirm what you asked for.`;
  }

  const name = best.candidate.name;

  if (best.normalizedPrice !== null && family.priceField) {
    const price = `${best.normalizedCurrency ?? ''} ${best.normalizedPrice.toFixed(2)}`.trim();
    return `Lowest verified quote among the ${tally.comparable} ${plural(tally.comparable, 'business', 'businesses')} that gave Dial a comparable price: ${name} at ${price}.`;
  }

  const bookingMade = best.structuredResult?.['booking_made'] === YES;
  if (bookingMade) {
    const code = best.structuredResult?.['confirmation_code'];
    return `Confirmed with ${name}${code ? ` — confirmation ${String(code)}` : ''}.`;
  }

  return `Best verified option among the ${tally.answered} ${plural(tally.answered, 'business', 'businesses')} that answered: ${name}.`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
