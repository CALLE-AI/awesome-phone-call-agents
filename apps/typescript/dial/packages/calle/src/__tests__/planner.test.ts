import { describe, it, expect } from 'vitest';
import { getCallFamily, DEFAULT_USER_POLICY, type DialTask } from '@dial/schemas';
import { buildCallBrief, unresolvedFields, type CallPlanInput } from '../planner.js';

/**
 * The brief is the only thing standing between Dial and a bad phone call.
 *
 * These pin the parts that were learned the hard way. One real call ran to
 * fifteen exchanges against a recorded message: the recording said, three ways,
 * that the restaurant could not help by phone and to use the website, and Dial
 * rephrased the same question each time, said "I'll hold", and asked again --
 * for minutes, at the customer's expense, against a machine.
 *
 * Nothing in the brief was wrong. There was simply nothing in it about when to
 * stop, and "do not argue or call back repeatedly" reads as advice about manner
 * rather than as a stop condition.
 */

const TASK: DialTask = {
  objective: 'Find the price of a burger',
  taskFamily: 'quote_request',
  domain: 'restaurant',
  searchQuery: 'burger restaurant',
  calleeName: null,
  callPurpose: null,
  location: { raw: 'London', latitude: null, longitude: null, label: null, radiusKm: 10 },
  constraints: {
    budget: null,
    date: null,
    timeWindow: null,
    distanceKm: 10,
    partySize: null,
    preferredBrands: [],
    excludedBusinesses: [],
    candidateLimit: null,
    additional: {},
  },
  successCondition: 'A burger price is obtained',
  requestedSideEffect: 'information_only',
  sensitivity: 'normal',
  authorizationRequirement: 'none',
  clarificationNeeded: null,
  isEmergency: false,
};

function brief(
  over: Partial<DialTask> = {},
  extra: Partial<Pick<CallPlanInput, 'unresolved' | 'family'>> = {},
): string {
  return buildCallBrief({
    task: { ...TASK, ...over },
    family: extra.family ?? getCallFamily('general_inquiry'),
    candidate: {
      id: 'c1',
      name: "Bill's",
      category: 'restaurant',
      address: '1 High Street, London',
      latitude: null,
      longitude: null,
      phoneE164: '+442071234567',
      phoneRaw: '020 7123 4567',
      website: null,
      source: 'osm',
      sourceUrl: null,
      rating: null,
      reviewCount: null,
      distanceMeters: 400,
      openingHours: null,
      phoneVerified: false,
      verificationSources: [],
    },
    policy: DEFAULT_USER_POLICY,
    mayCommit: false,
    userFacts: {},
    userDisplayName: null,
    unresolved: extra.unresolved,
  });
}

describe('when to end the call', () => {
  it('caps how many times the same thing is asked', () => {
    expect(brief()).toMatch(/at most twice/i);
  });

  it('ends the call when the business sends you to a website', () => {
    // The exact case: "our team will be able to help you on our website via our
    // live chat or our Contact us form."
    const text = brief();
    expect(text).toMatch(/cannot help by phone/i);
    expect(text).toMatch(/website/i);
    expect(text).toMatch(/Do not rephrase and try again/i);
  });

  it('recognises a recording by its repetition', () => {
    const text = brief();
    expect(text).toMatch(/same thing/i);
    expect(text).toMatch(/recording or a script/i);
  });

  it('does not let holding become a loop', () => {
    expect(brief()).toMatch(/do not wait a second time/i);
  });

  it('says plainly that ending with no answer is a good outcome', () => {
    // Otherwise persistence looks like the helpful choice, which is how a
    // fifteen-exchange call happens without anything going obviously wrong.
    expect(brief()).toMatch(/Ending politely with no answer is a good outcome/i);
  });

  it('asks for the refusal in the business’s own words', () => {
    // "Only takes enquiries via the website" is a real answer about this
    // business. "Unknown" with no reason is not.
    expect(brief()).toMatch(/refused, or could only direct you elsewhere/i);
  });
});

describe('not asking the same thing twice', () => {
  // One real call asked the same two questions four times, rephrasing each
  // time while the business answered "yes" and grew confused. The brief said
  // nothing about tracking what had already been answered.
  it('forbids re-asking an answered question, even in different words', () => {
    expect(brief()).toMatch(/Never ask the same question twice/i);
    expect(brief()).toMatch(/Rephrasing the same question counts as asking again/i);
  });

  it('accepts "unknown" from a garbled reply instead of rephrasing', () => {
    expect(brief()).toMatch(/record it as "unknown" in the structured result/i);
  });

  it('asks one question at a time', () => {
    expect(brief()).toMatch(/One question at a time/i);
  });

  it('ends the call once the answers are in, instead of inventing follow-ups', () => {
    expect(brief()).toMatch(/Do not invent follow-up questions/i);
  });

  it('does not restate the objective as a second thing to ask about', () => {
    // The WHY section carries the objective; a checklist repeating it made
    // the agent treat one request as two topics and cycle between them.
    expect(brief()).not.toMatch(/WHAT YOU MUST FIND OUT/);
  });

  it('still lists real questions for families that have them', () => {
    const text = buildCallBrief({
      task: { ...TASK, taskFamily: 'quote_request' },
      family: getCallFamily('repair_quote'),
      candidate: {
        id: 'c1',
        name: "Bill's",
        category: 'restaurant',
        address: null,
        latitude: null,
        longitude: null,
        phoneE164: '+442071234567',
        phoneRaw: '020 7123 4567',
        website: null,
        source: 'osm',
        sourceUrl: null,
        rating: null,
        reviewCount: null,
        distanceMeters: null,
        openingHours: null,
        phoneVerified: false,
        verificationSources: [],
      },
      policy: DEFAULT_USER_POLICY,
      mayCommit: false,
      userFacts: {},
      userDisplayName: null,
    });
    expect(text).toMatch(/WHAT YOU MUST FIND OUT/);
    expect(text).toMatch(/Whether they can repair/);
  });
});

describe('what the brief has always had to say', () => {
  it('discloses that this is an AI, before anything else', () => {
    const text = brief();
    expect(text).toMatch(/Identify yourself as an AI assistant/i);
    expect(text.indexOf('Identify yourself as an AI')).toBeLessThan(text.indexOf('WHY'));
  });

  it('forbids committing to anything on an information-only call', () => {
    expect(brief()).toMatch(/Do NOT book, reserve, order, hold, or agree to anything/i);
  });

  it('forbids inventing an answer', () => {
    expect(brief()).toMatch(/Do not invent an answer/i);
  });

  it('carries the purpose in the user’s own words when there is one', () => {
    const text = brief({ callPurpose: 'check whether there is ice cream' });
    expect(text).toMatch(/The caller asked specifically: check whether there is ice cream/);
  });
});

/**
 * Making each call smarter than the last one.
 *
 * Dial rings several businesses with the same checklist. If four of them gave a
 * price but none would say anything about a warranty, the fifth call should
 * lead with the warranty rather than collecting a fifth price nobody needs.
 */
describe('unresolvedFields', () => {
  const repair = getCallFamily('repair_quote');

  it('returns nothing on the first call of a task', () => {
    // No prior results means no evidence of a gap. Flagging every field here
    // would put the whole checklist under "ASK THESE FIRST", prioritising
    // nothing.
    expect(unresolvedFields(repair, [])).toEqual([]);
  });

  it('treats "unknown", 0 and empty string as unanswered', () => {
    const missing = unresolvedFields(repair, [
      { can_repair: 'yes', quoted_price: 0, warranty: '', parts_quality: 'unknown' },
    ]);
    expect(missing.some((m) => /total price quoted/i.test(m))).toBe(true);
    expect(missing.some((m) => /warranty/i.test(m))).toBe(true);
  });

  it('drops a field as soon as any one business has answered it', () => {
    // The second garage would not quote, but the first did, so the price is no
    // longer the gap in what Dial knows.
    const missing = unresolvedFields(repair, [
      { can_repair: 'yes', quoted_price: 90, warranty: 'unknown' },
      { can_repair: 'yes', quoted_price: 0, warranty: 'unknown' },
    ]);
    expect(missing.some((m) => /total price quoted/i.test(m))).toBe(false);
    expect(missing.some((m) => /warranty/i.test(m))).toBe(true);
  });

  it('never chases the bookkeeping fields', () => {
    const missing = unresolvedFields(repair, [{ can_repair: 'yes' }]);
    expect(missing.join(' ')).not.toMatch(/evidence|confidence|business name/i);
  });

  it('ignores calls that produced no structured result at all', () => {
    expect(unresolvedFields(repair, [null, null])).toEqual([]);
  });
});

describe('the brief prioritises what is still missing', () => {
  it('lists outstanding facts under a heading that orders the checklist', () => {
    const text = brief({}, { unresolved: ['Warranty offered, as stated.'] });
    expect(text).toContain('ASK THESE FIRST');
    expect(text).toContain('Warranty offered, as stated.');
  });

  it('omits the section entirely when nothing is outstanding', () => {
    expect(brief()).not.toContain('ASK THESE FIRST');
  });

  it('caps the priority list so a brief cannot flag everything', () => {
    const text = brief({}, { unresolved: ['one', 'two', 'three', 'four', 'five', 'six'] });
    for (const kept of ['- one', '- two', '- three', '- four']) expect(text).toContain(kept);
    for (const dropped of ['- five', '- six']) expect(text).not.toContain(dropped);
  });

  it('still forbids open-ended follow-ups while allowing one to pin down a range', () => {
    // Both rules have to survive together: the fix for the call that looped
    // against a recording, and the new nudge that a range is not an answer.
    const text = brief();
    expect(text).toContain('Do not invent follow-up questions');
    expect(text).toMatch(/ONE short follow-up/);
  });
});
