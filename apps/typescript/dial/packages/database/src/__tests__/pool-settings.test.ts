import { describe, it, expect } from 'vitest';
import { poolSettings } from '../client.js';

/**
 * Connecting to a database across a network, rather than to one in the same
 * process. These pin the three things that differ.
 */

const NEON = 'postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

describe('connecting to a managed postgres', () => {
  it('waits long enough for a suspended database to wake', () => {
    // Neon suspends compute when idle and takes seconds to resume.
    // node-postgres defaults to no connect timeout at all, so without this a
    // wake-up either succeeds or hangs with nothing to report.
    const settings = poolSettings(NEON);
    expect(settings.connectionTimeoutMillis).toBeGreaterThanOrEqual(10_000);
  });

  it('retires idle connections and keeps the rest alive', () => {
    // A pooler or a NAT drops a quiet connection, and a pool that does not
    // know that hands out the dead one on the next request.
    const settings = poolSettings(NEON);
    expect(settings.idleTimeoutMillis).toBeGreaterThan(0);
    expect(settings.keepAlive).toBe(true);
  });

  it('leaves room for a second process inside a small connection budget', () => {
    // The API and the worker each open their own pool.
    const settings = poolSettings(NEON);
    expect(settings.max).toBeLessThanOrEqual(10);
    expect(settings.max * 2).toBeLessThan(20);
  });

  it('leaves TLS to the driver unless asked not to verify', () => {
    // pg reads sslmode from the URL itself; overriding it here would silently
    // weaken a connection the URL asked to be verified.
    expect(poolSettings(NEON).ssl).toBeUndefined();
    expect(poolSettings('postgresql://u:p@host/db').ssl).toBeUndefined();
  });

  it('honours sslmode=no-verify, for a chain pg would otherwise reject', () => {
    // pg 8 treats `require` as `verify-full`. A provider without a publicly
    // trusted certificate needs an explicit way to say "encrypt, do not
    // verify" -- otherwise the only workaround is disabling TLS entirely.
    expect(poolSettings('postgresql://u:p@host/db?sslmode=no-verify').ssl).toEqual({
      rejectUnauthorized: false,
    });
    expect(poolSettings('postgresql://u:p@host/db?a=1&sslmode=no-verify').ssl).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('passes the connection string through untouched', () => {
    // Providers put meaningful parameters in there (channel binding, endpoint
    // ids); rebuilding the string would drop them.
    expect(poolSettings(NEON).connectionString).toBe(NEON);
  });
});
