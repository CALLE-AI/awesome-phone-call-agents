import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_RUNTIME_DIR } from '../src/calle.mjs';
import { ingestCallResult, prepareReviewedScenario, saveReviewedScenario } from '../src/ingest.mjs';
import { evaluatePairs, formatTime } from '../web/engine.js';

// This executable accepts only the bundled, explicitly synthetic response fixtures.
// It never constructs a CALL-E client and blocks fetch even when credentials exist.
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts++;
  throw new Error('The fixture integration demo prohibits network requests.');
};

try {
  const [context, storageCall, carrierCall] = await Promise.all(
    ['context.json', 'storage-call.TEST.json', 'carrier-call.TEST.json'].map(name =>
      readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8').then(JSON.parse)),
  );
  if (context.evidence_mode !== 'test' || [storageCall, carrierCall].some(call =>
    call.metadata?.evidence_mode !== 'test' || call.metadata?.source_provenance !== 'synthetic'
    || !call.id?.startsWith('call_TEST_')
    || !call.recipients?.every(recipient => recipient.phones?.every(phone => /^\+1[2-9]\d{2}55501\d{2}$/.test(phone))))) {
    throw new Error('The integration demo requires TEST fixtures with reserved fictional phone numbers.');
  }

  const directory = join(DEFAULT_RUNTIME_DIR, 'demo', `${Date.now()}-${randomUUID().slice(0, 8)}`);
  const baseline = evaluatePairs(prepareReviewedScenario(context));
  // These bundled TEST conversations and facts are supplied for review in examples/.
  const withStorage = ingestCallResult(context, storageCall, { providerType: 'storage', providerId: 'riverside', reviewed: true });
  const storagePath = await saveReviewedScenario(join(directory, 'reviewed-storage.json'), withStorage);
  const persistedStorage = JSON.parse(await readFile(storagePath, 'utf8'));
  const storageOnly = evaluatePairs(prepareReviewedScenario(persistedStorage));
  const withCarrier = ingestCallResult(persistedStorage, carrierCall, { providerType: 'carrier', providerId: 'swift', reviewed: true });
  const combinedPath = await saveReviewedScenario(join(directory, 'reviewed-storage-and-carrier.json'), withCarrier);
  const reviewed = prepareReviewedScenario(JSON.parse(await readFile(combinedPath, 'utf8')));
  const solved = evaluatePairs(reviewed);
  const result = {
    mode: 'TEST / SYNTHETIC API-FIXTURE INTEGRATION',
    calls_placed: 0,
    network_requests: networkAttempts,
    notice: 'All call IDs, service facts and conversations are fictional fixtures, not live CALL-E evidence. No calls, bookings or payments are made.',
    service_date: reviewed.service_date,
    timezone: reviewed.timezone,
    steps: [
      { step: 'Start with unknown providers', feasible_pairs: baseline.feasible.length },
      { step: 'Import the reviewed TEST storage response', feasible_pairs: storageOnly.feasible.length },
      { step: 'Import the reviewed TEST carrier response', feasible_pairs: solved.feasible.length },
    ],
    best: solved.best ? { ...solved.best, handoff_local: formatTime(solved.best.handoff_min) } : null,
    sources: [...reviewed.storages, ...reviewed.carriers].filter(provider => provider.source?.reviewed).map(provider => ({ provider_id: provider.id, call_id: provider.call_id, evidence_mode: provider.source.evidence_mode })),
    artifacts: { storage: storagePath, combined: combinedPath, result: join(directory, 'result.TEST.json') },
  };
  await writeFile(result.artifacts.result, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ mode: 'TEST / SYNTHETIC API-FIXTURE INTEGRATION', calls_placed: 0, network_requests: networkAttempts, error: error.message }, null, 2));
  process.exitCode = 1;
}
