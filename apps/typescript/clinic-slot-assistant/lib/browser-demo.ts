import { advanceDemo, createCall, decide, newWorkspace, WorkflowError, type CreateInput, type View, type Workspace } from './model';
import { demoSettings } from './public-demo';

export const DEMO_STORAGE_KEY = 'clinic-slot-public-demo-v1';
interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
type Action = ({action: 'create'} & CreateInput) | {action: 'decide'; callId: string; decision: 'confirm' | 'close'};
interface Journal { version: 1; startedAt: string; actions: {at: string; input: Action}[] }
const uuid = /^[a-f0-9-]{36}$/i;

// Store a small journal of allowed fictional actions, not arbitrary patient records
// or settings. Replaying it applies the same consent and booking rules as local mode.
function action(value: unknown): Action {
  if (!value || typeof value !== 'object') throw new WorkflowError('Invalid demo action.');
  const input = value as Record<string, unknown>;
  if (input.action === 'create' && input.mode === 'demo' && typeof input.requestId === 'string' && uuid.test(input.requestId)
      && typeof input.slotId === 'string' && /^slot-[1-3]$/.test(input.slotId)
      && typeof input.candidateId === 'string' && /^person-[1-4]$/.test(input.candidateId)
      && ['accepted', 'declined', 'unclear', 'unanswered'].includes(String(input.scenario))
      && input.consent === true && input.approved === true) {
    return {action: 'create', requestId: input.requestId, slotId: input.slotId, candidateId: input.candidateId,
      mode: 'demo', scenario: input.scenario as CreateInput['scenario'], consent: true, approved: true};
  }
  if (input.action === 'decide' && typeof input.callId === 'string' && uuid.test(input.callId)
      && (input.decision === 'confirm' || input.decision === 'close')) {
    return {action: 'decide', callId: input.callId, decision: input.decision};
  }
  throw new WorkflowError('This public demo supports simulated calls and fictional booking decisions only.');
}
function apply(state: Workspace, input: Action, now: Date) {
  advanceDemo(state, now);
  if (input.action === 'create') createCall(state, input, now);
  else decide(state, input.callId, input.decision, now);
}
function fresh(now: Date): Journal { return {version: 1, startedAt: now.toISOString(), actions: []}; }
function read(storage: StoragePort, now: Date): {journal: Journal; state: Workspace} {
  const raw = storage.getItem(DEMO_STORAGE_KEY);
  try {
    if (!raw || raw.length > 100000) throw new Error('Missing or oversized journal');
    const saved = JSON.parse(raw);
    const start = Date.parse(saved.startedAt);
    if (saved.version !== 1 || !Number.isFinite(start) || start > now.getTime() || !Array.isArray(saved.actions) || saved.actions.length > 200) throw new Error('Invalid journal');
    const journal: Journal = {version: 1, startedAt: new Date(start).toISOString(), actions: []};
    const state = newWorkspace(new Date(start));
    let previous = start;
    for (const entry of saved.actions) {
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at) || at < previous || at > now.getTime()) throw new Error('Invalid timestamp');
      const input = action(entry.input);
      apply(state, input, new Date(at));
      journal.actions.push({at: new Date(at).toISOString(), input});
      previous = at;
    }
    advanceDemo(state, now);
    return {journal, state};
  } catch {
    // Corrupt or incompatible browser data starts a clean fictional workspace.
    return {journal: fresh(now), state: newWorkspace(now)};
  }
}
export function loadBrowserDemo(storage: StoragePort, now = new Date()): View {
  const {journal, state} = read(storage, now);
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(journal));
  return {...state, settings: demoSettings()};
}
export function updateBrowserDemo(storage: StoragePort, body: unknown, now = new Date()): View {
  if (body && typeof body === 'object' && 'action' in body && body.action === 'reset') {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fresh(now)));
    return {...newWorkspace(now), settings: demoSettings()};
  }
  const input = action(body);
  const {journal, state} = read(storage, now);
  if (journal.actions.length >= 200) throw new WorkflowError('This demo has reached its activity limit. Use Reset demo to start a fresh workspace.');
  apply(state, input, now);
  journal.actions.push({at: now.toISOString(), input});
  storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(journal));
  return {...state, settings: demoSettings()};
}
