// Demo seed: a realistic Monday morning for a collections team.
//
// Nothing here is fabricated. plan_call does not dial, so pending jobs carry real
// confirm tokens. Blocked, scheduled and rate-limited jobs are genuinely in those
// states. The one completed job is a real call that actually happened.
//
//   node --env-file=.env scripts/demo.js
//   node --env-file=.env scripts/demo.js --reset
const path = require('path');
const fs = require('fs');

// Rate limit of 2 so the runaway-loop demo triggers.
process.env.SWITCHBOARD_MAX_CALLS_PER_RECIPIENT_PER_DAY =
  process.env.DEMO_RATE_LIMIT || '2';

// A collections team works office hours. Without this the whole demo is
// refused when you run it at 4am, which is correct but not useful.
process.env.SWITCHBOARD_QUIET_START = process.env.DEMO_QUIET_START || '23:00';
process.env.SWITCHBOARD_QUIET_END = process.env.DEMO_QUIET_END || '23:01';

const store = require('../core/store');
const runner = require('../core/runner');
const campaign = require('../core/campaign');
const calle = require('../core/calle');

const COMPLETED_RUN_ID = process.env.DEMO_RUN_ID || 'Y0yYTjNDYpJ7LyOf6HSrxg';

const ledger = [
  { phone: '+15550101234', region: 'US', name: 'Acme Ltd',     amount: '4,200',  days: 31 },
  { phone: '+15550105678', region: 'US', name: 'Borel & Co',   amount: '980',    days: 12 },
  { phone: '+15550109012', region: 'US', name: 'Crest Group',  amount: '12,500', days: 58 },
  { phone: '+2348000000000', region: 'NG', name: 'Lagos Ltd',  amount: '640',    days: 22 }
];

const GOAL = 'Call the accounts payable team at {{name}} on {{phone}}. Invoice {{ref}} for ' +
             '{{amount}} is {{days}} days overdue. Ask when it will be paid.';

const SCHEMA = {
  type: 'object',
  required: ['payment_promised'],
  properties: {
    payment_promised: { type: 'string', enum: ['yes', 'no', 'disputed'] },
    promised_date: { type: 'string' },
    notes: { type: 'string' }
  }
};

const log = (...a) => console.log('  ', ...a);

async function main() {
  if (process.argv.includes('--reset')) {
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'jobs.json'),
      JSON.stringify({ jobs: [], audit: [], campaigns: [] }, null, 2));
    log('cleared the store');
  }

  console.log('\nSeeding the Monday collections demo\n');

  const camp = campaign.create({ name: 'Monday collections', budget: 5 });
  log('campaign:', camp.name, '| budget', camp.budget, 'calls');

  for (const row of ledger.slice(0, 2)) {
    const job = await runner.queue({
      userInput: runner.interpolate(GOAL, { ...row, ref: 'INV-' + (4400 + ledger.indexOf(row)) }),
      recipient: row, resultSchema: SCHEMA, mode: 'require_approval',
      campaignId: camp.id, timezone: 'Africa/Lagos'
    });
    log(`${row.name.padEnd(12)} ${job.status.padEnd(14)} token: ${job.confirmToken ? 'held' : 'none'}`);
  }

  // One plannable row. 555 numbers are reserved and CALL-E refuses to route them,
  // so a demo built only on fictional numbers can never show a held token. This
  // uses CALL-E's own published test hotline.
  const live = await runner.queue({
    userInput: 'Call the CALL-E test hotline. Say this is an integration test for an ' +
               'accounts receivable workflow and ask the agent to confirm the line is working.',
    recipient: { phone: '+12763229632', region: 'US', name: 'CALL-E test hotline' },
    resultSchema: SCHEMA, mode: 'require_approval', campaignId: camp.id, timezone: 'Africa/Lagos'
  });
  log(`${'Test hotline'.padEnd(12)} ${live.status.padEnd(14)} token: ${live.confirmToken ? 'held' : 'none'}`);

  const dry = await runner.queue({
    userInput: runner.interpolate(GOAL, { ...ledger[2], ref: 'INV-4402' }),
    recipient: ledger[2], resultSchema: SCHEMA, mode: 'dry_run', campaignId: camp.id
  });
  log(`${ledger[2].name.padEnd(12)} ${dry.status.padEnd(14)} preview only`);

  const blocked = await runner.queue({
    userInput: runner.interpolate(GOAL, { ...ledger[3], ref: 'INV-4403' }),
    recipient: ledger[3], resultSchema: SCHEMA, mode: 'require_approval', campaignId: camp.id
  });
  log(`${ledger[3].name.padEnd(12)} ${blocked.status.padEnd(14)} ${(blocked.policy.reasons || [])[0] || ''}`);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const later = await runner.queue({
    userInput: 'Call Acme Ltd to confirm the promised payment cleared.',
    recipient: ledger[0], resultSchema: SCHEMA, mode: 'require_approval',
    campaignId: camp.id, scheduledFor: tomorrow.toISOString()
  });
  log(`scheduled    ${later.status.padEnd(14)} ${tomorrow.toLocaleString()} | planned: ${Boolean(later.planId)}`);

  console.log('\n  Runaway loop: a workflow bug queues Borel & Co five times');
  let caught = 0;
  for (let i = 0; i < 5; i++) {
    const j = await runner.queue({
      userInput: 'Call Borel & Co about invoice INV-4401.',
      recipient: ledger[1], resultSchema: SCHEMA, mode: 'require_approval', campaignId: camp.id
    });
    if (j.wouldBeBlocked || j.blocked) caught++;
  }
  log(`rate limit caught ${caught} of 5 duplicate attempts`);

  try {
    const run = await calle.getCallRun({ runId: COMPLETED_RUN_ID });
    const result = calle.extractResult(run);
    const done = store.createJob({
      userInput: 'Call the CALL-E test hotline and confirm the line is working.',
      recipient: { phone: '+12763229632', region: 'US' },
      resultSchema: { type: 'object', required: ['line_answered'],
        properties: { line_answered: { type: 'string', enum: ['yes','no'] }, what_was_said: { type: 'string' } } },
      mode: 'require_approval',
      extra: {
        campaignId: camp.id, status: 'complete', calleStatus: run.status,
        callRunId: COMPLETED_RUN_ID, displayGoal: run.display_goal, result,
        validation: runner.validate(result.extracted, { type: 'object', required: ['line_answered'],
          properties: { line_answered: { type: 'string' }, what_was_said: { type: 'string' } } })
      }
    });
    log(`completed    ${done.status.padEnd(14)} real call, ${result.branchable.durationSeconds}s, ` +
        `confidence ${result.branchable.confidenceLabel}`);
  } catch (err) {
    log('completed    skipped       could not re-read run:', err.message);
  }

  const s = campaign.spend(camp.id);
  console.log(`\n  Campaign: ${s.spent} of ${camp.budget} spent, ${s.queued} queued, ${s.stopped} stopped`);
  console.log('\n  Zero calls placed by this script.');
  console.log('  Start the console:  node --env-file=.env console/server.js\n');
}

main().catch(e => { console.error('demo failed:', e.message); process.exit(1); });
