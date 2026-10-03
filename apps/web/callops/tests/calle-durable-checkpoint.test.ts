import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FileCalleRunCheckpointStore,
  calleRunCheckpointFileName,
} from '../src/adapters/file-calle-run-checkpoint-store';
import {
  asCalleRunId,
  InMemoryCallePlanCapabilityVault,
} from '../src/integrations/calle-live-capability-vault';
import { CalleLiveAdapter } from '../src/integrations/calle-live-adapter';
import type {
  CalleLiveTransport,
  CalleRunCheckpointRecord,
} from '../src/integrations/calle-live-types';
import { DeterministicClock } from './helpers';

const TEST_RUN_ID = 'FICTITIOUS_RUN_HANDLE_FOR_DURABLE_CHECKPOINT_TEST_ONLY';
const roots = new Set<string>();

function checkpoint(
  revision = 1,
  phase: CalleRunCheckpointRecord['phase'] = 'RUN_ID_RECEIVED',
): CalleRunCheckpointRecord {
  return {
    schemaVersion: 1,
    revision,
    phase,
    runId: phase === 'RUN_REQUESTED' || phase === 'REMOTE_EXECUTION_UNCERTAIN'
      ? null
      : asCalleRunId(TEST_RUN_ID),
    remoteState: phase === 'RUN_ID_RECEIVED' ? 'QUEUED' : null,
    terminalState: phase === 'TERMINAL' ? 'COMPLETED' : null,
    updatedAt: `2026-08-02T12:00:0${String(Math.min(revision, 9))}.000Z`,
    reasonCode: 'LOCAL_TEST_CHECKPOINT',
  };
}

async function harness(): Promise<{
  readonly parent: string;
  readonly storeRoot: string;
  readonly store: FileCalleRunCheckpointStore;
}> {
  const parent = await mkdtemp(join(tmpdir(), 'callops-checkpoint-test-'));
  roots.add(parent);
  const storeRoot = join(parent, 'run-checkpoints');
  return {
    parent,
    storeRoot,
    store: new FileCalleRunCheckpointStore(storeRoot, resolve(process.cwd())),
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe('durable CALL-E run checkpoint store', () => {
  it('writes a versioned checkpoint atomically outside the repository', async () => {
    const { store, storeRoot } = await harness();
    await store.save('durable-session-fixture', checkpoint());

    expect(await store.load('durable-session-fixture')).toEqual(checkpoint());
    const files = await readdir(storeRoot);
    expect(files).toEqual([calleRunCheckpointFileName('durable-session-fixture')]);
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
  });

  it('serializes replacements and returns the last complete revision', async () => {
    const { store } = await harness();
    await Promise.all([
      store.save('serialized-write-fixture', checkpoint(1)),
      store.save('serialized-write-fixture', checkpoint(2)),
      store.save('serialized-write-fixture', checkpoint(3)),
    ]);
    expect(await store.load('serialized-write-fixture')).toMatchObject({ revision: 3 });
    await expect(store.save('serialized-write-fixture', checkpoint(2))).rejects.toMatchObject({
      code: 'RUN_CHECKPOINT_REVISION_STALE',
    });
    await store.save('serialized-write-fixture', checkpoint(4));
    expect(await store.load('serialized-write-fixture')).toMatchObject({ revision: 4 });
  });

  it('persists only the recovery minimum and no capability or transcript', async () => {
    const { store, storeRoot } = await harness();
    await store.save('minimal-checkpoint-fixture', checkpoint());
    const contents = await readFile(
      join(storeRoot, calleRunCheckpointFileName('minimal-checkpoint-fixture')),
      'utf8',
    );

    expect(contents).toContain(TEST_RUN_ID);
    expect(contents).not.toMatch(/confirm_token|confirmToken|bearer|transcript|summary|phone/iu);
    expect(Object.keys(JSON.parse(contents) as object).sort()).toEqual([
      'phase',
      'reasonCode',
      'remoteState',
      'revision',
      'runId',
      'schemaVersion',
      'terminalState',
      'updatedAt',
    ]);
  });

  it('rejects corrupt JSON and an unknown schema version fail-closed', async () => {
    const { store, storeRoot } = await harness();
    await mkdir(storeRoot, { recursive: true });
    const filePath = join(storeRoot, calleRunCheckpointFileName('corrupt-checkpoint-fixture'));
    await writeFile(filePath, '{partial', 'utf8');
    await expect(store.load('corrupt-checkpoint-fixture')).rejects.toMatchObject({
      code: 'RUN_CHECKPOINT_JSON_INVALID',
    });

    await writeFile(filePath, JSON.stringify({ ...checkpoint(), schemaVersion: 2 }), 'utf8');
    await expect(store.load('corrupt-checkpoint-fixture')).rejects.toMatchObject({
      code: 'RUN_CHECKPOINT_VERSION_UNSUPPORTED',
    });
  });

  it('refuses any durable checkpoint root inside the repository', () => {
    const repositoryRoot = resolve(process.cwd());
    expect(
      () => new FileCalleRunCheckpointStore(join(repositoryRoot, '.runtime'), repositoryRoot),
    ).toThrowError(expect.objectContaining({ code: 'RUN_CHECKPOINT_IN_REPOSITORY' }));
  });

  it('uses a one-way filename and performs no network access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { store } = await harness();
    const sessionId = 'filename-privacy-fixture';
    const expectedDigest = createHash('sha256').update(sessionId, 'utf8').digest('hex');
    expect(calleRunCheckpointFileName(sessionId)).toBe(`run-${expectedDigest}.json`);
    await store.save(sessionId, checkpoint());
    await store.load(sessionId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recovers after a process-style restart using only read-only status', async () => {
    const { storeRoot } = await harness();
    const sessionId = 'durable-restart-fixture';
    const firstStore = new FileCalleRunCheckpointStore(storeRoot, resolve(process.cwd()));
    await firstStore.save(sessionId, checkpoint());

    let runCalls = 0;
    let statusCalls = 0;
    const transport: CalleLiveTransport = {
      planCall: () => Promise.reject(new Error('Planning is not available during recovery.')),
      runCall: () => {
        runCalls += 1;
        return Promise.reject(new Error('Mutation is forbidden during recovery.'));
      },
      getCallRun: () => {
        statusCalls += 1;
        return Promise.resolve({
          state: 'COMPLETED',
          transcript: [],
          summary: 'Fictitious recovered technical result.',
          failureReason: null,
        });
      },
    };
    const secondStore = new FileCalleRunCheckpointStore(storeRoot, resolve(process.cwd()));
    const adapter = new CalleLiveAdapter(
      sessionId,
      transport,
      secondStore,
      new DeterministicClock(),
      new InMemoryCallePlanCapabilityVault(),
    );

    expect(await adapter.restoreCheckpoint()).toMatchObject({
      state: 'STATUS_UNKNOWN',
      checkpointPhase: 'RUN_ID_RECEIVED',
    });
    expect(
      await adapter.pollUntilTerminal(
        { initialDelayMs: 0, intervalMs: 1, timeoutMs: 100, maxPolls: 1 },
        { nowMs: () => 0, wait: () => Promise.resolve() },
      ),
    ).toMatchObject({ state: 'COMPLETED', checkpointPhase: 'TERMINAL' });
    expect(runCalls).toBe(0);
    expect(statusCalls).toBe(1);
  });
});
