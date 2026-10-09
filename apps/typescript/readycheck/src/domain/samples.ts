import type { CandidateResult, Fact, Task, Value } from './model';
import { defaultTask, withAcquisition } from './templates';
import { displayValue } from './evaluator';

const names = {
  repair: [
    ['Thread & Trail', 'Bag & outdoor gear repair', 'West Loop', 'TT'],
    ['The Mending Room', 'Clothing alterations', 'Lincoln Park', 'MR'],
    ['Everyday Repair Co.', 'Bags & leather repair', 'Wicker Park', 'ER'],
  ],
  rental: [
    ['Brightside Rentals', 'Presentation equipment', 'West Loop', 'BR'],
    ['City AV Supply', 'Audio & visual rentals', 'River North', 'CA'],
    ['Northlight Equipment', 'Event equipment', 'Logan Square', 'NE'],
  ],
  venue: [
    ['The Assembly Room', 'Private workshop space', 'West Loop', 'AR'],
    ['Corner Studio', 'Creative meeting space', 'Pilsen', 'CS'],
    ['Common Ground', 'Community rooms', 'Lincoln Square', 'CG'],
  ],
};
export function sampleCandidates(template: Task['template']) {
  return names[template].map(([name, category, area, initials], i) => ({
    id: `${template}-${i + 1}`,
    name,
    category,
    area,
    initials,
  }));
}

/** A fixed fictional scenario. Caller edits NEVER rewrite its business answers. */
export function sampleResults(baseline: Task, now = new Date()): CandidateResult[] {
  return sampleCandidates(baseline.template).map((business, index) => {
    const observedAt = now.toISOString(),
      sourceId = `fictional-${business.id}-${now.getTime()}`;
    const result: CandidateResult = {
      ...business,
      mode: 'sample',
      disposition: 'answered',
      facts: [],
      transcript: [
        {
          speaker: 'caller',
          text: 'Fictional demonstration: checking the original sample request. No phone call was made.',
          offsetSeconds: 0,
        },
      ],
      checkedAt: observedAt,
      sourceId,
    };
    for (const requirement of baseline.requirements) {
      if (requirement.id.startsWith('custom') || requirement.id === 'upfront') continue;
      let value = structuredClone(requirement.value),
        certainty = 'confirmed' as Fact['certainty'],
        priceBasis: Fact['priceBasis'] = requirement.unit === 'USD' ? 'all_in' : undefined;
      let conditions: string[] = [];
      if (requirement.kind === 'max' && typeof value === 'number') value = Math.round(value * 0.85);
      if (baseline.template === 'repair') {
        if (index === 0 && requirement.id === 'budget') {
          value = 3500;
          priceBasis = 'estimate';
        }
        if (index === 1 && requirement.id === 'service') value = 'Clothing zipper repair';
        if (index === 2 && requirement.id === 'budget') value = 4500;
      }
      if (baseline.template === 'rental') {
        if (index === 1 && requirement.id === 'item') value = 'Epson EX3280';
        if (index === 2 && requirement.id === 'hdmi') continue;
        if (index === 0 && requirement.id === 'deposit') value = 10000;
      }
      if (baseline.template === 'venue') {
        if (index === 0 && requirement.id === 'budget') {
          value = 15000;
          priceBasis = 'estimate';
        }
        if (index === 1 && requirement.id === 'access') value = false;
        if (index === 2 && requirement.id === 'capacity') value = 8;
      }
      let raw = `${requirement.label}: ${displayValue({ ...requirement, value }, baseline.timeZone)}. This applies to the exact sample request.`;
      if (requirement.id === 'budget' && priceBasis === 'estimate')
        raw =
          baseline.template === 'repair'
            ? 'Backpack zipper repairs start at $35. We need to inspect the bag before confirming the final total.'
            : 'Room hire starts at $150. The final total, including all charges, has not been confirmed.';
      if (requirement.id === 'budget' && priceBasis === 'all_in')
        raw = `The total for this exact request is $${Number(value) / 100}, including taxes and required fees.`;
      if (requirement.id === 'deposit')
        raw = `The refundable deposit is $${Number(value) / 100}, separate from the rental fee.`;
      if (certainty === 'tentative')
        raw = 'We probably can finish by then, but completion depends on inspecting the backpack.';
      const scope: Record<string, Value> = {};
      if (baseline.template === 'rental') scope.$acquisition = baseline.acquisition || 'rental';
      for (const r of baseline.requirements) {
        if (
          ['service', 'item', 'quantity', 'period'].includes(r.id) ||
          (requirement.id === 'deadline' && r.id === 'deadline')
        )
          scope[r.id] =
            baseline.template === 'rental' &&
            index === 1 &&
            r.id === 'item' &&
            requirement.id !== 'item'
              ? 'Epson EX3280'
              : r.value;
      }
      result.transcript.push({
        speaker: 'recipient',
        text: raw,
        offsetSeconds: result.transcript.length * 9,
      });
      result.facts.push({
        id: `${sourceId}-${requirement.id}`,
        field: requirement.id,
        value,
        raw,
        sourceId,
        turn: result.transcript.length - 1,
        speaker: 'recipient',
        observedAt,
        expiresAt: new Date(now.getTime() + 86400000).toISOString(),
        certainty,
        priceBasis,
        unit: requirement.unit,
        conditions,
        reviewed: true,
        scope,
      });
    }
    return result;
  });
}
export function sampleFollowup(
  previous: CandidateResult,
  fieldIds: string[],
  now = new Date(),
): CandidateResult {
  const result = structuredClone(previous),
    sourceId = `fictional-followup-${previous.id}-${now.getTime()}`;
  const transcript: CandidateResult['transcript'] = [
    {
      speaker: 'caller',
      text: 'Fictional targeted follow-up. No phone call was made.',
      offsetSeconds: 0,
    },
  ];
  result.sources = { ...result.sources, [result.sourceId]: result.transcript };
  for (const id of fieldIds) {
    const old = [...result.facts].reverse().find((f) => f.field === id);
    if (previous.id !== 'repair-1' || id !== 'budget' || !old) continue;
    const raw =
      'For this backpack zipper repair, I can confirm a firm total of $38, including all taxes and fees. That replaces the earlier starting estimate.';
    transcript.push({ speaker: 'recipient', text: raw, offsetSeconds: 12 });
    result.facts.push({
      ...old,
      id: `${sourceId}-budget`,
      sourceId,
      turn: 1,
      raw,
      value: 3800,
      priceBasis: 'all_in',
      conditions: [],
      certainty: 'confirmed',
      supersedes: old.id,
      observedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    });
  }
  result.sourceId = sourceId;
  result.transcript = transcript;
  result.checkedAt = now.toISOString();
  return result;
}
export function sampleBaseline(template: Task['template'], createdAt: string, original?: Task) {
  const task = defaultTask(template, new Date(createdAt));
  if (template === 'rental' && original?.acquisition === 'purchase') {
    const purchase = withAcquisition(task, 'purchase');
    purchase.requirements.find((r) => r.id === 'budget')!.value = 120000;
    return purchase;
  }
  return task;
}
