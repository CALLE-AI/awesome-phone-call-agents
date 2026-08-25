#!/usr/bin/env node
// Directory audit runner.
//
// Default behavior is preview: it places no calls and needs no credentials. Going
// live takes four deliberate acts (see resolveMode below), because absence of a
// setting must never read as "go ahead and dial".

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { groupByOffice, applyGates, DEFAULT_WINDOW } from './gates.mjs';
import { buildPayload, classifyListing, CalleClient, CalleError, DEFAULT_BASE_URL } from './calle.mjs';
import { scoreAudit, summarize, formatPercent } from './adequacy.mjs';
import { maskPhone, redactDeep } from './mask.mjs';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

const USAGE = `ghost-network-audit

  node scripts/audit.mjs --listings <file.json> [options]

Options
  --listings <path>              Directory export to audit. Required.
  --dry-run                      Preview only. This is the default.
  --live                         Place real calls. Also needs CALLE_API_KEY and
                                 CALLE_LIVE_CALLS_ENABLED=1.
  --base-url <url>               CALL-E base URL. Point at the fake server to rehearse.
  --auditing-organization <name> Organization named in the spoken disclosure.
  --plan-name <name>             Plan name to ask about. Defaults to the file's plan_name.
  --callback-number <e164>       Number the office can call back to verify the audit.
  --now <iso>                    Evaluate calling windows at this instant instead of now.
  --concurrency <n>              Parallel calls. Default 4.
  --out <path>                   Run output. Default out/audit-run.json.
`;

// Live calls require all four. Any one missing previews instead of dialing, and the
// reason is printed so a run that quietly previewed cannot be mistaken for one that
// quietly dialed.
function resolveMode(args, env) {
  const blockers = [];
  if (!args.live) blockers.push('--live was not passed');
  if (env.CALLE_LIVE_CALLS_ENABLED !== '1') blockers.push('CALLE_LIVE_CALLS_ENABLED is not "1"');
  if (!env.CALLE_API_KEY) blockers.push('CALLE_API_KEY is not set');
  if (!args['callback-number']) blockers.push('--callback-number was not provided');
  if (!args['auditing-organization']) blockers.push('--auditing-organization was not provided');
  return { live: blockers.length === 0, blockers };
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function rowsForOffice(office, extra) {
  return office.listings.map((listing) => ({
    listing_id: listing.listing_id,
    provider_name: listing.provider_name,
    specialty: listing.specialty,
    office_name: listing.office_name,
    phone_masked: maskPhone(office.phone || String(listing.phone || '')),
    ...extra,
  }));
}

export async function runAudit(options) {
  const {
    listings,
    suppressionList = [],
    planName,
    auditingOrganization,
    callbackNumber,
    now = new Date(),
    live = false,
    client = null,
    concurrency = 4,
    runId = `run-${now.toISOString().slice(0, 10)}`,
    window = DEFAULT_WINDOW,
    sleep,
  } = options;

  const offices = groupByOffice(listings);
  const { dialable, skipped, deferred } = applyGates(offices, { suppressionList, now, window });

  const rows = [];
  for (const entry of skipped) {
    rows.push(...rowsForOffice(entry.office, { state: 'skipped', reason: entry.reason }));
  }
  for (const entry of deferred) {
    rows.push(...rowsForOffice(entry.office, { state: 'deferred', reason: entry.reason }));
  }

  const config = { auditingOrganization, planName, callbackNumber, runId };
  const previews = [];
  const errors = [];

  const callRows = await mapWithConcurrency(dialable, concurrency, async (office) => {
    const { payload, idempotencyKey, errors: payloadErrors } = buildPayload(office, config);
    if (payloadErrors.length > 0) {
      return rowsForOffice(office, { state: 'skipped', reason: `invalid_request:${payloadErrors[0]}` });
    }

    if (!live) {
      previews.push(
        redactDeep({
          endpoint: `${(client?.baseUrl) || DEFAULT_BASE_URL}/v1/calls`,
          idempotency_key: idempotencyKey,
          payload,
        }),
      );
      return rowsForOffice(office, { state: 'preview', reason: 'dry_run' });
    }

    try {
      const created = await client.createCall(payload, idempotencyKey);
      const finished = await client.waitForResult(created.id, { sleep });
      const result = finished.result || null;
      return office.listings.map((listing) => {
        const verdict = classifyListing(result, listing.provider_name);
        return {
          listing_id: listing.listing_id,
          provider_name: listing.provider_name,
          specialty: listing.specialty,
          office_name: listing.office_name,
          phone_masked: maskPhone(office.phone),
          call_id: created.id,
          state: verdict.state,
          reason: verdict.reason,
          next_appointment_weeks:
            verdict.state === 'confirmed_active' ? (result?.next_appointment_weeks ?? null) : null,
          notes: result?.notes ?? null,
        };
      });
    } catch (error) {
      if (error instanceof CalleError) {
        errors.push({ office: maskPhone(office.phone), message: error.message });
        // A provider error is not evidence about the listing.
        return rowsForOffice(office, { state: 'unverified', reason: 'provider_error' });
      }
      throw error;
    }
  });

  for (const group of callRows) rows.push(...group);

  return {
    run_id: runId,
    generated_at: now.toISOString(),
    mode: live ? 'live' : 'preview',
    plan_name: planName,
    auditing_organization: auditingOrganization,
    counts_by_office: { dialable: dialable.length, skipped: skipped.length, deferred: deferred.length },
    rows,
    previews,
    errors,
    score: scoreAudit(rows),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.listings) {
    process.stdout.write(USAGE);
    process.exit(args.listings ? 0 : 1);
  }

  const listingsPath = resolve(String(args.listings));
  const file = JSON.parse(await readFile(listingsPath, 'utf8'));
  const listings = Array.isArray(file) ? file : file.listings;
  if (!Array.isArray(listings)) {
    process.stderr.write('The listings file must be an array, or an object with a "listings" array.\n');
    process.exit(1);
  }

  const mode = resolveMode(args, process.env);
  const baseUrl = String(args['base-url'] || process.env.CALLE_BASE_URL || DEFAULT_BASE_URL);

  // Pointing at a local fake server is a rehearsal, not a preview: it exercises the
  // real request path and the real result mapping, and dials nothing.
  const usingFakeServer = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(baseUrl);
  const executing = mode.live || usingFakeServer;

  if (!mode.live && !usingFakeServer) {
    process.stdout.write(`Preview mode. No calls will be placed.\n  ${mode.blockers.join('\n  ')}\n\n`);
  } else if (usingFakeServer && !mode.live) {
    process.stdout.write(`Rehearsal against ${baseUrl}. No real calls will be placed.\n\n`);
  } else {
    process.stdout.write('LIVE MODE: real phone calls will be placed.\n\n');
  }

  const now = args.now ? new Date(String(args.now)) : new Date();
  if (Number.isNaN(now.getTime())) {
    process.stderr.write('--now must be an ISO timestamp.\n');
    process.exit(1);
  }

  const run = await runAudit({
    listings,
    suppressionList: file.suppression_list || [],
    planName: String(args['plan-name'] || file.plan_name || ''),
    auditingOrganization: String(args['auditing-organization'] || 'Example Health Directory Audit'),
    callbackNumber: String(args['callback-number'] || '+12125550100'),
    now,
    live: executing,
    client: executing ? new CalleClient({ baseUrl, apiKey: process.env.CALLE_API_KEY }) : null,
    concurrency: Number(args.concurrency || 4),
  });

  const outPath = resolve(String(args.out || 'out/audit-run.json'));
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');

  const { score } = run;

  // A preview has no findings to summarize. Printing the scored summary here would
  // report "the audit did not connect" for a run that was never meant to connect.
  if (run.mode === 'preview') {
    process.stdout.write(
      `Previewed ${run.previews.length} calls covering ${score.counts.dialable} listings. Nothing was dialed.\n\n`,
    );
    process.stdout.write(`  offices that would be called   ${run.counts_by_office.dialable}\n`);
    process.stdout.write(`  offices skipped before dial    ${run.counts_by_office.skipped}\n`);
    process.stdout.write(`  offices deferred by the clock  ${run.counts_by_office.deferred}\n\n`);
    for (const row of run.rows.filter((entry) => entry.state === 'skipped' || entry.state === 'deferred')) {
      process.stdout.write(`  ${row.state.padEnd(9)} ${row.listing_id}  ${row.reason}\n`);
    }
    process.stdout.write(`\nRun written to ${outPath}\n`);
    return;
  }

  process.stdout.write(`${summarize(score)}\n\n`);
  process.stdout.write(`  coverage              ${formatPercent(score.coverage)}\n`);
  process.stdout.write(`  ghost rate            ${formatPercent(score.ghost_rate)}\n`);
  process.stdout.write(`  closed panels         ${formatPercent(score.closed_panel_rate)}\n`);
  process.stdout.write(`  usable to a patient   ${formatPercent(score.effective_availability)}\n`);
  process.stdout.write(`  median wait (weeks)   ${score.median_wait_weeks ?? 'n/a'}\n`);
  process.stdout.write(`  unverified            ${score.counts.unverified}\n`);
  process.stdout.write(`  skipped before dial   ${score.counts.skipped}\n\n`);
  process.stdout.write(`Run written to ${outPath}\n`);

  if (run.errors.length > 0) {
    process.stdout.write(`\n${run.errors.length} provider errors (recorded as unverified, not as findings).\n`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${maskPhone(String(error && error.message ? error.message : error))}\n`);
    process.exit(1);
  });
}
