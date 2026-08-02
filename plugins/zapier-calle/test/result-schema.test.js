import { describe, it, expect } from 'vitest';
import { parseResultSchema } from '../lib/result-schema.js';

describe('parseResultSchema', () => {
  it('accepts a supported schema', () => {
    const raw = {
      type: 'object',
      properties: { acknowledged: { type: 'string', enum: ['yes', 'no', 'unknown'] } },
      required: ['acknowledged'],
      additionalProperties: false,
    };
    expect(parseResultSchema(raw)).toEqual({ schema: raw, errors: [] });
  });

  it('parses a JSON string', () => {
    const { schema, errors } = parseResultSchema('{"type":"object","properties":{}}');
    expect(errors).toEqual([]);
    expect(schema.type).toBe('object');
  });

  it('treats empty input as no schema', () => {
    expect(parseResultSchema(null)).toEqual({ schema: null, errors: [] });
    expect(parseResultSchema('')).toEqual({ schema: null, errors: [] });
    expect(parseResultSchema('   ')).toEqual({ schema: null, errors: [] });
  });

  it('reports invalid JSON', () => {
    const { errors } = parseResultSchema('{not json');
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/valid JSON/);
  });

  it('rejects unsupported composition keywords wherever they appear', () => {
    for (const keyword of ['$ref', 'oneOf', 'anyOf', 'allOf']) {
      const { errors } = parseResultSchema({
        type: 'object',
        properties: { field: { [keyword]: [] } },
      });
      expect(errors.join(' ')).toContain(keyword);
    }
  });

  it('rejects additionalProperties: true', () => {
    const { errors } = parseResultSchema({ type: 'object', additionalProperties: true });
    expect(errors.join(' ')).toContain('additionalProperties');
  });

  it('rejects a non-object root schema', () => {
    const { errors } = parseResultSchema({ type: 'string' });
    expect(errors.join(' ')).toContain('root');
  });

  it('collects several errors at once', () => {
    const { errors } = parseResultSchema({
      type: 'object',
      additionalProperties: true,
      properties: { a: { $ref: '#/x' } },
    });
    expect(errors.length).toBeGreaterThan(1);
  });
});
