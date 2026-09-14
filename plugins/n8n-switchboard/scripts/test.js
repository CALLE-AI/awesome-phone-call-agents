// Smoke tests. No network, no calls placed.
const assert = require('assert');
const path = require('path');

// Tests get their own store. Never the live queue.
process.env.SWITCHBOARD_DATA_FILE = path.join(__dirname, '..', 'data', 'test-jobs.json');
try { require('fs').unlinkSync(process.env.SWITCHBOARD_DATA_FILE); } catch {}
process.env.SWITCHBOARD_QUIET_START = '23:59';
process.env.SWITCHBOARD_QUIET_END = '23:59';

const store = require('../core/store');
const policy = require('../core/policy');
const calle = require('../core/calle');

let passed = 0;
function t(name, fn) {
  try { fn(); console.log('  pass  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + ' :: ' + e.message); process.exitCode = 1; }
}

console.log('\nSwitchboard smoke tests\n');

t('creates and reads a job', () => {
  const job = store.createJob({ recipient: { phone: '+15550101234', region: 'US' }, goal: 'Confirm appointment' });
  assert.strictEqual(job.status, 'pending');
  assert.ok(store.getJob(job.id));
});

t('rejects an unsupported region', () => {
  const r = policy.evaluate({ phone: '+2348000000000', region: 'NG' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reasons.join(' ').includes('NG'));
});

t('accepts a supported region', () => {
  const r = policy.evaluate({ phone: '+15550101234', region: 'US' });
  assert.strictEqual(r.ok, true, 'verdict failed: ' + r.reasons.join('; '));
});

t('quiet hours block a dial', () => {
  const now = new Date(); now.setHours(23, 0, 0, 0);
  process.env.SWITCHBOARD_QUIET_START = '21:00';
  process.env.SWITCHBOARD_QUIET_END = '08:00';
  const r = policy.evaluate({ phone: '+15550101234', region: 'US' }, now);
  assert.strictEqual(r.ok, false);
  process.env.SWITCHBOARD_QUIET_START = '23:59';
  process.env.SWITCHBOARD_QUIET_END = '23:59';
});

t('dry run builds a payload without dialing', () => {
  const p = calle.preview('plan_call', { user_input: 'Confirm my Friday appointment' });
  assert.strictEqual(p.args.user_input, 'Confirm my Friday appointment');
  assert.strictEqual(p.wouldDial, false);
  assert.ok(p.command.includes('mcp call plan_call'));
});

t('flags run_call as destructive', () => {
  const p = calle.preview('run_call', { plan_id: 'plan_x' });
  assert.strictEqual(p.destructive, true);
  assert.strictEqual(p.wouldDial, true);
});

t('detects when CALL-E is asking for a human', () => {
  const step = calle.interpretNextStep({ next_step: { action: 'ask_user_for_retry_confirmation', instruction: 'Confirm retry' } });
  assert.strictEqual(step.needsHuman, true);
  const poll = calle.interpretNextStep({ next_step: { action: 'poll_get_call_run', instruction: 'Poll' } });
  assert.strictEqual(poll.needsHuman, false);
});

t('reads structured data from result.extracted', () => {
  const run = { status: 'COMPLETED', result: { summary: 'Confirmed', extracted: { confirmed: 'yes' }, outcome: { task_completed: true, completion_confidence: { score: 0.9, label: 'high' }, evidence: ['Receptionist confirmed'] } } };
  const r = calle.extractResult(run);
  assert.strictEqual(r.extracted.confirmed, 'yes');
  assert.strictEqual(r.taskCompleted, true);
  assert.strictEqual(r.confidence.label, 'high');
  assert.strictEqual(calle.isTerminal(run.status), true);
  assert.strictEqual(calle.isTerminal('PREPARING'), false);
});

t('kill switch cancels pending jobs', () => {
  store.createJob({ recipient: { phone: '+15550109999', region: 'US' }, goal: 'Test' });
  const n = store.killAll('test');
  assert.ok(n >= 1);
  assert.strictEqual(store.listJobs('pending').length, 0);
});


// --- runner and node ---
const runner = require('../core/runner');

(async () => {
  const job = await runner.queue({
    userInput: 'Confirm the Friday appointment',
    recipient: { phone: '+15550101234', region: 'US' },
    mode: 'dry_run'
  });
  assert.strictEqual(job.status, 'dry_run');
  assert.strictEqual(job.wouldBeBlocked, false);
  assert.ok(job.preview.command.includes('plan_call'));
  console.log('  pass  dry run queues without contacting CALL-E');

  const blocked = await runner.queue({
    userInput: 'Call Lagos',
    recipient: { phone: '+2348000000000', region: 'NG' },
    mode: 'require_approval'
  });
  assert.strictEqual(blocked.status, 'rejected');
  assert.strictEqual(blocked.blocked, true);
  console.log('  pass  unsupported region never reaches plan_call');

  const redacted = runner.redact({ id: 'j1', confirmToken: 'secret_abc', status: 'pending' });
  assert.strictEqual(redacted.confirmToken, undefined);
  assert.strictEqual(redacted.hasConfirmToken, true);
  console.log('  pass  confirm token is never emitted');

  const v1 = runner.validate({ confirmed: 'yes' }, { required: ['confirmed'], properties: { confirmed: { type: 'string', enum: ['yes','no','unknown'] } }, additionalProperties: false });
  assert.strictEqual(v1.ok, true);
  const v2 = runner.validate({ confirmed: 'maybe' }, { required: ['confirmed'], properties: { confirmed: { type: 'string', enum: ['yes','no','unknown'] } } });
  assert.strictEqual(v2.ok, false);
  const v3 = runner.validate({}, { required: ['confirmed'], properties: {} });
  assert.ok(v3.errors[0].includes('Missing required'));
  console.log('  pass  result schema validation catches bad extracted data');

  const { Switchboard } = require('../nodes/Switchboard/Switchboard.node.js');
  const n = new Switchboard();
  assert.strictEqual(n.description.name, 'calleSwitchboard');
  const mode = n.description.properties.find(p => p.name === 'mode');
  assert.strictEqual(mode.default, 'require_approval');
  console.log('  pass  node defaults to require_approval');

  const campaign = require('../core/campaign');
  const camp = campaign.create({ name: 'Test campaign', budget: 2 });
  assert.strictEqual(campaign.checkBudget(camp.id).ok, true);
  console.log('  pass  campaign created with a budget');

  const batch = await runner.queueBatch({
    recipients: [
      { phone: '+15550101234', region: 'US', name: 'Acme', amount: '4,200' },
      { phone: '+2348000000000', region: 'NG', name: 'Lagos Ltd', amount: '50' }
    ],
    userInput: 'Call {{name}} about the invoice for {{amount}}.',
    mode: 'dry_run', campaignId: camp.id
  });
  assert.strictEqual(batch.length, 2);
  assert.ok(batch[0].userInput.includes('Acme'));
  assert.ok(batch[0].userInput.includes('4,200'));
  assert.strictEqual(batch[1].wouldBeBlocked, true);
  console.log('  pass  batch interpolates per recipient and blocks only the bad row');

  const later = await runner.queue({
    userInput: 'Chase next week', recipient: { phone: '+15550101234', region: 'US' },
    campaignId: camp.id, scheduledFor: new Date(Date.now() + 3600000).toISOString()
  });
  assert.strictEqual(later.status, 'scheduled');
  assert.strictEqual(later.planId, undefined);
  console.log('  pass  a scheduled call is never planned, so nothing reaches CALL-E');

  const notDue = await runner.promoteDue(Date.now());
  assert.strictEqual(notDue.length, 0);
  console.log('  pass  promoteDue leaves jobs that are not yet due alone');

  const stopped = campaign.stop(camp.id, 'test');
  assert.ok(stopped.cancelled >= 1);
  assert.strictEqual(campaign.checkBudget(camp.id).ok, false);
  console.log('  pass  stopping a campaign cancels everything not yet sent');

  const masked = runner.redact({ id: 'j1', status: 'pending', confirmToken: 'secret', recipient: { phone: '+15550101234', region: 'US' } });
  assert.strictEqual(masked.recipient.phone.includes('5550101234'), false);
  assert.ok(masked.recipient.phone.endsWith('1234'));
  console.log('  pass  redacted job masks the phone number');

  const batchResult = await runner.queueBatch({
    recipients: [ { phone: '+15550101234', region: 'US' } ],
    userInput: 'Call about the invoice.', mode: 'dry_run'
  });
  assert.strictEqual(batchResult.length, 1);
  console.log('  pass  queueBatch still works with default halt behaviour');
})();

  const wrapped = { ok: true, result: { structuredContent: { plan_id: 'pYA3952KG', ready_to_run: false, confirm_token: null, questions: [{ key: 'to_phones', question: 'What number?' }], display_goal: 'Call the dentist' } } };
  const plan = calle.readPlan(calle.unwrap(wrapped));
  assert.strictEqual(plan.planId, 'pYA3952KG');
  assert.strictEqual(plan.readyToRun, false);
  assert.strictEqual(plan.questions.length, 1);
  console.log('  pass  reads plan_id from result.structuredContent');

  assert.strictEqual(runner.statusFromPlan(plan, 'require_approval'), 'needs_info');
  assert.strictEqual(runner.statusFromPlan({ readyToRun: true, confirmToken: 't' }, 'require_approval'), 'pending');
  assert.strictEqual(runner.statusFromPlan({ readyToRun: true, confirmToken: 't' }, 'auto'), 'approved');
  console.log('  pass  no token means needs_info, not pending');

  assert.strictEqual(calle.tokenExpired('2020-01-01T00:00:00Z'), true);
  assert.strictEqual(calle.tokenExpired(null), false);
  console.log('  pass  expired confirm token is detected');

  const envelopeOnly = { goal: 'x', region: 'US', calling: {}, language: 'English', to_phones: [], repair: {} };
  const vac = runner.validate(envelopeOnly,
    { type: 'object', required: ['line_answered'], properties: { line_answered: { type: 'string' }, what_was_said: { type: 'string' } } });
  assert.strictEqual(vac.ok, false);
  assert.strictEqual(vac.unsupported, true);
  assert.deepStrictEqual(vac.missing, ['line_answered', 'what_was_said']);
  console.log('  pass  envelope-only result reports unsupported, not a pass');

  const real = runner.validate({ line_answered: 'yes', what_was_said: 'ok' },
    { type: 'object', required: ['line_answered'], properties: { line_answered: { type: 'string', enum: ['yes','no'] }, what_was_said: { type: 'string' } } });
  assert.strictEqual(real.ok, true);
  assert.strictEqual(real.unsupported, undefined);
  console.log('  pass  requested fields still validate if CALL-E ever returns them');

  const b = calle.branchable({ result: { outcome: { task_completed: true, completion_confidence: { score: 0.95, label: 'high' }, evidence: ['x'] }, extracted: { calling: { status: 'finished', duration_seconds: 24 } } } });
  assert.strictEqual(b.taskCompleted, true);
  assert.strictEqual(b.confidenceScore, 0.95);
  assert.strictEqual(b.durationSeconds, 24);
  console.log('  pass  branchable outcome fields exposed for routing');
