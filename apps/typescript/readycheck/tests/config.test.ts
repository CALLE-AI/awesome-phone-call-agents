import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, connection } from '../server/config';
import { liveReadiness } from '../server/readiness';
import { Store } from '../server/store';
const user = { id: 'account-1', name: 'Test', email: 'test@example.test', guest: false };
const env = {
  CALLE_API_KEY: 'private-test-key',
  LIVE_CALLS_ENABLED: 'true',
  LIVE_USER_IDS: user.id,
  TEST_RECIPIENTS_JSON: JSON.stringify([
    {
      id: 'recipient-1',
      name: 'Private name',
      phone: '+12025550101',
      timezone: 'America/Chicago',
      consentRef: 'private-consent-ref',
    },
  ]),
};
describe('live setup validates without dispatch or secret disclosure', () => {
  it('accepts midnight and end-of-day hours', () => {
    const config = loadConfig({ ...env, CALL_WINDOW_START: '0', CALL_WINDOW_END: '24' });
    assert.equal(config.callStart, 0);
    assert.equal(config.callEnd, 24);
    assert.equal(connection(config, user).configured, true);
  });
  it('invalid limits, hours, and boolean values block live mode rather than silently enabling defaults', () => {
    for (const patch of [
      { MAX_CALLS_PER_DAY: '-1' },
      { MAX_CALLS_PER_USER_DAY: 'many' },
      { CALL_WINDOW_START: '24' },
      { CALL_WINDOW_START: '20', CALL_WINDOW_END: '9' },
      { TRANSCRIPT_RETENTION_DAYS: '0' },
      { LIVE_CALLS_ENABLED: 'yes' },
      { MAX_CALLS_PER_DAY: '99999999999999999999999999999' },
    ]) {
      const config = loadConfig({ ...env, ...patch });
      assert.ok(config.configError);
      assert.equal(connection(config, user).configured, false);
    }
  });
  it('readiness uses a read-only database and never reveals credentials or recipients', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readycheck-readiness-')),
      path = join(dir, 'test.sqlite');
    const store = new Store(path);
    try {
      store.db
        .prepare('INSERT INTO users VALUES(?,?,?,?,?,?)')
        .run(user.id, user.email, user.name, 'synthetic', 0, new Date().toISOString());
      const report = liveReadiness({ ...env, DATABASE_PATH: path });
      assert.equal(report.ready, true);
      assert.equal(report.networkUsed, false);
      assert.equal(report.callsPlaced, 0);
      for (const secret of [
        'private-test-key',
        'Private name',
        '+12025550101',
        'private-consent-ref',
        user.email,
      ])
        assert.equal(JSON.stringify(report).includes(secret), false);
      assert.equal(store.db.prepare('SELECT count(*) AS n FROM inquiries').get()!.n, 0);
      const missing = liveReadiness({ ...env, DATABASE_PATH: path, LIVE_USER_IDS: 'unknown-id' });
      assert.equal(missing.ready, false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('invalid public origins and missing databases produce actionable setup results', () => {
    const report = liveReadiness({
      ...env,
      DATABASE_PATH: ':memory:',
      APP_ORIGIN: 'http://public.example.test/path',
    });
    assert.equal(report.ready, false);
    assert.equal(report.checks.find((c) => c.id === 'origin')!.passed, false);
    assert.equal(report.checks.find((c) => c.id === 'database')!.passed, false);
  });
});
