import { describe, it, expect } from 'vitest';
import { CALL_FAMILIES, CALL_FAMILY_IDS, TASK_FAMILY_TO_CALL_FAMILY } from '../call-families.js';
import { assertCalleSchemaSupported, assertNoReservedRecipientFields } from '../calle-schema.js';
import { TASK_FAMILIES } from '../task.js';

describe('every shipped result schema stays inside the CALL-E subset', () => {
  for (const id of CALL_FAMILY_IDS) {
    it(`${id} uses only supported JSON Schema`, () => {
      expect(() => assertCalleSchemaSupported(CALL_FAMILIES[id].resultSchema)).not.toThrow();
    });

    it(`${id} avoids CALL-E's reserved recipient field names`, () => {
      expect(() => assertNoReservedRecipientFields(CALL_FAMILIES[id].resultSchema)).not.toThrow();
    });
  }
});

describe('assertCalleSchemaSupported', () => {
  it('rejects $ref, which is what a Zod-generated schema would emit', () => {
    expect(() => assertCalleSchemaSupported({ $ref: '#/x' } as never)).toThrow(/\$ref/);
  });

  it('rejects anyOf/oneOf', () => {
    expect(() => assertCalleSchemaSupported({ anyOf: [] } as never)).toThrow(/anyOf/);
  });

  it('rejects additionalProperties:true', () => {
    expect(() =>
      assertCalleSchemaSupported({ type: 'object', properties: {}, additionalProperties: true }),
    ).toThrow(/additionalProperties/);
  });

  it('rejects a required entry with no matching property', () => {
    expect(() =>
      assertCalleSchemaSupported({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] }),
    ).toThrow(/required lists "b"/);
  });

  it('catches an unsupported keyword nested deep inside', () => {
    expect(() =>
      assertCalleSchemaSupported({
        type: 'object',
        properties: { outer: { type: 'object', properties: { inner: { format: 'date-time' } as never } } },
      }),
    ).toThrow(/format/);
  });
});

describe('result parsing', () => {
  it('returns null for a null structured_result rather than an empty object', () => {
    expect(CALL_FAMILIES.repair_quote.parse(null)).toBeNull();
  });

  it('never turns a missing answer into a positive one', () => {
    const parsed = CALL_FAMILIES.repair_quote.parse({ confidence: 'low', evidence_summary: 'unclear' });
    expect(parsed?.can_repair).toBe('unknown');
  });

  it('coerces an out-of-range enum to unknown instead of trusting it', () => {
    const parsed = CALL_FAMILIES.repair_quote.parse({
      can_repair: 'probably',
      confidence: 'high',
      evidence_summary: 'x',
    });
    expect(parsed?.can_repair).toBe('unknown');
  });

  it('keeps a genuine yes', () => {
    const parsed = CALL_FAMILIES.repair_quote.parse({
      can_repair: 'yes',
      quoted_price: 89,
      currency: 'EUR',
      confidence: 'high',
      evidence_summary: 'They said 89 euro, same day.',
    });
    expect(parsed?.can_repair).toBe('yes');
    expect(parsed?.quoted_price).toBe(89);
  });

  it('rejects a non-object payload', () => {
    expect(CALL_FAMILIES.general_inquiry.parse('yes')).toBeNull();
    expect(CALL_FAMILIES.general_inquiry.parse(42)).toBeNull();
  });
});

describe('task family mapping', () => {
  it('maps every task family to a real call family', () => {
    for (const family of TASK_FAMILIES) {
      expect(CALL_FAMILY_IDS).toContain(TASK_FAMILY_TO_CALL_FAMILY[family]);
    }
  });
});
