import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { CalleClient, CalleError, DEFAULT_RUNTIME_DIR, buildCallRequest, createReservedCall, loadReservation, maskForDisplay, publicError, saveSnapshot } from './calle.mjs';
import { ingestCallResult, prepareReviewedScenario, saveReviewedScenario } from './ingest.mjs';

const HELP = `Harvest Relay — local rehearsal and CALL-E integration

  node src/cli.mjs demo
  node src/cli.mjs check
  node src/cli.mjs preview --type storage --provider orchard --phone <E164_PHONE>
  node src/cli.mjs call --type storage --provider orchard --phone <E164_PHONE> --operation-id <STABLE_ID> --confirm
  node src/cli.mjs status --id <CALL_ID>
  node src/cli.mjs status --operation-id <STABLE_ID>
  node src/cli.mjs events --id <CALL_ID> [--limit 50] [--cursor <CURSOR>]
  node src/cli.mjs ingest --file <CALL_JSON> --type storage --provider riverside --scenario <CONTEXT_JSON> --output runtime/reviewed-1.json --reviewed
  node src/cli.mjs solve --scenario runtime/reviewed-1.json

Preview/call: --type storage|carrier, --provider <scenario provider ID>, optional --region and --locale.
Preview/call accept --scenario for operator-supplied context; otherwise they use the fictional demo.
Ingest/solve require --scenario with explicit service_date, IANA timezone, local-day now_min and lot facts.
Ingest requires factual review of the recipient transcript. It strips fixture quotes and never fills missing facts from the demo.
Live calls require CALLE_API_KEY and an exact destination in comma-separated CALLE_ALLOWED_PHONES.
An operation ID can be reserved only once. Unknown outcomes require reconciliation; this CLI never resends a create request.
Status and events use the returned CallTask ID, not the Dashboard provider call ID.
The public website has no live-call endpoint. Demo data and prompts are explicitly fictional.
`;

export async function main(args, { env = process.env, stdout = value => console.log(value), stderr = value => console.error(value), fetchImpl = globalThis.fetch, runtimeDir = DEFAULT_RUNTIME_DIR } = {}) {
  try {
    let parsed;
    try {
      parsed = parseArgs({ args, allowPositionals: true, strict: true, options: {
        help: { type: 'boolean', short: 'h' }, confirm: { type: 'boolean' }, reviewed: { type: 'boolean' },
        type: { type: 'string' }, provider: { type: 'string' }, phone: { type: 'string' },
        region: { type: 'string' }, locale: { type: 'string' }, 'operation-id': { type: 'string' },
        id: { type: 'string' }, limit: { type: 'string' }, cursor: { type: 'string' },
        file: { type: 'string' }, scenario: { type: 'string' }, output: { type: 'string' },
      } });
    } catch {
      throw new CalleError('invalid_arguments', 'Unknown or incomplete CLI arguments. Run with --help for usage.');
    }
    const command = parsed.positionals[0] ?? 'help';
    const flags = parsed.values;
    if (flags.help || command === 'help') { stdout(HELP); return 0; }
    if (parsed.positionals.length !== 1) throw new CalleError('invalid_arguments', 'Provide exactly one command. Run with --help for usage.');
    const emit = value => stdout(JSON.stringify(maskForDisplay(value), null, 2));
    const client = new CalleClient({ apiKey: env.CALLE_API_KEY, fetchImpl });

    if (command === 'ingest') {
      if (!flags.reviewed) throw new CalleError('review_required', 'Use --reviewed only after checking the recipient transcript and extracted facts.');
      if (!flags.scenario || !flags.file) throw new CalleError('invalid_arguments', 'Ingest requires --scenario and --file; it never defaults to demo facts.');
      const [scenario, call] = await Promise.all([flags.scenario, flags.file].map(path => readFile(path, 'utf8').then(JSON.parse)));
      const imported = ingestCallResult(scenario, call, { providerType: flags.type, providerId: flags.provider, reviewed: flags.reviewed });
      const output = await saveReviewedScenario(flags.output, imported, runtimeDir);
      emit({ mode: imported.evidence_mode === 'test' ? 'test-import' : 'reviewed-import', dialed: false, reviewed: true, provider_id: flags.provider, call_id: call.id, output_file: output, notice: imported.notice });
      return 0;
    }
    if (command === 'solve') {
      if (!flags.scenario) throw new CalleError('invalid_arguments', 'Solve requires an explicit --scenario JSON file. Use demo for fictional fixture data.');
      const [{ evaluatePairs }, rawScenario] = await Promise.all([
        import('../web/engine.js'), readFile(flags.scenario, 'utf8').then(JSON.parse),
      ]);
      const scenario = prepareReviewedScenario(rawScenario);
      const sources = [...scenario.storages, ...scenario.carriers].filter(provider => provider.source?.reviewed).map(provider => ({ provider_id: provider.id, call_id: provider.call_id, evidence_mode: provider.source.evidence_mode }));
      emit({ mode: scenario.evidence_mode === 'test' ? 'test-import' : 'reviewed-import', dialed: false, service_date: scenario.service_date, timezone: scenario.timezone, notice: scenario.notice, sources, ...evaluatePairs(scenario) });
      return 0;
    }

    if (command === 'demo') {
      const [{ evaluatePairs }, scenario] = await Promise.all([
        import('../web/engine.js'),
        readFile(new URL('../web/scenario.json', import.meta.url), 'utf8').then(JSON.parse),
      ]);
      emit({ mode: 'synthetic', dialed: false, notice: scenario.notice, ...evaluatePairs(scenario) });
      return 0;
    }
    if (command === 'check') {
      const result = { mode: 'read-only', dialed: false, ...await client.check() };
      const path = await saveSnapshot(runtimeDir, 'check', 'connection', result);
      emit({ ...result, snapshot_file: path });
      return 0;
    }
    if (command === 'preview' || command === 'call') {
      if (command === 'call' && flags.confirm !== true) throw new CalleError('confirmation_required', 'Live calls require an explicit --confirm flag and an authorized destination.');
      const scenario = JSON.parse(await readFile(flags.scenario ?? new URL('../web/scenario.json', import.meta.url), 'utf8'));
      const request = buildCallRequest(scenario, { providerType: flags.type, providerId: flags.provider, phone: flags.phone, region: flags.region, locale: flags.locale });
      if (command === 'preview') emit({ mode: 'preview', dialed: false, request });
      else emit(await createReservedCall({ client, request, operationId: flags['operation-id'], confirm: flags.confirm, allowedPhones: env.CALLE_ALLOWED_PHONES ?? '', runtimeDir }));
      return 0;
    }
    if (command === 'status' || command === 'events') {
      let callId = flags.id;
      if (!callId && flags['operation-id']) {
        const reservation = await loadReservation(runtimeDir, flags['operation-id']);
        if (!reservation.call_id) throw new CalleError('acceptance_unknown', 'This reservation has no returned CallTask ID. Reconcile the saved request with CALL-E before starting another operation.', { acceptance: reservation.state, operationId: flags['operation-id'] });
        callId = reservation.call_id;
      }
      const data = command === 'status' ? await client.getCall(callId) : await client.getEvents(callId, { limit: flags.limit === undefined ? 50 : Number(flags.limit), cursor: flags.cursor });
      const path = await saveSnapshot(runtimeDir, command, callId, data);
      emit({ mode: 'read-only', snapshot_file: path, [command === 'status' ? 'call' : 'events']: data });
      return 0;
    }
    throw new CalleError('invalid_command', 'Unknown command. Run with --help for usage.');
  } catch (error) {
    stderr(JSON.stringify({ ok: false, error: publicError(error) }, null, 2));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
