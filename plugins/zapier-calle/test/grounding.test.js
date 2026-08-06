import { describe, it, expect } from 'vitest';
import { checkGrounding, describeUngrounded } from '../lib/grounding.js';

const withTurns = (turns) => [{ attempts: [{ transcript_turns: turns }] }];
const conversation = () =>
  withTurns([
    { offset_seconds: 0, speaker: 'bot', text: 'Is your budget above fifty thousand this quarter?' },
    { offset_seconds: 7, speaker: 'user', text: "Yeah, we've got about sixty thousand set aside." },
    { offset_seconds: 15, speaker: 'user', text: 'Call me back in March.' },
  ]);

const whys = (result) => result.ungrounded.map((entry) => entry.why);
const paths = (result) => result.ungrounded.map((entry) => entry.path);

describe('checkGrounding', () => {
  // The convention is opt-in, exactly like the Do Not Call List. A schema
  // that never declared a _quote field must behave as it always has.
  it('enforces nothing when the schema declares no quote fields', () => {
    const result = checkGrounding({ budget: 'sixty thousand', timing: 'march' }, conversation());
    expect(result.enforced).toBe(false);
    expect(result.checked).toBe(0);
    expect(result.ungrounded).toEqual([]);
  });

  it('grounds an answer whose quote the recipient actually spoke', () => {
    const result = checkGrounding(
      { budget: 'sixty thousand', budget_quote: "we've got about sixty thousand set aside" },
      conversation(),
    );
    expect(result.enforced).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.ungrounded).toEqual([]);
  });

  it('grounds through casing, punctuation, and spacing differences', () => {
    const result = checkGrounding(
      { budget: 'sixty thousand', budget_quote: 'YEAH -- WEVE   GOT ABOUT SIXTY THOUSAND!!' },
      conversation(),
    );
    expect(result.ungrounded).toEqual([]);
  });

  // The failure this module exists for: well-formed JSON, high confidence,
  // and an answer nobody ever gave.
  it('reports an answer whose quote appears nowhere in the call', () => {
    const result = checkGrounding(
      { budget: 'unlimited', budget_quote: 'money is no object for us at all' },
      conversation(),
    );
    expect(whys(result)).toEqual(['not_found']);
    expect(paths(result)).toEqual(['budget']);
  });

  // Distinguished from not_found because it is a specific and diagnosable
  // mistake: the model cited the question as evidence for the answer.
  it('separates a quote taken from the agent’s own script', () => {
    const result = checkGrounding(
      { budget: 'above fifty thousand', budget_quote: 'Is your budget above fifty thousand this quarter?' },
      conversation(),
    );
    expect(whys(result)).toEqual(['bot_only']);
  });

  it('reports an answer given with a blank or unknown quote', () => {
    const blank = checkGrounding({ budget: 'sixty thousand', budget_quote: '   ' }, conversation());
    const unknown = checkGrounding({ budget: 'sixty thousand', budget_quote: 'unknown' }, conversation());
    const wrongType = checkGrounding({ budget: 'sixty thousand', budget_quote: 42 }, conversation());
    expect(whys(blank)).toEqual(['no_quote']);
    expect(whys(unknown)).toEqual(['no_quote']);
    expect(whys(wrongType)).toEqual(['no_quote']);
  });

  // lib/result-quality.js already routes a call whose answer is `unknown` to
  // review. Demanding evidence for a non-answer would report the same call
  // twice for the same reason.
  it('asks for no evidence where no answer was claimed', () => {
    const unknownAnswer = checkGrounding(
      { budget: 'unknown', budget_quote: 'nothing like this was ever said' },
      conversation(),
    );
    const emptyAnswer = checkGrounding(
      { budget: '', budget_quote: 'nothing like this was ever said' },
      conversation(),
    );
    expect(unknownAnswer.enforced).toBe(false);
    expect(unknownAnswer.ungrounded).toEqual([]);
    expect(emptyAnswer.ungrounded).toEqual([]);
  });

  // A real extracted answer stays checkable, so `false` and `0` must not be
  // mistaken for "no answer given" - the same trap lib/result-quality.js
  // documents.
  it('still demands evidence for a legitimate false or zero answer', () => {
    const result = checkGrounding(
      { interested: false, interested_quote: 'no thanks, not for us' },
      conversation(),
    );
    expect(result.checked).toBe(1);
    expect(whys(result)).toEqual(['not_found']);
  });

  it('reports a quote when the call produced no transcript at all', () => {
    const result = checkGrounding({ budget: 'sixty thousand', budget_quote: 'we have sixty' }, []);
    expect(whys(result)).toEqual(['no_transcript']);
  });

  it('checks nested objects and names the full path', () => {
    const result = checkGrounding(
      {
        contact: { timing: 'march', timing_quote: 'call me back in march' },
        finance: { budget: 'unlimited', budget_quote: 'never said this' },
      },
      conversation(),
    );
    expect(paths(result)).toEqual(['finance.budget']);
    expect(result.checked).toBe(2);
  });

  it('ignores a key that is only the bare suffix', () => {
    expect(checkGrounding({ _quote: 'never said this' }, conversation()).enforced).toBe(false);
  });

  // A throwing getter must not abort the Zap, and must not be waved through
  // either - an unverifiable claim is what this module refuses.
  it('fails closed on a structured result that cannot be read', () => {
    const hostile = {
      answer: 'yes',
      get answer_quote() {
        throw new Error('boom');
      },
    };
    const result = checkGrounding(hostile, conversation());
    expect(result.enforced).toBe(true);
    expect(whys(result)).toEqual(['not_found']);
  });

  it('reports nothing for a structured result that is not an object', () => {
    for (const value of [null, undefined, 'text', 42, []]) {
      expect(checkGrounding(value, conversation()).enforced, String(value)).toBe(false);
    }
  });
});

describe('describeUngrounded', () => {
  it('names each field and why its evidence failed', () => {
    const text = describeUngrounded([
      { path: 'budget', why: 'not_found' },
      { path: 'timing', why: 'bot_only' },
    ]);
    expect(text).toContain('budget cites a quote that does not appear in what the recipient said');
    expect(text).toContain('timing is supported only by a line the agent itself said');
  });

  it('summarizes the tail rather than listing every field', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((path) => ({ path, why: 'not_found' }));
    expect(describeUngrounded(many)).toContain('and 2 more fields');
  });
});
