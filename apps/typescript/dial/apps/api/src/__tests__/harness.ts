import { createDatabase, runMigrations, type DatabaseHandle } from '@dial/database';
import { loadConfig, type DialConfig } from '@dial/config';
import { FakeCallProvider, type CallProvider } from '@dial/calle';
import { Runner, type OrchestratorContext } from '@dial/orchestrator';
import type { TaskInterpreter, InterpretOutput, QuestionGenerator } from '@dial/ai';
import type { DiscoveryService, GeocodeResult } from '@dial/search';
import type { BusinessCandidate, CallFamilyId, DialTask } from '@dial/schemas';
import { buildApp } from '../app.js';
import { RealtimeHub } from '../realtime.js';

/**
 * Test harness.
 *
 * Everything real that can be real is real: a genuine PostgreSQL database via
 * PGlite, the real migrations, the real Fastify app, the real orchestration
 * pipeline and the real worker loop.
 *
 * Two things are substituted, and only because exercising them here would mean
 * ringing a business and spending model tokens on every test run:
 *   - the call provider (FakeCallProvider — deterministic, never dials)
 *   - the interpreter and discovery provider (stubs, per test)
 * Production resolves all three from configuration and never reaches this file.
 */

export interface Harness {
  handle: DatabaseHandle;
  ctx: OrchestratorContext;
  app: Awaited<ReturnType<typeof buildApp>>;
  runner: Runner;
  config: DialConfig;
  close: () => Promise<void>;
}

export function stubInterpreter(output: (instruction: string) => InterpretOutput): TaskInterpreter {
  return {
    name: 'stub',
    async interpret(input) {
      return output(input.instruction);
    },
  };
}

export function stubDiscovery(options: {
  candidates: BusinessCandidate[];
  geocode?: Partial<GeocodeResult> | null;
  /** Overrides the geocode for queries containing this text, e.g. a city hint. */
  geocodeOverrides?: Array<{ match: string; result: Partial<GeocodeResult> | null }>;
  majorCity?: { name: string; latitude: number; longitude: number; population: number } | null;
  discoverError?: Error;
}): DiscoveryService {
  const geo =
    options.geocode === undefined
      ? { latitude: 53.3498, longitude: -6.2603, label: 'Dublin, Ireland', countryCode: 'IE' }
      : options.geocode;

  const lookup = (query: string) => {
    const override = options.geocodeOverrides?.find((o) =>
      query.toLowerCase().includes(o.match.toLowerCase()),
    );
    return override ? override.result : geo;
  };

  return {
    describe: () => 'stub',
    geocode: async (query: string) => lookup(query),
    reverseGeocode: async () => geo,
    findMajorCity: async () => options.majorCity ?? null,
    // The real DiscoveryService catches per-provider failures and reports them
    // in providerErrors rather than throwing, so the stub mirrors that contract.
    discover: async () => ({
      candidates: options.discoverError ? [] : options.candidates,
      providersUsed: options.discoverError || !options.candidates.length ? [] : ['stub'],
      providerErrors: options.discoverError
        ? [{ provider: 'stub', code: 'provider_unavailable', message: options.discoverError.message }]
        : [],
    }),
  } as unknown as DiscoveryService;
}

export function candidate(over: Partial<BusinessCandidate> = {}): BusinessCandidate {
  const id = over.id ?? `c_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    name: over.name ?? 'Test Shop',
    category: 'mobile_phone',
    address: '1 Test Street, Dublin',
    latitude: 53.35,
    longitude: -6.26,
    phoneE164: '+35315550100',
    phoneRaw: '01 555 0100',
    website: null,
    source: 'osm',
    sourceUrl: `https://www.openstreetmap.org/node/${id}`,
    rating: null,
    reviewCount: null,
    distanceMeters: 1500,
    openingHours: null,
    phoneVerified: false,
    verificationSources: [],
    ...over,
  };
}

export const REPAIR_TASK: DialTask = {
  objective: 'Find the cheapest iPhone 13 screen replacement available today',
  taskFamily: 'research_compare',
  domain: 'phone_repair',
  searchQuery: 'phone repair shop',
  // A real place name: 'near me' is a reference to coordinates, not somewhere
  // that can be looked up, and the pipeline treats the two differently.
  location: { raw: 'Dublin 2', latitude: null, longitude: null, label: null, radiusKm: 10 },
  constraints: {
    budget: null,
    date: null,
    timeWindow: null,
    distanceKm: 10,
    partySize: null,
    preferredBrands: [],
    excludedBusinesses: [],
    candidateLimit: null,
    additional: { device: 'iPhone 13', issue: 'screen' },
  },
  successCondition: 'A comparable price is obtained from at least two shops',
  requestedSideEffect: 'information_only',
  sensitivity: 'normal',
  authorizationRequirement: 'none',
  clarificationNeeded: null,
  isEmergency: false,
};

export async function createHarness(
  overrides: {
    interpreter?: TaskInterpreter | null;
    questionGenerator?: QuestionGenerator | null;
    discovery?: DiscoveryService;
    provider?: CallProvider;
    env?: Record<string, string>;
  } = {},
): Promise<Harness> {
  // Overrides are layered onto a copy, never written back into process.env —
  // mutating the real environment leaks one test's limits into the next.
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    TEST_PROVIDER: process.env['TEST_PROVIDER'] ?? 'mock',
    SESSION_SECRET: process.env['SESSION_SECRET'] ?? 'test-secret-that-is-definitely-long-enough-1234',
    CALL_POLL_DELAY_MS: process.env['CALL_POLL_DELAY_MS'] ?? '1',
    /*
     * Pinned rather than inherited. Vitest loads the repository's .env into
     * process.env, so a developer's own tuning silently became the tests'
     * fixtures -- a suite asserting one call at a time passed or failed
     * depending on a line in an untracked file. Tests that care about these
     * override them explicitly.
     */
    CALL_WAVE_SIZE: '1',
    MAX_CALLS_PER_TASK: '5',
    MAX_CALLS_UNTIL_RESULT: '10',
    COMPARABLE_TARGET: '3',
    MAX_CALLS_PER_USER_PER_DAY: '25',
    ...(overrides.env ?? {}),
  });
  const handle = await createDatabase({ url: '', dataDir: 'memory://' });
  await runMigrations(handle.db);

  const hub = new RealtimeHub();
  const ctx: OrchestratorContext = {
    db: handle.db,
    config,
    provider: overrides.provider ?? new FakeCallProvider(),
    discovery: overrides.discovery ?? stubDiscovery({ candidates: [] }),
    interpreter:
      overrides.interpreter === undefined
        ? stubInterpreter(() => ({ task: REPAIR_TASK, callFamily: 'repair_quote' as CallFamilyId }))
        : overrides.interpreter,
    // Intake is off unless a test opts in, so existing tests keep exercising
    // the straight-through path.
    questionGenerator: overrides.questionGenerator ?? null,
    publish: (taskId, event) => hub.publish(taskId, event),
  };

  const app = await buildApp({ db: handle.db, config, ctx, hub });
  await app.ready();

  const runner = new Runner(ctx, { batchSize: 10, pollIntervalMs: 5 });

  return {
    handle,
    ctx,
    app,
    runner,
    config,
    close: async () => {
      await runner.stop();
      await app.close();
      await handle.close();
    },
  };
}

/** Signs up a user and returns the bearer token. */
export async function signUp(
  harness: Harness,
  email = `user${Math.random().toString(36).slice(2, 8)}@example.com`,
): Promise<{ token: string; userId: string; email: string }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up',
    payload: { email, password: 'a-sufficiently-long-password', name: 'Test User' },
  });
  if (response.statusCode !== 200) {
    throw new Error(`sign-up failed: ${response.statusCode} ${response.body}`);
  }
  const body = response.json() as { user: { id: string }; token: string };
  return { token: body.token, userId: body.user.id, email };
}

export async function createTask(
  harness: Harness,
  token: string,
  instruction: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; statusCode: number; body: any }> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      instruction,
      idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      ...extra,
    },
  });
  const body = response.statusCode === 200 ? response.json() : response.json();
  return { id: body?.id, statusCode: response.statusCode, body };
}

export async function getTaskDetail(harness: Harness, token: string, id: string): Promise<any> {
  const response = await harness.app.inject({
    method: 'GET',
    url: `/api/tasks/${id}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return response.json();
}
