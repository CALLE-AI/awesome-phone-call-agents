import { describe, it, expect } from 'vitest';
import {
  describeAppointment,
  getBusinessTemplate,
  BUSINESS_WORKFLOW_TEMPLATES,
  splitAppointmentValue,
  composeAppointmentValue,
  isCompleteAppointment,
  maskAppointmentDate,
  maskAppointmentTime,
} from '../business.js';
import { listCountries, dialCodeFor, COUNTRY_DIAL_CODES } from '../countries.js';

/**
 * What Dial says out loud, and what the forms behind it collect.
 *
 * The appointment time used to be a free-text box with a placeholder: whatever
 * the owner typed was read to a customer verbatim. Now it is a date and a time
 * picked from real controls, stored unambiguously, and spoken as words.
 */

describe('saying an appointment out loud', () => {
  it('turns the stored value into something worth hearing', () => {
    expect(describeAppointment('2026-08-25T10:30')).toBe('Tuesday 25 August 2026 at 10:30');
  });

  it('accepts the space-separated form as well as the T form', () => {
    expect(describeAppointment('2026-08-25 10:30')).toBe('Tuesday 25 August 2026 at 10:30');
  });

  it('does not shift the day for a late or early time', () => {
    // Read textually rather than through local-time arithmetic: a reminder
    // must never announce a different day to the one the business picked,
    // and a server in another timezone is not a reason for that to happen.
    expect(describeAppointment('2026-08-25T23:59')).toContain('Tuesday 25 August');
    expect(describeAppointment('2026-08-25T00:01')).toContain('Tuesday 25 August');
  });

  it('passes older free-text values straight through', () => {
    // Runs created before the split stored whatever was typed. Dropping it
    // would lose the only record of when the appointment was.
    expect(describeAppointment('next Tuesday at half ten')).toBe('next Tuesday at half ten');
    expect(describeAppointment('')).toBe('');
  });

  it('rejects an impossible date rather than inventing a month', () => {
    expect(describeAppointment('2026-13-45T10:30')).toBe('2026-13-45T10:30');
  });

  it('is what the reminder brief actually speaks', () => {
    const template = getBusinessTemplate('appointment_reminder');
    const lines = template!.goalLines({
      businessName: 'Acme Dental',
      contactName: 'Sarah',
      context: { appointmentAt: '2026-08-25T10:30' },
    });
    const text = lines.join('\n');
    expect(text).toContain('Tuesday 25 August 2026 at 10:30');
    // The raw stored form must not survive into the call.
    expect(text).not.toContain('2026-08-25T10:30');
  });
});

describe('countries', () => {
  it('carries dialling codes of one, two and three digits', () => {
    // The reason the old two-character input was wrong: +1, +44 and +971 are
    // all real, and a field capped at two digits cannot hold the last one.
    expect(dialCodeFor('US')).toBe('+1');
    expect(dialCodeFor('GB')).toBe('+44');
    expect(dialCodeFor('AE')).toBe('+971');
  });

  it('lists every country with a name and a code', () => {
    const countries = listCountries('en');
    expect(countries.length).toBe(Object.keys(COUNTRY_DIAL_CODES).length);
    const uae = countries.find((c) => c.code === 'AE');
    expect(uae).toEqual({ code: 'AE', name: 'United Arab Emirates', dialCode: '971' });
    expect(countries.every((c) => c.name.length > 0 && c.dialCode.length > 0)).toBe(true);
  });

  it('sorts by name so a dropdown is scannable', () => {
    const names = listCountries('en').map((c) => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
  });

  it('returns nothing for a region it does not know', () => {
    expect(dialCodeFor('ZZ')).toBeNull();
    expect(dialCodeFor(null)).toBeNull();
  });
});

describe('what a run has to be told', () => {
  /**
   * The quick-run panel on Contacts posted one free-text box into
   * `contextFields[0]`, whatever that field happened to be. These pin why
   * that could never be right.
   */
  it('does not have one shared shape across templates', () => {
    const shapes = BUSINESS_WORKFLOW_TEMPLATES.map((t) => ({
      id: t.id,
      first: t.contextFields[0]?.id ?? null,
      type: t.contextFields[0]?.type ?? null,
    }));

    const reminder = shapes.find((s) => s.id === 'appointment_reminder');
    const callback = shapes.find((s) => s.id === 'lead_callback');
    const custom = shapes.find((s) => s.id === 'general_followup');

    // A date box aimed at the first field lands on a date here...
    expect(reminder).toMatchObject({ first: 'appointmentAt', type: 'datetime' });
    // ...on "what they enquired about" here, which is not a date at all...
    expect(callback).toMatchObject({ first: 'service', type: 'text' });
    // ...and nowhere here, so the text was silently dropped.
    expect(custom!.first).toBeNull();
  });

  it('marks the appointment time as required, and the rest as optional', () => {
    const reminder = getBusinessTemplate('appointment_reminder')!;
    const appointment = reminder.contextFields.find((f) => f.id === 'appointmentAt');
    expect(appointment).toMatchObject({ required: true, type: 'datetime' });
    expect(reminder.contextFields.filter((f) => f.required)).toHaveLength(1);

    // Nothing about a callback is required, so a run can start with none of it.
    const callback = getBusinessTemplate('lead_callback')!;
    expect(callback.contextFields.filter((f) => f.required)).toHaveLength(0);
  });
});

describe('what CALL-E can actually do', () => {
  /**
   * The provider places calls; it cannot answer them. Its API is eight
   * endpoints, every one of which starts from a recipient Dial supplies --
   * there is no number provisioning, no inbound routing, no incoming event.
   * An "AI front desk" template used to sit in this list, greyed out. A
   * feature nothing can implement should not be offered at all.
   */
  it('offers no inbound template', () => {
    expect(getBusinessTemplate('front_desk')).toBeNull();
    expect(BUSINESS_WORKFLOW_TEMPLATES.every((t) => t.direction === 'outbound')).toBe(true);
  });

  it('offers exactly the three jobs that can run', () => {
    expect(BUSINESS_WORKFLOW_TEMPLATES.map((t) => t.id).sort()).toEqual([
      'appointment_reminder',
      'general_followup',
      'lead_callback',
    ]);
  });
});

describe('filling in a date and a time', () => {
  /**
   * The stored value has to survive a half-filled answer.
   *
   * It could not: composing returned '' unless both halves were present, and
   * the two inputs read what they displayed back out of that value. Entering
   * a date -- which you can only do before entering a time -- composed to '',
   * the controlled input reset, and the date vanished as it was typed.
   * Neither box could ever hold anything.
   */
  it('keeps a date entered before any time', () => {
    const afterDate = composeAppointmentValue('2026-08-25', '');
    expect(afterDate).not.toBe('');
    // The date input reads this back and must still show what was typed.
    expect(splitAppointmentValue(afterDate)[0]).toBe('2026-08-25');
    expect(splitAppointmentValue(afterDate)[1]).toBe('');
  });

  it('keeps a time entered before any date', () => {
    const afterTime = composeAppointmentValue('', '10:30');
    expect(afterTime).not.toBe('');
    expect(splitAppointmentValue(afterTime)).toEqual(['', '10:30']);
  });

  it('survives the whole sequence a person actually types', () => {
    // Empty -> pick a date -> pick a time, reading the value back between
    // each step exactly as the controlled inputs do.
    let value = '';
    expect(splitAppointmentValue(value)).toEqual(['', '']);

    let [date, time] = splitAppointmentValue(value);
    value = composeAppointmentValue('2026-08-25', time);
    [date, time] = splitAppointmentValue(value);
    expect(date).toBe('2026-08-25');
    expect(isCompleteAppointment(value)).toBe(false);

    value = composeAppointmentValue(date, '10:30');
    [date, time] = splitAppointmentValue(value);
    expect([date, time]).toEqual(['2026-08-25', '10:30']);
    expect(isCompleteAppointment(value)).toBe(true);
    expect(describeAppointment(value)).toBe('Tuesday 25 August 2026 at 10:30');
  });

  it('lets either half be changed afterwards without losing the other', () => {
    const value = composeAppointmentValue('2026-08-25', '10:30');
    const [, time] = splitAppointmentValue(value);
    const movedDay = composeAppointmentValue('2026-08-26', time);
    expect(splitAppointmentValue(movedDay)).toEqual(['2026-08-26', '10:30']);

    const [date] = splitAppointmentValue(movedDay);
    const movedTime = composeAppointmentValue(date, '14:00');
    expect(splitAppointmentValue(movedTime)).toEqual(['2026-08-26', '14:00']);
  });

  it('clears to empty only when both halves are cleared', () => {
    expect(composeAppointmentValue('', '')).toBe('');
    expect(composeAppointmentValue('2026-08-25', '')).not.toBe('');
  });

  it('does not call a half-filled answer complete', () => {
    expect(isCompleteAppointment('')).toBe(false);
    expect(isCompleteAppointment('2026-08-25T')).toBe(false);
    expect(isCompleteAppointment('T10:30')).toBe(false);
    expect(isCompleteAppointment('2026-08-25T10:30')).toBe(true);
  });
});

describe('typing a date on a phone', () => {
  /**
   * React Native has no native date input, so the phone collects this as
   * text. Free text that ends up read out on a real call has to be shaped on
   * the way in and checked before it can be submitted.
   */
  it('inserts the separators as digits arrive', () => {
    expect(maskAppointmentDate('2026')).toBe('2026');
    expect(maskAppointmentDate('202608')).toBe('2026-08');
    expect(maskAppointmentDate('20260825')).toBe('2026-08-25');
    expect(maskAppointmentTime('10')).toBe('10');
    expect(maskAppointmentTime('1030')).toBe('10:30');
  });

  it('ignores anything that is not a digit, and stops at full length', () => {
    expect(maskAppointmentDate('abc')).toBe('');
    expect(maskAppointmentDate('2026-08-25')).toBe('2026-08-25');
    expect(maskAppointmentDate('202608251234')).toBe('2026-08-25');
    expect(maskAppointmentTime('10:30:59')).toBe('10:30');
  });

  it('does not accept a date that only looks like one', () => {
    // Pasting "25/08/2026" masks to this. It matches the pattern and is not
    // a date; shape-only checking sent it to the server to be rejected there.
    expect(isCompleteAppointment('2508-20-26T10:30')).toBe(false);
    expect(isCompleteAppointment('2026-13-01T10:30')).toBe(false);
    expect(isCompleteAppointment('2026-02-30T10:30')).toBe(false);
    expect(isCompleteAppointment('2026-08-25T25:00')).toBe(false);
    expect(isCompleteAppointment('2026-08-25T10:60')).toBe(false);
  });

  it('knows which Februaries have 29 days', () => {
    expect(isCompleteAppointment('2024-02-29T10:30')).toBe(true);
    expect(isCompleteAppointment('2026-02-29T10:30')).toBe(false);
  });
});

describe('typing the date one character at a time', () => {
  /**
   * The phone has no date control, so it types into a plain text field and
   * every keystroke produces an UNFINISHED value. Reading the halves back by
   * matching them against the finished YYYY-MM-DD pattern meant none of those
   * matched: each keystroke stored, read back as empty, and the field wiped
   * itself as it was typed. The web never saw it because an
   * input[type=date] only ever emits a whole date.
   */
  function typeInto(half: 'date' | 'time', value: string, characters: string): string {
    let current = value;
    for (const character of characters) {
      const [date, time] = splitAppointmentValue(current);
      current =
        half === 'date'
          ? composeAppointmentValue(maskAppointmentDate(date + character), time)
          : composeAppointmentValue(date, maskAppointmentTime(time + character));
    }
    return current;
  }

  it('keeps every character as it is typed', () => {
    const afterDate = typeInto('date', '', '20260825');
    expect(splitAppointmentValue(afterDate)[0]).toBe('2026-08-25');

    const afterTime = typeInto('time', afterDate, '1030');
    expect(splitAppointmentValue(afterTime)).toEqual(['2026-08-25', '10:30']);
    expect(isCompleteAppointment(afterTime)).toBe(true);
    expect(describeAppointment(afterTime)).toBe('Tuesday 25 August 2026 at 10:30');
  });

  it('shows a part-typed date rather than swallowing it', () => {
    expect(splitAppointmentValue(typeInto('date', '', '2'))[0]).toBe('2');
    expect(splitAppointmentValue(typeInto('date', '', '20260'))[0]).toBe('2026-0');
    // ...and does not call any of it a finished answer.
    expect(isCompleteAppointment(typeInto('date', '', '20260'))).toBe(false);
  });

  it('does not lose the time while the date is being edited', () => {
    const full = composeAppointmentValue('2026-08-25', '10:30');
    const [, time] = splitAppointmentValue(full);
    const rubbedOut = composeAppointmentValue(maskAppointmentDate('2026-08-2'), time);
    expect(splitAppointmentValue(rubbedOut)).toEqual(['2026-08-2', '10:30']);
  });

  it('still reads a value the web wrote, and one an old run stored', () => {
    expect(splitAppointmentValue('2026-08-25T10:30')).toEqual(['2026-08-25', '10:30']);
    // Runs created before the split field stored free text with a space.
    expect(splitAppointmentValue('2026-08-25 10:30 AM')).toEqual(['2026-08-25', '10:30 AM']);
    // Which is not a finished answer, whatever it looks like.
    expect(isCompleteAppointment('2026-08-25 10:30 AM')).toBe(false);
  });
});
