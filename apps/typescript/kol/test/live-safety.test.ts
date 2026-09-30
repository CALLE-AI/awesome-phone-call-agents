import assert from 'node:assert/strict';
import test from 'node:test';
import { runLiveCall } from '../src/calle.ts';

test('invalid +1 destination lengths are rejected before any network request', async () => {
  const previousKey = process.env.CALLE_API_KEY;
  const previousBase = process.env.CALLE_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.CALLE_API_KEY = 'offline-test-placeholder';
  delete process.env.CALLE_BASE_URL;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Network disabled in test'); };
  try {
    for (const to of ['+12025550', '+120255501000']) {
      await assert.rejects(runLiveCall({ to, authorisedDestination: to, claimReference: 'TEST-1', expectedDepartment: 'fictional claims' }), /ten national digits/);
    }
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.CALLE_API_KEY; else process.env.CALLE_API_KEY = previousKey;
    if (previousBase === undefined) delete process.env.CALLE_BASE_URL; else process.env.CALLE_BASE_URL = previousBase;
  }
});
