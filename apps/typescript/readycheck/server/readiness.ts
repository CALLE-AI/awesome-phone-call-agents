import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config';

export function liveReadiness(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);
  const checks: { id: string; passed: boolean; detail: string }[] = [];
  const add = (id: string, passed: boolean, detail: string) => checks.push({ id, passed, detail });
  add(
    'settings',
    !config.configError,
    config.configError || 'Calling hours, recipients, and limits are valid.',
  );
  add(
    'enabled',
    config.enabled,
    config.enabled
      ? 'Live calling is enabled.'
      : 'Set LIVE_CALLS_ENABLED=true when ready for controlled testing.',
  );
  add(
    'credential',
    !!config.apiKey,
    config.apiKey
      ? 'A server key is present; provider authentication has not been tested.'
      : 'Set CALLE_API_KEY locally.',
  );
  add(
    'recipients',
    config.recipients.length > 0,
    `${config.recipients.length} consenting test recipient(s) configured. Consent references are declarations, not independently verified consent.`,
  );
  let originValid = false;
  try {
    const url = new URL(env.APP_ORIGIN || 'http://localhost:3000');
    originValid =
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch {
    /* Invalid origin remains blocked. */
  }
  add(
    'origin',
    originValid,
    originValid
      ? 'App origin uses HTTPS or local loopback HTTP.'
      : 'Set APP_ORIGIN to the app origin using HTTPS, or HTTP on localhost.',
  );
  let registered = 0,
    databaseReadable = false;
  const path = env.DATABASE_PATH || './data/readycheck.sqlite';
  if (path !== ':memory:' && existsSync(path)) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const lookup = db.prepare('SELECT id FROM users WHERE id=? AND guest=0');
      registered = [...new Set(config.users)].filter((id) => !!lookup.get(id)).length;
      databaseReadable = true;
    } catch {
      /* Never print SQLite errors that can contain private paths/data. */
    } finally {
      db?.close();
    }
  }
  add(
    'database',
    databaseReadable,
    databaseReadable
      ? 'Persistent app database can be read.'
      : 'Start the app with a persistent database and create an account first.',
  );
  add(
    'accounts',
    config.users.length > 0 && registered === new Set(config.users).size,
    `${registered} of ${new Set(config.users).size} authorized account IDs match registered users. Copy IDs from Connection; email addresses do not grant calling access.`,
  );
  return {
    ready: checks.every((check) => check.passed),
    networkUsed: false,
    callsPlaced: 0,
    checks,
    nextStep:
      'After configuration passes, restart the app, sign in, review one recipient and approve the exact plan in the interface. This check does not verify CALL-E authentication, available credits, current calling hours, or provider behavior.',
  };
}
