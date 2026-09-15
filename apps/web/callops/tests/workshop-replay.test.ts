import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkshopReplay, REPLAY_MAX_BYTES } from '../src/domain/workshop-replay';
import { WORKSHOP_REPLAY_BYTES, WORKSHOP_REPLAY_SHA256 } from '../src/fixtures/workshop-replay-catalog';
import { WORKSHOP_TRANSCRIPTS } from '../src/fixtures/workshop';

const digest = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex');
const fresh = (): Record<string, unknown> => JSON.parse(WORKSHOP_REPLAY_BYTES) as Record<string, unknown>;
async function rejected(value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  // A matching curator hash must never bypass the schema or its synthetic-only mode.
  await expect(readWorkshopReplay(raw, digest(raw))).rejects.toMatchObject({ code: 'REPLAY_SCHEMA_REJECTED' });
}
afterEach(() => vi.unstubAllGlobals());

describe('bundled synthetic replay', () => {
  it('verifies the exact catalog and reproduces the four workshop outcomes without network', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const replay = await readWorkshopReplay(WORKSHOP_REPLAY_BYTES, WORKSHOP_REPLAY_SHA256);
    expect(replay.mode).toBe('SYNTHETIC_REPLAY_FIXTURE');
    expect(replay.scenarios.map((s) => s.outcome.expectation)).toEqual(['UNCONFIRMED', 'SUPPORTED', 'CONFLICTING', 'UNCONFIRMED']);
    for (const scenario of replay.scenarios) expect(scenario.transcript).toEqual(WORKSHOP_TRANSCRIPTS[scenario.id]);
    expect(replay.scenarios[0]?.outcome.dates.PART_ARRIVAL.qualification).toBe('ESTIMATED');
    expect(replay.scenarios[0]?.outcome.dates.DEVICE_RETURN.date).toBeNull();
    expect(replay.scenarios[3]?.outcome.reached).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects changed bytes, including whitespace, before accepting a result', async () => {
    for (const raw of [WORKSHOP_REPLAY_BYTES + ' ', WORKSHOP_REPLAY_BYTES.replace('estimated', 'confirmed')]) {
      await expect(readWorkshopReplay(raw, WORKSHOP_REPLAY_SHA256)).rejects.toMatchObject({ code: 'REPLAY_INTEGRITY_MISMATCH' });
    }
  });
  it('bounds UTF-8 bytes before parsing', async () => {
    for (const raw of [' '.repeat(REPLAY_MAX_BYTES + 1), 'é'.repeat(REPLAY_MAX_BYTES / 2 + 1)]) {
      await expect(readWorkshopReplay(raw, digest(raw))).rejects.toMatchObject({ code: 'REPLAY_TOO_LARGE' });
    }
  });
  it('does not fall back to unverified results when integrity is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(readWorkshopReplay(WORKSHOP_REPLAY_BYTES, WORKSHOP_REPLAY_SHA256)).rejects.toMatchObject({ code: 'REPLAY_INTEGRITY_UNAVAILABLE' });
  });
  it.each([
    ['schemaVersion', 2], ['mode', 'SANITIZED_REPLAY'], ['mode', 'LIVE'], ['fixtureRevision', 'unknown'],
    ['fixtureSourceCommit', '0'.repeat(40)], ['caseReference', 'ANOTHER-CASE'],
    ['run_id', 'opaque-private-run'], ['sourceUrl', 'https://example.com/private'],
    ['networkEvidence', { serviceRequests: 1, phoneCalls: 0, serverContracts: 'UNOBSERVED' }],
    ['networkEvidence', { serviceRequests: 0, phoneCalls: 1, serverContracts: 'OBSERVED' }],
    ['context', { customerExpectedReturn: '2026-09-14', observation: null }], ['scenarios', []],
  ])('rejects invalid or unexpected %s even with a matching hash', async (key, value) => {
    const candidate = fresh(); candidate[key] = value; await rejected(candidate);
  });
  it('rejects a missing field and non-object roots', async () => {
    const candidate = fresh(); delete candidate.context;
    for (const value of [candidate, [], null, 'fixture']) await rejected(value);
  });
  it('rejects nonterminal, reordered and duplicate scenarios', async () => {
    for (const mutate of [
      (items: Record<string, unknown>[]) => { if (items[0]) items[0].state = 'IN_PROGRESS'; },
      (items: Record<string, unknown>[]) => { items.reverse(); },
      (items: Record<string, unknown>[]) => { if (items[0]) items[1] = items[0]; },
    ]) { const candidate = fresh(); mutate(candidate.scenarios as Record<string, unknown>[]); await rejected(candidate); }
  });
  it('rejects extra nested keys and invalid transcript values', async () => {
    for (const patch of [{ token: 'private' }, { transcript: ['Supplier: line\nSupplier: second'] }, { transcript: [42] }, { transcript: ['Supplier: ' + 'x'.repeat(2048)] }, { transcript: [] }]) {
      const candidate = fresh(); const scenarios = candidate.scenarios as Record<string, unknown>[];
      Object.assign(scenarios[0] ?? {}, patch); await rejected(candidate);
    }
  });
  it('returns only a fixed error for malformed JSON, never its content', async () => {
    const raw = '{"private_untrusted_content"';
    await expect(readWorkshopReplay(raw, digest(raw))).rejects.toThrow('REPLAY_SCHEMA_REJECTED');
  });
});
