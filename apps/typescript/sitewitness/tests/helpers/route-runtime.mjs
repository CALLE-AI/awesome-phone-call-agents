import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const env = { CALL_PROVIDER: 'fake', LIVE_CALLS_ENABLED: 'false', SITEWITNESS_BASIC_USER: 'test-reviewer', SITEWITNESS_BASIC_PASSWORD: 'test-password-not-a-real-secret' };
export function authorizedRequest(url = 'https://demo.test/api', init = {}) {
  const target = new URL(url); target.protocol = 'https:';
  return new Request(target, { ...init, headers: { authorization: 'Basic ' + Buffer.from(env.SITEWITNESS_BASIC_USER + ':' + env.SITEWITNESS_BASIC_PASSWORD).toString('base64'), ...init.headers } });
}
globalThis.__sitewitnessTestEnv = env;
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export const env=globalThis.__sitewitnessTestEnv;', shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(url)) && existsSync(fileURLToPath(url) + '.ts')) return { url: url.href + '.ts', shortCircuit: true };
  }
  return next(specifier, context);
} });
export function database() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { sqlite, failBatch: false, prepare(sql) {
    const statement = { sql, args: [], bind(...args) { this.args=args; return this; },
      async run() { const r=sqlite.prepare(sql).run(...this.args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      async first() { return sqlite.prepare(sql).get(...this.args) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...this.args) }; } };
    return statement;
  }, async batch(statements) {
    if (db.failBatch && statements.some(s=>s.sql.includes('INSERT OR IGNORE INTO ingested_statements'))) { db.failBatch=false; throw new Error('test storage outage'); }
    sqlite.exec('BEGIN');
    try { const results=[]; for(const s of statements) { const r=sqlite.prepare(s.sql).run(...s.args); results.push({ results: [], meta: { changes:Number(r.changes), last_row_id:Number(r.lastInsertRowid) } }); } sqlite.exec('COMMIT'); return results; }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  } };
  env.DB=db; return db;
}
export async function invoke(route, body, role='coordinator') {
  const response = await route.POST(authorizedRequest('https://demo.test/api', { method:'POST', headers:{'content-type':'application/json','x-demo-role':role}, body:JSON.stringify(body) }));
  return { status: response.status, data: await response.json() };
}
