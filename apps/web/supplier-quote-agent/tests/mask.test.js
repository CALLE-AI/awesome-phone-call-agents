const { maskPhone, maskDeep } = require('../src/mask');

// Every phone number in this file is reserved for fiction (NANP 555-01xx in a geographic
// area code, or an Ofcom drama range — see src/fictional-numbers.js). The other digit runs
// are non-phone fixtures (sequential digits, a documentation IBAN, dates) and are listed in
// tests/fixtures/non-phone-digit-runs.json. A leak is asserted by digit fragment, not by one
// exact spelling, because a leak is any spelling of it.

describe('maskPhone', () => {
  test('keeps the leading + and last two digits, masks the rest', () => {
    expect(maskPhone('+15550100')).toBe('+•••••00');
    expect(maskPhone('+447700900123')).toBe('+•••••23');
  });

  test('passes through non-string input untouched', () => {
    expect(maskPhone(undefined)).toBeUndefined();
    expect(maskPhone(null)).toBeNull();
  });

  test('masks a too-short value entirely rather than leaking digits', () => {
    expect(maskPhone('12')).toBe('••');
  });
});

describe('maskDeep', () => {
  test('masks phone and phones fields anywhere in a nested structure', () => {
    const input = {
      tasks: [{ id: 'task_1', suppliers: [{ name: 'Acme Corp', phone: '+15550100' }] }],
      quotes: [{ quote_id: 'q_1', phone: '+15550100' }],
      activityLog: [{ tool: 'place_call', args: { id: 'task_1' }, result: { recipients: { phones: ['+15550100'] } } }]
    };

    const masked = maskDeep(input);

    expect(masked.tasks[0].suppliers[0].phone).toBe('+•••••00');
    expect(masked.quotes[0].phone).toBe('+•••••00');
    expect(masked.activityLog[0].result.recipients.phones[0]).toBe('+•••••00');
    expect(masked.tasks[0].suppliers[0].name).toBe('Acme Corp');
    expect(masked.tasks[0].id).toBe('task_1');
  });

  test('scrubs a known number if it reappears verbatim in unrelated free text (e.g. a call summary)', () => {
    const masked = maskDeep({
      tasks: [{ id: 'task_1', suppliers: [{ phone: '+15550100' }], outcome: { summary: 'Reached Acme Corp at +15550100 and got a quote.' } }]
    });
    expect(masked.tasks[0].outcome.summary).toBe('Reached Acme Corp at +•••••00 and got a quote.');
  });

  test('never mutates the original object', () => {
    const input = { phone: '+15550100' };
    const masked = maskDeep(input);
    expect(input.phone).toBe('+15550100');
    expect(masked.phone).toBe('+•••••00');
  });

  test('passes through primitives and null unchanged', () => {
    expect(maskDeep(null)).toBeNull();
    expect(maskDeep('hello')).toBe('hello');
    expect(maskDeep(42)).toBe(42);
  });
});

describe('maskDeep — a known number however it is written (#524 item 2)', () => {
  const LONDON = '+442079460958';
  const MOBILE = '+447700900123';
  const NANP = '+12025550147';
  const summaryFor = (phone, summary) => maskDeep({ suppliers: [{ phone }], outcome: { summary } }).outcome.summary;

  test.each([
    ['grouped international', LONDON, 'Reached them on +44 20 7946 0958 today.', '7946'],
    ['international with (0)', LONDON, 'Their switchboard: +44 (0)20 7946 0958.', '7946'],
    ['national trunk form', LONDON, 'Call back on 020 7946 0958 after 3pm.', '7946'],
    ['national, bracketed', LONDON, 'Try (020) 7946-0958 instead.', '7946'],
    ['dotted', LONDON, 'Number given as 020.7946.0958 on the call.', '7946'],
    ['00 prefix, compact', LONDON, 'Their London desk: 00442079460958.', '7946'],
    ['00 prefix, spaced', LONDON, 'Their London desk: 0044 20 7946 0958.', '7946'],
    ['zero-width spaces', LONDON, 'Their desk: 020\u200B7946\u200B0958.', '7946'],
    ['soft hyphens', LONDON, 'Their desk: 020\u00AD7946\u00AD0958.', '7946'],
    ['Devanagari digits', LONDON, 'Desk: \u0966\u0968\u0966 \u096D\u096F\u096A\u096C \u0966\u096F\u096B\u096E.', '\u096D\u096F\u096A\u096C'],
    ['national mobile, grouped 5-6', MOBILE, 'Mobile is 07700 900123, ask for Sam.', '900123'],
    ['no country code, no trunk', MOBILE, 'They read out 7700 900 123.', '900 123'],
    ['NANP punctuated', NANP, 'Reach them at (202) 555-0147.', '555-0147'],
    ['NANP bare local', NANP, 'Direct line 555-0147.', '555-0147'],
    ['unicode dashes', NANP, 'Reach them at 202\u2011555\u20110147.', '0147'],
    ['fullwidth digits', NANP, 'Reach them at \uFF12\uFF10\uFF12\uFF15\uFF15\uFF15\uFF10\uFF11\uFF14\uFF17.', '\uFF10\uFF11\uFF14\uFF17']
  ])('%s', (_label, phone, summary, leakedFragment) => {
    const masked = summaryFor(phone, summary);
    expect(masked).not.toContain(leakedFragment);
    expect(masked).toMatch(/•••••\d\d/);
  });
});

describe('maskDeep — phone-named fields of any shape (#524 item 2)', () => {
  test('a phone-named key of any spelling is masked and joins the known set', () => {
    const masked = maskDeep({
      supplier_phone: '+442079460958',
      phoneNumber: '+447700900123',
      altPhones: ['+12025550147'],
      note: 'Backup numbers: 020 7946 0958 or 07700 900123 or 202-555-0147.'
    });
    expect(masked.supplier_phone).toBe('+•••••58');
    expect(masked.phoneNumber).toBe('+•••••23');
    expect(masked.altPhones).toEqual(['+•••••47']);
    expect(masked.note).toBe('Backup numbers: •••••58 or •••••23 or •••••47.');
  });

  test('nested and numeric values are masked and join the known set; labels survive', () => {
    const masked = maskDeep({
      contact: { phones: [{ label: 'office', number: '+442079460958' }] },
      supplier: { phone: { primary: '07700 900123' }, mobile: 447700900456 },
      note: 'Rang 020 7946 0958, then 07700 900123, then 07700 900456.'
    });
    expect(masked.contact.phones[0]).toEqual({ label: 'office', number: '+•••••58' });
    expect(masked.supplier.phone).toEqual({ primary: '•••••23' });
    expect(masked.supplier.mobile).toBe('•••••56');
    expect(masked.note).toBe('Rang •••••58, then •••••23, then •••••56.');
  });

  test('a timestamp about a phone is machinery, not a phone number', () => {
    const input = { phoneVerifiedAt: '2026-09-13', createdAt: '2026-09-13T10:15:30.000Z', note: 'Seen 2026-09-13.' };
    expect(maskDeep(input)).toEqual(input);
  });
});

// Free text is judged by shape, not by the words around it: every run of 7 or more digits
// joined by short separators is masked, except dates, times, prices, quantity lists and
// identifiers (below). These are the spellings the second review found leaking past the
// earlier word-based rules.
describe('maskDeep — phone numbers nobody declared, in free text (#524 item 2)', () => {
  test.each([
    ['NANP 3-3-4', 'Ring 202-555-0147 tomorrow.', '555-0147'],
    ['NANP, mixed separators', 'Please call Dana Whitfield, the regional sales manager, at 202 555-0147.', '555-0147'],
    ['NANP with country code', 'Sales desk 1 202 555 0147', '555 0147'],
    ['after a reference word', 'For orders: 202-555-0147', '555-0147'],
    ['after a department label', 'Accounts: 07700 900456', '900456'],
    ['after "Caller ID"', 'Caller ID: 0161 496 0123.', '496 01'],
    ['with a spaced extension', 'Call Dana at 202-555-0147 x 12 to confirm.', '555-0147'],
    ['with an attached extension', 'Direct: 2025550147ext204', '2025550147'],
    ['followed by hours', 'Reach Dave at 202-555-0147 M-F 9-5.', '555-0147'],
    ['UK trunk groups', 'Ask for Sam at 0161 496 0123.', '496 01'],
    ['UK trunk, Cardiff', 'Their office is 029 2018 0123', '2018 01'],
    ['UK mobile 5-6', 'Speak to Priya on 07700 900456 for pricing.', '900456'],
    ['cue word after the number', '07700 900456 is their mobile.', '900456'],
    ['compact trunk', 'Text me on 07700900456', '07700900456'],
    ['label glued with a dot', 'Tel.07700900456', '07700900456'],
    ['label glued with a hyphen', 'Tel-07700 900456', '900456'],
    ['00 international prefix', 'Ring 00447700900456', '7700900456'],
    ['00 prefix with (0)', 'Follow up with Sam at 0044 (0)20 7946 0958.', '7946'],
    ['011 international prefix', 'From the US dial 011 44 7700 900456', '900456'],
    ['next to an amount', 'USD 1250 (0161 496 0123)', '496 01'],
    ['after a time range', 'Hours 0900-1700 0161 496 0123', '496 01'],
    ['fullwidth digits', 'Rang \uFF10\uFF11\uFF16\uFF11 \uFF14\uFF19\uFF16 \uFF10\uFF11\uFF12\uFF13', '\uFF10\uFF11\uFF12\uFF13'],
    // Adversarial-review findings (third round, after the shape-only rule shipped): padding
    // with more separator chars than the run detector used to bridge split one number into
    // two sub-7-digit fragments, neither long enough to mask on its own.
    ['wide gap splits the run', 'Reach them at 202555    50147 for a quote.', '50147'],
    ['tab-widened gap', 'Reach them at 202555\t\t\t\t50147 for a quote.', '50147'],
    // An unbounded "amount after a currency sign" exclusion let a full number through
    // whenever it happened to follow a currency mark. (A currency word glued to the run
    // with zero space, "Rs2025550147", is a separate, accepted limitation — see the note by
    // RUN's own lookbehind: a run directly preceded by a letter is presumed to be part of a
    // longer identifier, the same rule the ids test above relies on.)
    ['currency sign glued to a full number', 'Total due is $2025550147 for the parts.', '550147'],
    // "Any word ending in a hyphen" or "any letter right after the run" used to read as an
    // identifier; only a capitalized prefix (SKU-, Q-) is one.
    ['ordinary word before, not an identifier prefix', 'Their direct-2025550147 line is open.', '550147'],
    ['a lowercase letter right after the run', 'Confirmed 2025550147pm as discussed.', '550147']
  ])('%s', (_label, text, leaked) => {
    const masked = maskDeep({ summary: text }).summary;
    expect(masked).not.toContain(leaked);
    expect(masked).toMatch(/•••••\d\d/);
  });

  test('an error echoing a number is masked, and so is the id it came in as', () => {
    const masked = maskDeep({ error: 'Task 0161 496 0123 not found', activity: { args: { id: '0161 496 0123' } } });
    expect(masked.error).toBe('Task •••••23 not found');
    expect(masked.activity.args.id).toBe('•••••23');
  });

  test('an error quoting a supplier number is masked', () => {
    const masked = maskDeep({ success: false, error: 'Supplier phone "+1 (202) 555-0199" is not a valid E.164 number' });
    expect(masked.error).toBe('Supplier phone "+•••••99" is not a valid E.164 number');
  });

  test.each([
    ['ids', { id: 'task_1789675337174_3', quote_id: 'q_1789675337175_4', callId: 'call_001' }],
    ['timestamps', { timestamp: '2026-09-13T10:15:30.000Z', createdAt: '2026-09-13T10:15:30.000Z' }],
    ['a structural enum', { status: 'completed', next_action: 'review_quote', sku: 'SKU-4471-B' }],
    ['prices and small quantities', { summary: 'Quoted $12.50 per unit, 1,250.00 total, MOQ 500, lead time 14 days.' }],
    ['a price with a currency sign', { summary: 'On the call they quoted $1234567 for the whole order.' }],
    ['a decimal', { summary: 'rate 1234567.50' }],
    ['quantity tiers as a "/" list', { summary: 'Tiers 100/500/1000 pcs, or 100 / 250 / 500 / 1000 units.' }],
    ['ISO dates', { summary: 'Call them back on 2026-09-13 or 13.09.2026 at 10:00.' }],
    ['a date and a clock time', { summary: 'Call scheduled 2026-09-13 10:00 local.' }],
    ['a US-order date', { summary: 'Ships on 09/15/2026.' }],
    ['a date range', { summary: 'Delivery window 15/09 - 20/09/2026, or 15/09/2026 - 20/09/2026.' }],
    ['a compact date', { summary: 'Called on 20260913 to confirm.' }],
    ['a spaced date', { summary: 'Call back 13 09 2026.' }],
    ['clock-time ranges', { summary: 'Callback window 0900-1700 or 1800-2000.' }],
    ['a letter-prefixed reference', { summary: 'On the call they gave quote Q-20260913-0147.' }],
    ['an identifier', { summary: 'SKU-1234567 is in stock.' }],
    ['a provider call id', { error: 'CALL-E call 3f2a1b4c-9d3e-4a5b-8123-456789abcdef did not reach a terminal state' }],
    ['a task id in an error', { error: 'Task task_1789675337174_3 not found' }]
  ])('leaves %s untouched', (_label, input) => {
    expect(maskDeep(input)).toEqual(input);
  });

  // The documented trade-off: a long reference or a quantity written as a bare digit run
  // looks like a phone number and is masked with it. The quote details a call returns are
  // asked for with thousands separators and currency symbols (RESULT_SCHEMA), which keep them.
  test.each([
    ['a purchase-order number', 'PO number 1234567890 was issued.'],
    ['a quote reference', 'On the call they gave quote number 20260913-0042.'],
    ['a quantity with no separators', 'On the call they confirmed an MOQ of 2500000.'],
    ['quantity tiers joined by hyphens', 'Tiers 250-500-1000 pcs'],
    ['a bank account number', 'Pay IBAN DE89 3704 0044 0532 0130 00']
  ])('masks %s (deliberate)', (_label, text) => {
    expect(maskDeep({ summary: text }).summary).toMatch(/•••••\d\d/);
  });
});

// The dashboard pre-fills its plan editor from a response and builds new plans from a
// task's sku, so both must come back byte-for-byte unless they hold a number that is
// unmistakably a phone.
describe('maskDeep — plan text and sku round-trip', () => {
  test('get only the unmistakable shapes', () => {
    const input = {
      suppliers: [{ phone: '+442079460958' }],
      sku: 'PART 1234567890',
      plan: {
        goal: 'Ask for tiers 250-500-1000 pcs; do not use 020 7946 0958 after hours, or +44 7700 900456 or 0044 7700 900789.',
        script_points: ['Give them order line 7700 900 777 when asked', 'Their office is 0161 496 0123'],
        fallback: 'Leave a message.'
      }
    };
    const masked = maskDeep(input);
    expect(masked.sku).toBe('PART 1234567890');
    expect(masked.plan.goal).toBe('Ask for tiers 250-500-1000 pcs; do not use •••••58 after hours, or +•••••56 or •••••89.');
    expect(masked.plan.script_points).toEqual(input.plan.script_points);
  });
});

describe('maskDeep — cost', () => {
  const hostile = [
    `${'1 '.repeat(50000)}1a`,
    `${'1-'.repeat(50000)}1x`,
    `(${'9'.repeat(50000)}`,
    `${'+ '.repeat(50000)}1`,
    `${'10 '.repeat(50000)}`,
    `${'15/09/2026 - '.repeat(10000)}x`,
    `${'0'.repeat(100000)}a`,
    `${'202-'.repeat(25000)}z`,
    `${'$1 '.repeat(50000)}`
  ];

  test.each(['summary', 'goal', 'sku', 'id'])('is linear on hostile input under %p', (key) => {
    const started = Date.now();
    for (const text of hostile) {
      maskDeep({ phone: '+442079460958', [key]: text });
    }
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test('scales with many known numbers', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => ({
      id: `task_${i}`,
      // Ofcom's London drama block, 020 7946 0000-0999.
      suppliers: [{ name: `S${i}`, phone: `+${442079460000 + i}` }],
      outcome: { summary: 'Quoted $12.50 per unit, lead time 7 days. Call back 2026-09-13. Rang 020 7946 0042.' }
    }));
    const log = Array.from({ length: 400 }, (_, i) => ({
      timestamp: '2026-09-13T10:15:30.000Z',
      args: { id: `task_${i % 100}`, goal: 'Get a quote for WIDGET-42 (qty 100)' }
    }));
    const started = Date.now();
    const masked = maskDeep({ tasks, log });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(masked.tasks[0].outcome.summary).toContain('Rang •••••42.');
  });
});
