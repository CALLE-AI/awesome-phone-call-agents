import type { MockScenario } from './models';
import { interpretWorkshopTranscript, type WorkshopContext, type WorkshopOutcome } from './workshop-outcome';

export const REPLAY_SOURCE = 'c6111870f92aefdc5995bca6054e036c74dca4eb';
export const REPLAY_MAX_BYTES = 16_384;
const IDS: readonly MockScenario[] = ['AMBIGUOUS', 'NOMINAL', 'CONFLICTING', 'FAILED'];
type ReplayErrorCode = 'REPLAY_TOO_LARGE' | 'REPLAY_INTEGRITY_MISMATCH' | 'REPLAY_SCHEMA_REJECTED' | 'REPLAY_INTEGRITY_UNAVAILABLE';
export class ReplayError extends Error {
  public constructor(public readonly code: ReplayErrorCode) { super(code); }
}
export interface ReplayScenario {
  readonly id: MockScenario;
  readonly state: 'COMPLETED' | 'FAILED';
  readonly transcript: readonly string[];
  readonly outcome: WorkshopOutcome;
}
export interface VerifiedWorkshopReplay {
  readonly mode: 'SYNTHETIC_REPLAY_FIXTURE';
  readonly schemaVersion: 1;
  readonly fixtureRevision: 'workshop-v1';
  readonly fixtureSourceCommit: typeof REPLAY_SOURCE;
  readonly caseReference: 'DEMO-REPAIR-0042';
  readonly context: WorkshopContext;
  readonly sha256: string;
  readonly scenarios: readonly ReplayScenario[];
}
type RecordValue = Record<string, unknown>;
function record(value: unknown, keys: readonly string[]): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new ReplayError('REPLAY_SCHEMA_REJECTED');
  }
  return value as RecordValue;
}
function requireValue(condition: boolean): asserts condition {
  if (!condition) throw new ReplayError('REPLAY_SCHEMA_REJECTED');
}

/** Only bundled, curator-pinned synthetic bytes are accepted. This is not an upload
 * sanitizer, signature verifier, or proof that a phone call happened. */
export async function readWorkshopReplay(raw: string, expectedSha256: string): Promise<VerifiedWorkshopReplay> {
  if (raw.length > REPLAY_MAX_BYTES) throw new ReplayError('REPLAY_TOO_LARGE');
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength > REPLAY_MAX_BYTES) throw new ReplayError('REPLAY_TOO_LARGE');
  let actual: string;
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new ReplayError('REPLAY_INTEGRITY_UNAVAILABLE'); }
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256) || actual !== expectedSha256) throw new ReplayError('REPLAY_INTEGRITY_MISMATCH');
  try {
    const value = record(JSON.parse(raw) as unknown, ['schemaVersion', 'mode', 'fixtureRevision', 'fixtureSourceCommit', 'caseReference', 'context', 'networkEvidence', 'scenarios']);
    requireValue(value.schemaVersion === 1 && value.mode === 'SYNTHETIC_REPLAY_FIXTURE'
      && value.fixtureRevision === 'workshop-v1' && value.fixtureSourceCommit === REPLAY_SOURCE
      && value.caseReference === 'DEMO-REPAIR-0042');
    const contextValue = record(value.context, ['customerExpectedReturn', 'observation']);
    const observation = record(contextValue.observation, ['observedAt', 'timeZone']);
    requireValue(contextValue.customerExpectedReturn === '2026-09-11'
      && observation.observedAt === '2026-09-08T10:00:00.000Z' && observation.timeZone === 'Europe/Paris');
    const context: WorkshopContext = {
      customerExpectedReturn: contextValue.customerExpectedReturn,
      observation: { observedAt: observation.observedAt, timeZone: observation.timeZone },
    };
    const network = record(value.networkEvidence, ['serviceRequests', 'phoneCalls', 'serverContracts']);
    requireValue(network.serviceRequests === 0 && network.phoneCalls === 0 && network.serverContracts === 'UNOBSERVED');
    requireValue(Array.isArray(value.scenarios) && value.scenarios.length === IDS.length);
    const scenarios = value.scenarios.map((item: unknown, index): ReplayScenario => {
      const scenario = record(item, ['id', 'state', 'transcript']);
      requireValue(scenario.id === IDS[index] && scenario.state === (scenario.id === 'FAILED' ? 'FAILED' : 'COMPLETED'));
      requireValue(Array.isArray(scenario.transcript) && scenario.transcript.length > 0 && scenario.transcript.length <= 200);
      requireValue(scenario.transcript.every((line: unknown) => typeof line === 'string' && line.length <= 2048
        && /^(?:Agent|Supplier|Simulation): .+$/u.test(line)
        && Array.from(line).every((char) => char.charCodeAt(0) >= 32)));
      const transcript = scenario.transcript as string[];
      const state = scenario.state as 'COMPLETED' | 'FAILED';
      return { id: scenario.id as MockScenario, state, transcript: [...transcript], outcome: interpretWorkshopTranscript(transcript, state, context) };
    });
    return {
      mode: 'SYNTHETIC_REPLAY_FIXTURE', schemaVersion: 1, fixtureRevision: 'workshop-v1',
      fixtureSourceCommit: REPLAY_SOURCE, caseReference: 'DEMO-REPAIR-0042', context, sha256: actual, scenarios,
    };
  } catch { throw new ReplayError('REPLAY_SCHEMA_REJECTED'); }
}
