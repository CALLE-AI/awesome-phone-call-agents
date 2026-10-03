#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assess, buildRequest, maskPhone, validateInput } from './domain.js';
import { fixtureClient, SAMPLE_INPUT, type Scenario } from './fixtures.js';
import { htmlReport, markdownReport } from './report.js';
import { liveClient, readState, resume, retryCreate, start, type State } from './workflow.js';

const HELP = `DockBrief — transcript-backed physical unloading checks

  preview input.json
  start input.json --confirm-call --consent-note "Specific recipient authorization" --out .dockbrief/run.json
  resume .dockbrief/run.json
  retry-create .dockbrief/run.json --confirm-call
  report .dockbrief/run.json [--out brief.html] [--format html|md]
  demo fitting|insufficient-forklift|incomplete --out .dockbrief/demo.json

preview, report and demo are offline. demo uses synthetic fixtures through the real SDK's custom transport.
start places one real CALL-E call. Only use a consenting recipient and approved free credits.
resume makes one GET; repeat to refresh. It never places a call. Poll at least 5 seconds apart.
retry-create explicitly replays the saved request with its existing key after an ambiguous POST.
Never change --out or start a new run to recover a call. A local timeout does not cancel it.
Set CALLE_API_KEY in a trusted terminal environment. There is no client cancellation endpoint.
Private state contains a phone number and transcript. Keep it outside public repositories.
No output is dispatch approval or safety certification.`;
async function saveReport(state: State, path: string, format: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, format === 'md' ? markdownReport(state) : htmlReport(state));
  console.log(`Report written: ${path}`);
}
function status(state: State): void {
  const a = assess(state.input, state.call);
  console.log(maskPhone(`${state.mode === 'fixture' ? 'OFFLINE FIXTURE · NO PHONE CALL' : 'CALL-E'} | ${state.input.reference} | ${state.input.site.phone}\nCall: ${state.callId ?? 'unknown'} | lifecycle: ${a.lifecycle} | ${a.verdict}\n${a.checks.map(c => `${c.outcome.padEnd(8)} ${c.label.padEnd(21)} required ${c.expected.padEnd(16)} reported ${c.observed}`).join('\n')}\nNot dispatch approval. Reported information needs site verification.`));
}
async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { 'confirm-call': { type: 'boolean' }, 'consent-note': { type: 'string' }, out: { type: 'string' }, format: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  const [command, inputPath] = positionals;
  if (values.help || !command) { console.log(HELP); return; }
  if (positionals.length !== 2 || !inputPath) throw new Error('Provide one command and one input/state/scenario. Use --help.');
  if (command === 'preview') {
    const input = validateInput(JSON.parse(await readFile(inputPath, 'utf8')));
    console.log(maskPhone(JSON.stringify({ mode: 'OFFLINE PREVIEW — no network request', input, request: buildRequest(input) }, null, 2))); return;
  }
  if (command === 'demo') {
    if (!['fitting', 'insufficient-forklift', 'incomplete'].includes(inputPath)) throw new Error('Unknown fixture scenario.');
    if (!values.out) throw new Error('Provide --out .dockbrief/demo.json. Existing state will not be overwritten.');
    const state = await start(SAMPLE_INPUT, values.out, fixtureClient(inputPath as Scenario), 'Offline synthetic fixture. No recipient contacted.', 'fixture');
    status(state); await saveReport(state, values.out.replace(/\.json$/i, '') + '.html', 'html'); return;
  }
  if (command === 'report') {
    const state = await readState(inputPath); const format = values.format ?? 'html';
    if (!['html', 'md'].includes(format)) throw new Error('format must be html or md.');
    if (values.out) await saveReport(state, values.out, format); else console.log(format === 'md' ? markdownReport(state) : htmlReport(state)); return;
  }
  if (command === 'start') {
    if (!values['confirm-call']) throw new Error('A real call requires --confirm-call after reviewing preview.');
    if (!values.out || !values['consent-note']) throw new Error('Provide --out and --consent-note.');
    const input = validateInput(JSON.parse(await readFile(inputPath, 'utf8')));
    if (/^\+1\d{3}55501\d{2}$/.test(input.site.phone)) throw new Error('The fictional sample number cannot be called. Use a specifically authorized real recipient.');
    const state = await start(input, values.out, liveClient(), values['consent-note']); status(state); return;
  }
  if (command === 'resume' || command === 'retry-create') {
    const saved = await readState(inputPath);
    if (saved.mode !== 'live') throw new Error('Fixture state cannot be resumed against the live API. Generate a fresh offline demo instead.');
    if (command === 'retry-create' && !values['confirm-call']) throw new Error('Replaying an ambiguous create requires --confirm-call. It reuses the saved request and key.');
    status(await (command === 'resume' ? resume(inputPath, liveClient()) : retryCreate(inputPath, liveClient()))); return;
  }
  throw new Error('Unknown command. Use --help.');
}
main().catch(error => { console.error(maskPhone(error instanceof Error ? error.message : 'DockBrief could not complete this action.')); process.exitCode = 1; });
