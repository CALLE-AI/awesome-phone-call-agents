/**
 * Durable run loop. Persist run_id before returning from create;
 * never re-issue a create after a timeout. Poll cadence and crash-resume
 * land Friday AM.
 *
 * Source: docs/build-plan.md §2.3, docs/calle-platform.md §9 gotchas 3, 4, 6.
 */

export const FIRST_POLL_MS = 60_000;
export const NEXT_POLL_MS = 7_500;

export type PersistedRun = {
  runId: string;
  idempotencyKey: string;
  status: "created" | "polling" | "terminal";
};

export type RunStore = {
  getByIdempotency(key: string): Promise<PersistedRun | null>;
  put(run: PersistedRun): Promise<void>;
};

/**
 * If a run already exists for this authorization, resume it.
 * Callers must persist `runId` *before* the create request returns
 * to the rest of the app — a client timeout that retries with a
 * fresh create dials a real human twice.
 */
export async function loadOrCreateRun(
  store: RunStore,
  idempotencyKey: string,
  create: () => Promise<string>,
): Promise<PersistedRun> {
  const existing = await store.getByIdempotency(idempotencyKey);
  if (existing) return existing;

  const runId = await create();
  const run: PersistedRun = {
    runId,
    idempotencyKey,
    status: "created",
  };
  await store.put(run);
  return run;
}
