const { maskPhone, maskDeep } = require('../src/mask');

describe('maskPhone', () => {
  test('keeps the leading + and last two digits, masks the rest', () => {
    expect(maskPhone('+15550100')).toBe('+•••••00');
    expect(maskPhone('+919167473850')).toBe('+•••••50');
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
      tasks: [
        {
          id: 'task_1',
          suppliers: [{ name: 'Acme Corp', phone: '+15550100' }]
        }
      ],
      quotes: [{ quote_id: 'q_1', phone: '+15550100' }],
      activityLog: [
        {
          tool: 'place_call',
          args: { id: 'task_1' },
          result: { recipients: { phones: ['+15550100'] } }
        }
      ]
    };

    const masked = maskDeep(input);

    expect(masked.tasks[0].suppliers[0].phone).toBe('+•••••00');
    expect(masked.quotes[0].phone).toBe('+•••••00');
    expect(masked.activityLog[0].result.recipients.phones[0]).toBe('+•••••00');
    // Untouched fields survive the pass unchanged.
    expect(masked.tasks[0].suppliers[0].name).toBe('Acme Corp');
    expect(masked.tasks[0].id).toBe('task_1');
  });

  test('scrubs a known number if it reappears verbatim in unrelated free text (e.g. a call summary)', () => {
    const input = {
      tasks: [
        {
          id: 'task_1',
          suppliers: [{ name: 'Acme Corp', phone: '+15550100' }],
          outcome: { summary: 'Reached Acme Corp at +15550100 and got a quote.' }
        }
      ]
    };

    const masked = maskDeep(input);

    expect(masked.tasks[0].outcome.summary).toBe('Reached Acme Corp at +•••••00 and got a quote.');
    expect(masked.tasks[0].outcome.summary).not.toContain('5550100');
  });

  test('leaves unrelated numeric text (prices, SKUs, timestamps) untouched', () => {
    const input = {
      tasks: [{ id: 'task_1', suppliers: [{ phone: '+15550100' }] }],
      quotes: [{ price_per_unit: 12.5, sku: 'WIDGET-42', quote_id: 'q_100' }]
    };

    const masked = maskDeep(input);

    expect(masked.quotes[0].price_per_unit).toBe(12.5);
    expect(masked.quotes[0].sku).toBe('WIDGET-42');
    expect(masked.quotes[0].quote_id).toBe('q_100');
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
