// Runner. Holds the confirm_token and decides when it may be spent.
//
// CALL-E ships a two-phase commit: plan_call returns a confirm_token, and
// run_call requires it. Nothing in that design forces a human to sit between
// the two. This module is that human's seat.
const store = require('./store');
const policy = require('./policy');
const calle = require('./calle');
const campaign = require('./campaign');

// Plan a call and park it. Never dials.
async function queue({ userInput, recipient, resultSchema, mode = 'require_approval', timezone,
                       campaignId, scheduledFor, actor = 'workflow' }) {
  // Evaluate quiet hours against the dial time. A call scheduled for 10am
  // tomorrow must not be refused because it is 4am now.
  const at = scheduledFor ? new Date(scheduledFor) : new Date();
  const verdict = policy.evaluate(recipient || {}, at);
  const budget = campaign.checkBudget(campaignId);
  if (!budget.ok) {
    verdict.ok = false;
    verdict.reasons = (verdict.reasons || []).concat(budget.reason);
    verdict.checks = (verdict.checks || []).concat({ name: 'budget', ...budget });
  }

  // plan_call takes one natural-language string, so everything structural has to
  // be expressed in it: the number to dial, and the shape of the data we want back.
  // Without the schema in here, CALL-E returns run metadata and nothing we asked for.
  let seeded = userInput;
  if (recipient && recipient.phone) {
    seeded += `\n\nPhone number to call: ${recipient.phone}`;
  }
  if (resultSchema && resultSchema.properties) {
    const fields = Object.entries(resultSchema.properties).map(([k, v]) => {
      const allowed = v.enum ? ` (one of: ${v.enum.join(', ')})` : '';
      return `- ${k}: ${v.type || 'string'}${allowed}`;
    }).join('\n');
    seeded += `\n\nWhen the call ends, extract exactly these fields into the structured result:\n${fields}`;
    if (resultSchema.required && resultSchema.required.length) {
      seeded += `\nThese are mandatory: ${resultSchema.required.join(', ')}.`;
    }
  }

  // Dry run is for inspection, so it reports a policy failure rather than
  // refusing. You should be able to see exactly why a call would be blocked.
  if (mode === 'dry_run') {
    return store.createJob({
      userInput, recipient, resultSchema, mode,
      extra: {
        campaignId,
        status: 'dry_run',
        policy: verdict,
        wouldBeBlocked: !verdict.ok,
        preview: calle.preview('plan_call', { user_input: seeded }, { timezone })
      }
    });
  }

  if (!verdict.ok) {
    return store.createJob({
      userInput, recipient, resultSchema, mode,
      extra: { campaignId, status: 'rejected', blocked: true, policy: verdict, plan: null }
    });
  }

  // Scheduled jobs are not planned yet. Nothing is sent to CALL-E until the job
  // is due, which is what makes cancelling a scheduled call actually possible.
  if (scheduledFor && new Date(scheduledFor).getTime() > Date.now()) {
    return store.createJob({
      userInput, recipient, resultSchema, mode,
      extra: { status: 'scheduled', scheduledFor, campaignId, policy: verdict, seeded, timezone }
    });
  }

  const { plan } = await calle.planCall({ userInput: seeded, timezone });

  return store.createJob({
    userInput, recipient, resultSchema, mode,
    extra: {
      campaignId,
      status: statusFromPlan(plan, mode),
      policy: verdict,
      planId: plan.planId,
      confirmToken: plan.confirmToken,   // held here, never emitted to the workflow
      readyToRun: plan.readyToRun,
      questions: plan.questions,
      confirmSummary: plan.confirmSummary,
      confirmExpiresAt: plan.confirmExpiresAt,
      displayGoal: plan.displayGoal || userInput,
      scheduleMode: plan.scheduleMode,
      scheduledAt: plan.scheduledAt
    }
  });
}

// CALL-E withholds the token until it has what it needs. When ready_to_run is
// false it hands back clarifying questions, and its own next_step says to send
// the user to a plan card. n8n has no plan card. The console is the plan card.
function statusFromPlan(plan, mode) {
  if (!plan.readyToRun || !plan.confirmToken) return 'needs_info';
  return mode === 'auto' ? 'approved' : 'pending';
}

// Answer CALL-E's clarifying questions and re-plan against the same plan_id.
async function answer(jobId, answerText, { timezone, actor = 'operator' } = {}) {
  const job = store.getJob(jobId);
  if (!job) throw new Error('No such job: ' + jobId);
  const { plan } = await calle.planCall({ userInput: answerText, planId: job.planId, timezone });
  return store.updateJob(jobId, {
    status: statusFromPlan(plan, job.mode),
    planId: plan.planId || job.planId,
    confirmToken: plan.confirmToken,
    readyToRun: plan.readyToRun,
    questions: plan.questions,
    confirmSummary: plan.confirmSummary,
    confirmExpiresAt: plan.confirmExpiresAt,
    displayGoal: plan.displayGoal || job.displayGoal
  }, 'answered_clarifying_questions', actor);
}

// Spend the token. The only path to a real call.
async function dial(jobId, actor = 'operator') {
  const job = store.getJob(jobId);
  if (!job) throw new Error('No such job: ' + jobId);
  if (job.status !== 'approved') throw new Error(`Job ${jobId} is ${job.status}, not approved`);
  if (!job.planId || !job.confirmToken) throw new Error(`Job ${jobId} has no confirm token`);

  const recheck = policy.evaluate(job.recipient || {});
  if (!recheck.ok) {
    return store.updateJob(jobId, { status: 'rejected', blocked: true, policy: recheck }, 'blocked_at_dial', actor);
  }

  const budgetNow = campaign.checkBudget(job.campaignId);
  if (!budgetNow.ok) {
    return store.updateJob(jobId, { status: 'rejected', blocked: true, error: budgetNow.reason },
      'budget_exhausted', actor);
  }

  // Approving a call is not the same as approving it in time.
  if (calle.tokenExpired(job.confirmExpiresAt)) {
    return store.updateJob(jobId, {
      status: 'expired', confirmToken: null,
      error: 'Confirm token expired at ' + job.confirmExpiresAt
    }, 'token_expired', actor);
  }

  store.updateJob(jobId, { status: 'dialing' }, 'dial', actor);
  try {
    const run = await calle.runCall({ plan_id: job.planId, confirm_token: job.confirmToken });
    const runId = run.run_id || null;
    return store.updateJob(jobId, { status: 'dialing', callRunId: runId, confirmToken: null }, 'run_call_sent', actor);
  } catch (err) {
    return store.updateJob(jobId, { status: 'failed', error: err.message }, 'run_call_failed', actor);
  }
}

// Poll until terminal, or until CALL-E asks for a human.
async function follow(jobId, { maxSeconds = 300 } = {}) {
  const started = Date.now();
  let job = store.getJob(jobId);
  if (!job || !job.callRunId) throw new Error(`Job ${jobId} has no run to follow`);

  while (Date.now() - started < maxSeconds * 1000) {
    const run = await calle.getCallRun({ runId: job.callRunId });
    const next = calle.interpretNextStep(run);

    if (next.needsHuman) {
      return store.updateJob(jobId, {
        status: 'needs_human',
        nextStep: next,
        result: calle.extractResult(run)
      }, 'calle_requested_human', 'system');
    }

    if (calle.isTerminal(run.status)) {
      const result = calle.extractResult(run);
      const validation = validate(result.extracted, job.resultSchema);
      return store.updateJob(jobId, {
        status: String(run.status).toUpperCase() === 'COMPLETED' ? 'complete' : 'failed',
        calleStatus: run.status,
        result,
        validation
      }, 'run_terminal', 'system');
    }

    await sleep((next.pollAfterSeconds || 2) * 1000);
    job = store.getJob(jobId);
    if (job.status === 'cancelled') return job;
  }
  return store.updateJob(jobId, {
    status: 'unconfirmed',
    error: 'Timed out waiting for a terminal result. The call may still have completed on CALL-E\'s side. Check with `calle call status`.'
  }, 'follow_timeout_unconfirmed', 'system');
}

// Minimal schema check against result.extracted. No dependency, no build step.
function validate(extracted, schema) {
  if (!schema) return { checked: false, ok: true, errors: [] };
  const errors = [];

  // CALL-E has no slot for a caller-defined schema. result.extracted is always
  // its own run envelope, so when none of the requested fields come back the
  // honest verdict is "the platform does not support this", not "you failed".
  const declared = Object.keys(schema.properties || {});
  const found = declared.filter(k => extracted[k] !== undefined);
  const onlyEnvelope = Object.keys(extracted).every(k => calle.ENVELOPE_KEYS.includes(k));
  if (declared.length && !found.length && onlyEnvelope) {
    return {
      checked: true, ok: false, unsupported: true, missing: declared,
      errors: ['CALL-E returned its run envelope, not the requested fields: ' + declared.join(', ') +
               '. The platform has no caller-defined result schema; its extraction lands in post_summary as prose.']
    };
  }

  const props = schema.properties || {};
  for (const key of schema.required || []) {
    if (extracted[key] === undefined || extracted[key] === null) errors.push(`Missing required field: ${key}`);
  }
  for (const [key, value] of Object.entries(extracted)) {
    const spec = props[key];
    if (!spec) {
      if (schema.additionalProperties === false) errors.push(`Unexpected field: ${key}`);
      continue;
    }
    if (spec.type && typeof value !== spec.type && !(spec.type === 'integer' && Number.isInteger(value))) {
      errors.push(`Field ${key} should be ${spec.type}, got ${typeof value}`);
    }
    if (spec.enum && !spec.enum.includes(value)) {
      errors.push(`Field ${key} value "${value}" is not one of ${spec.enum.join(', ')}`);
    }
  }
  return { checked: true, ok: errors.length === 0, errors };
}

function maskPhone(phone) {
  if (!phone || phone.length < 5) return phone;
  return phone.slice(0, 1) + '•'.repeat(Math.max(0, phone.length - 5)) + phone.slice(-4);
}

function redact(job) {
  if (!job) return job;
  const { confirmToken, ...safe } = job;
  const recipient = safe.recipient
    ? { ...safe.recipient, phone: maskPhone(safe.recipient.phone) }
    : safe.recipient;
  return { ...safe, recipient, hasConfirmToken: Boolean(confirmToken) };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Queue many calls at once. Each recipient gets its own job and its own policy
// verdict, so one bad number does not stop the batch.
async function queueBatch({ recipients = [], userInput, resultSchema, mode = 'require_approval',
                            timezone, campaignId, scheduledFor, haltOnError = false }) {
  const jobs = [];
  for (const r of recipients) {
    const text = typeof userInput === 'function' ? userInput(r) : interpolate(userInput, r);
    try {
      const job = await queue({
        userInput: text, recipient: r, resultSchema, mode, timezone, campaignId,
        scheduledFor: r.scheduledFor || scheduledFor
      });
      jobs.push(job);
    } catch (err) {
      jobs.push({ error: err.message, recipient: r, queueFailed: true });
      if (haltOnError) break;
    }
  }
  return jobs;
}

// {{name}} and {{amount}} in the goal text are filled from the recipient row.
function interpolate(template, row) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) =>
    row[k] === undefined ? '' : String(row[k]));
}

// Promote scheduled jobs that are now due. Called on a tick by the console.
async function promoteDue(now = Date.now()) {
  const due = store.listJobs().filter(j =>
    j.status === 'scheduled' && new Date(j.scheduledFor).getTime() <= now);
  const promoted = [];
  for (const job of due) {
    try {
      const budget = campaign.checkBudget(job.campaignId);
      if (!budget.ok) {
        promoted.push(store.updateJob(job.id, { status: 'rejected', blocked: true, error: budget.reason },
          'budget_exhausted', 'scheduler'));
        continue;
      }
      const { plan } = await calle.planCall({ userInput: job.seeded || job.userInput, timezone: job.timezone });
      promoted.push(store.updateJob(job.id, {
        status: statusFromPlan(plan, job.mode),
        planId: plan.planId,
        confirmToken: plan.confirmToken,
        readyToRun: plan.readyToRun,
        questions: plan.questions,
        confirmSummary: plan.confirmSummary,
        confirmExpiresAt: plan.confirmExpiresAt,
        displayGoal: plan.displayGoal || job.userInput
      }, 'promoted_from_schedule', 'scheduler'));
    } catch (err) {
      promoted.push(store.updateJob(job.id, { status: 'failed', error: err.message },
        'promote_failed', 'scheduler'));
    }
  }
  return promoted;
}

module.exports = { queue, queueBatch, answer, dial, follow, promoteDue, interpolate,
                   validate, redact, statusFromPlan };
