import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveOutcomeTransition } from './bound-call-runtime.mjs';
import { playbook, states } from './scenario.ts';

export type Outcome = 'INTERESTED' | 'NO_ANSWER';
type Event = { source: 'SYNTHETIC'; previous_state: string; resulting_state: string; outcome_code: Outcome; customer_reached: boolean; summary: string; timestamp: string };
type State = { mode: 'NO_CALL'; engine_enabled: false; outreach_state: string; events: Event[] };
export class DemoStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(privateFile: string) { this.file = privateFile; }
  private file: string;
  async read(): Promise<State> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value.mode !== 'NO_CALL' || value.engine_enabled !== false || !Array.isArray(value.events) || value.events.length > 1)
        throw new Error('Invalid demo state; stop and inspect the local file.');
      const expected = value.events[0]?.resulting_state ?? 'SCHEDULED';
      if (!['SCHEDULED', 'FOLLOW_UP_REVIEW', 'UNREACHED'].includes(expected) || value.outreach_state !== expected)
        throw new Error('Invalid demo state.');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { mode: 'NO_CALL', engine_enabled: false, outreach_state: 'SCHEDULED', events: [] };
    }
  }
  apply(outcome: Outcome): Promise<State> {
    const operation = this.pending.then(async () => {
      if (!playbook.allowed_outcomes.includes(outcome)) throw new Error('Unknown outcome.');
      const state = await this.read();
      // One synthetic run per local file; repeated clicks cannot append duplicate events.
      if (state.events.length) {
        if (state.events[0].outcome_code !== outcome) throw new Error('Run already completed; conflicting result rejected.');
        return state;
      }
      const result = { outcome_code: outcome, customer_reached: outcome === 'INTERESTED', summary: 'Synthetic outcome for an offline demonstration only.' };
      const transition = resolveOutcomeTransition({ result, playbook, state: { states } });
      const next: State = { ...state, outreach_state: transition.state, events: [{ source: 'SYNTHETIC',
        previous_state: state.outreach_state, resulting_state: transition.state, ...result, timestamp: new Date().toISOString() }] };
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return next;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
