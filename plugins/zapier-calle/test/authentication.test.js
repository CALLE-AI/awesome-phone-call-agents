import { describe, it, expect } from 'vitest';
import { addBearerHeader, checkForErrors, baseUrl } from '../lib/client.js';

describe('addBearerHeader', () => {
  it('adds a bearer header from authData', () => {
    const request = { headers: {} };
    const out = addBearerHeader(request, null, { authData: { apiKey: 'k1' } });
    expect(out.headers.Authorization).toBe('Bearer k1');
  });

  it('leaves the request alone when no key is present', () => {
    const out = addBearerHeader({ headers: {} }, null, { authData: {} });
    expect(out.headers.Authorization).toBeUndefined();
  });
});

describe('baseUrl', () => {
  it('defaults to the production API', () => {
    expect(baseUrl({ authData: {} })).toBe('https://api.heycall-e.com');
  });

  it('honours an explicit override', () => {
    expect(baseUrl({ authData: { baseUrl: 'http://127.0.0.1:9' } })).toBe('http://127.0.0.1:9');
  });
});

describe('checkForErrors', () => {
  it('passes a 2xx response through', () => {
    const response = { status: 200, content: '{}', request: { url: 'https://api.heycall-e.com/v1/goals' } };
    expect(checkForErrors(response)).toBe(response);
  });

  it('throws a friendly error on 401', () => {
    const response = { status: 401, content: '{"error":{"message":"bad key"}}', request: { url: 'x' } };
    expect(() => checkForErrors(response)).toThrow(/API key/);
  });

  it('masks phone numbers in error text', () => {
    const response = {
      status: 400,
      content: '{"error":{"message":"Invalid number +15550123456"}}',
      request: { url: 'x' },
    };
    expect(() => checkForErrors(response)).toThrow(/\+1\*+3456/);
    expect(() => checkForErrors(response)).not.toThrow(/0123456/);
  });

  it('redacts the API key if the upstream error echoes it', () => {
    const response = {
      status: 401,
      content: JSON.stringify({ error: { message: 'Invalid key calle_live_secret123' } }),
      request: { url: 'x' },
    };
    expect(() => checkForErrors(response, null, { authData: { apiKey: 'calle_live_secret123' } }))
      .toThrow(/\[redacted\]/);
    expect(() => checkForErrors(response, null, { authData: { apiKey: 'calle_live_secret123' } }))
      .not.toThrow(/calle_live_secret123/);
  });

  it('still works when no bundle is supplied', () => {
    const response = { status: 500, content: '{}', request: { url: 'x' } };
    expect(() => checkForErrors(response)).toThrow(/500/);
  });

  it('surfaces call_not_ready questions instead of a generic 422', () => {
    const response = {
      status: 422,
      content: JSON.stringify({
        error: {
          code: 'call_not_ready',
          message: 'Call task creation was rejected.',
          details: { questions: ['Should this call be placed in Vietnamese?'], region: 'VN' },
        },
      }),
      request: { url: 'x' },
    };
    expect(() => checkForErrors(response)).toThrow(/Vietnamese/);
    expect(() => checkForErrors(response)).toThrow(/Region/);
  });

  it('handles call_not_ready with no questions array', () => {
    const response = {
      status: 422,
      content: JSON.stringify({ error: { code: 'call_not_ready', message: 'Needs more detail.' } }),
      request: { url: 'x' },
    };
    expect(() => checkForErrors(response)).toThrow(/Needs more detail/);
  });

  it('caps the questions text', () => {
    const response = {
      status: 422,
      content: JSON.stringify({
        error: { code: 'call_not_ready', details: { questions: ['q'.repeat(2000)] } },
      }),
      request: { url: 'x' },
    };
    let message = '';
    try { checkForErrors(response); } catch (error) { message = error.message; }
    expect(message.length).toBeLessThan(900);
  });

  it('masks a phone number appearing in a clarification question', () => {
    const response = {
      status: 422,
      content: JSON.stringify({
        error: { code: 'call_not_ready', details: { questions: ['Is +15550123456 correct?'] } },
      }),
      request: { url: 'x' },
    };
    expect(() => checkForErrors(response)).toThrow(/\+1\*+3456/);
    expect(() => checkForErrors(response)).not.toThrow(/0123456/);
  });
});
