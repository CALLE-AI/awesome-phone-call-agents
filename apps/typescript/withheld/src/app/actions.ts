'use server';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runChain } from '@/core/chain';
import {
  FixtureProvider,
  type CallOutcome,
  type CallProvider,
  type CallRequest,
} from '@/core/calle';
import { loadErrand } from '@/core/errand';
import { maskSecret } from '@/core/budget';
import type { ErrandFile } from '@/core/types';
import {
  SCENARIOS,
  type ClientErrand,
  type LegTranscript,
  type RunResult,
} from './scenarios';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'fixtures/legs');

function loadDemoErrand(file = 'clinic-referral.json'): ErrandFile {
  const raw = JSON.parse(
    readFileSync(path.join(ROOT, 'data/errands', path.basename(file)), 'utf8'),
  );
  const loaded = loadErrand(raw);
  if (!loaded.ok) {
    throw new Error(`Errand refused: ${loaded.errors.join('; ')}`);
  }
  return loaded.errand!;
}

/**
 * Wraps a provider to keep the transcripts, which the chain deliberately does
 * not carry — verdicts travel with their supporting quote, not with the whole
 * call. The console wants the raw exchange so a viewer can check the app's
 * reading against what was actually said.
 */
class Recording implements CallProvider {
  readonly name: string;
  readonly placesRealCalls: boolean;
  readonly transcripts: LegTranscript[] = [];

  private readonly inner: CallProvider;
  private leg = 0;

  constructor(inner: CallProvider) {
    this.inner = inner;
    this.name = inner.name;
    this.placesRealCalls = inner.placesRealCalls;
  }

  async placeCall(request: CallRequest): Promise<CallOutcome> {
    this.leg += 1;
    const outcome = await this.inner.placeCall(request);
    this.transcripts.push({ leg: this.leg, turns: outcome.turns });
    return outcome;
  }
}

export async function runScenario(scenarioId: string): Promise<RunResult> {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const errand = loadDemoErrand();

  const provider = new Recording(new FixtureProvider(FIXTURES, scenario.legs));

  const state = await runChain({
    errand,
    provider,
    // Fixtures were recorded relative to this moment, so relative phrases like
    // "tomorrow between ten and twelve" resolve the same way on every run.
    now: new Date('2026-09-14T09:00:00Z'),
  });

  return {
    state,
    transcripts: provider.transcripts,
    scenario,
    placedRealCalls: provider.placesRealCalls,
  };
}

/**
 * Anything returned from here is serialised into the page, so this function is
 * the boundary the number is not allowed to cross. Build the client's view by
 * naming each field, never by spreading the errand — a spread would quietly
 * start shipping any field added later.
 */
export async function getErrand(): Promise<ClientErrand> {
  const errand = loadDemoErrand();
  return {
    errand_id: errand.errand_id,
    person: {
      name: errand.person.name,
      phone_masked: maskSecret(errand.person.phone),
    },
    callee: { name: errand.callee.name },
    reason: errand.reason,
    may_say: errand.may_say,
    acceptable_windows: errand.acceptable_windows.map((w) => ({
      start: w.start,
      end: w.end,
    })),
  };
}
