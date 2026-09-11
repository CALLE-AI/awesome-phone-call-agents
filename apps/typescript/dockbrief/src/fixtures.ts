import { CalleClient } from '@call-e/calle';
import { buildRequest, FACTS, type Input } from './domain.js';
export const SAMPLE_INPUT: Input = { reference: 'DEMO-PALLET-042', site: { name: 'Fictional Cedar Receiving Bay', phone: '+12025550142', region: 'US', locale: 'en-US' }, load: { grossKg: 1100, widthMm: 1400, heightMm: 2100, unloadingMode: 'dock' } };
export type Scenario = 'fitting' | 'insufficient-forklift' | 'incomplete';
export function rawFixture(scenario: Scenario, input: Input = SAMPLE_INPUT): Record<string, unknown> {
  const quotes = [scenario === 'insufficient-forklift' ? 'Forklift capacity is 900 kg.' : 'Forklift capacity is 1500 kg.', 'Clear door width is 2200 mm.', 'Clear door height is 2800 mm.', 'Dock unloading is available.', 'Ground unloading is not available.', 'Receiving staff are available.'];
  const values = [scenario === 'insufficient-forklift' ? '900' : '1500', '2200', '2800', 'yes', 'no', 'yes'];
  if (scenario === 'incomplete') { quotes[0] = 'I think the forklift can probably manage it.'; values[0] = 'unknown'; quotes[5] = 'I do not know who will be here.'; values[5] = 'unknown'; }
  const structured = Object.fromEntries(FACTS.map((key, i) => [key, { value: values[i], quote: values[i] === 'unknown' ? '' : quotes[i] }]));
  return { id: `fixture_${scenario.replaceAll('-', '_')}`, object: 'call_task', status: 'completed', task: buildRequest(input).task,
    recipients: [{ id: 'fixture_recipient', phones: [input.site.phone], locale: input.site.locale, region: input.site.region, status: 'completed', structured_result: structured, summary: null,
      attempts: [{ id: 'fixture_attempt_1', phone: input.site.phone, status: 'completed', started_at: '2026-09-11T12:00:00Z', completed_at: '2026-09-11T12:01:00Z', summary: null, transcript_turns: [{ speaker: 'bot', offset_seconds: 0, text: 'I am an AI assistant in an offline demonstration.' }, ...quotes.map((text, i) => ({ speaker: 'user', offset_seconds: 10 + i * 6, text }))], provider_call_id: null, failure_code: null, failure_message: null }], }],
    structured_result: { questionnaireOutcome: scenario === 'incomplete' ? 'incomplete' : 'answered' }, summary: 'OFFLINE SYNTHETIC FIXTURE — no phone call occurred.', task_completed: scenario !== 'incomplete', completion_confidence: { score: 1, label: 'high' }, evidence: [], metadata: { application: 'dockbrief', fixture: true }, failure_code: null, failure_message: null, created_at: '2026-09-11T12:00:00Z', completed_at: '2026-09-11T12:01:00Z' };
}
export function fixtureClient(scenario: Scenario, input: Input = SAMPLE_INPUT): CalleClient {
  return new CalleClient({ apiKey: 'offline-fixture-no-key', fetch: async request => {
    if (new URL(request.url).hostname !== 'api.heycall-e.com' || !['POST', 'GET'].includes(request.method)) throw new Error('Unexpected fixture request.');
    return Response.json(rawFixture(scenario, input));
  } });
}
