import { env } from 'cloudflare:workers';
import type { Job } from './domain';
export const bindings = env as unknown as {
  DB: D1Database;
  CALLE_API_KEY?: string;
  OPERATOR_TOKEN?: string;
  LIVE_CALLS_ENABLED?: string;
};
export async function list() {
  const r = await bindings.DB.prepare(
    'SELECT body FROM jobs ORDER BY rowid DESC LIMIT 100',
  ).all<{ body: string }>();
  return r.results.map((r) => JSON.parse(r.body) as Job);
}
export async function get(id: string) {
  const r = await bindings.DB.prepare(
    'SELECT body,version FROM jobs WHERE id = ?',
  )
    .bind(id)
    .first<{ body: string; version: number }>();
  if (!r) throw Error('Case not found.');
  return { job: JSON.parse(r.body) as Job, version: r.version };
}
export async function insert(job: Job) {
  await bindings.DB.prepare('INSERT INTO jobs (id,body,version) VALUES (?,?,0)')
    .bind(job.id, JSON.stringify(job))
    .run();
}
export async function save(job: Job, version: number) {
  const r = await bindings.DB.prepare(
    'UPDATE jobs SET body = ?,version = version + 1 WHERE id = ? AND version = ?',
  )
    .bind(JSON.stringify(job), job.id, version)
    .run();
  if (r.meta.changes !== 1)
    throw Error('Case changed in another request. Refresh before continuing.');
}
