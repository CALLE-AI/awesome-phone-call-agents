import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newWorkspace, type Workspace } from './model';
const dir = join(process.cwd(), '.data', 'sessions');
function file(id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid session');
  return join(dir, `${id}.json`);
}
export function load(id: string): Workspace {
  const path = file(id);
  if (!existsSync(path)) { const state = newWorkspace(); save(id, state); return state; }
  const state = JSON.parse(readFileSync(path, 'utf8')) as Workspace;
  if (state.version !== 1 || !Array.isArray(state.calls)) throw new Error('Stored workspace is invalid');
  return state;
}
export function save(id: string, state: Workspace) {
  mkdirSync(dir, {recursive: true});
  const target = file(id);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(state), {mode: 0o600});
  renameSync(temp, target);
}
