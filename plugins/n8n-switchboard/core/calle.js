// CALL-E adapter.
//
// Everything goes through `calle mcp call <tool> --args-json '<json>'`, the CLI's
// generic MCP passthrough. That binds us to the MCP tool schemas, which we have
// verified, rather than to CLI flag names, which we have not.
//
// Verified tools: plan_call, run_call, get_call_run, track_ui_events.
// There is no cancel tool. Cancellation is ours to provide.
const { execFile } = require('child_process');

const TIMEOUTS = { plan_call: 150, run_call: 60, get_call_run: 15 };

function buildArgv(tool, args, opts = {}) {
  const argv = ['mcp', 'call', tool, '--args-json', JSON.stringify(args), '--json'];
  if (opts.timezone) argv.push('--timezone', opts.timezone);
  argv.push('--timeout-seconds', String(opts.timeoutSeconds || TIMEOUTS[tool] || 30));
  return argv;
}

function mcpCall(tool, args, opts = {}) {
  const argv = buildArgv(tool, args, opts);
  return new Promise((resolve, reject) => {
    execFile('calle', argv, {
      env: { ...process.env },
      maxBuffer: 20 * 1024 * 1024,
      timeout: ((opts.timeoutSeconds || TIMEOUTS[tool] || 30) + 15) * 1000
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        const safe = String(stderr || err.message || '').slice(0, 160);
        return reject(new Error('calle CLI call failed: ' + safe));
      }
      let parsed;
      try { parsed = JSON.parse(stdout); }
      catch { return reject(new Error('Non-JSON response from calle: ' + String(stdout).slice(0, 400))); }
      if (parsed && parsed.ok === false) {
        const e = new Error((parsed.error && parsed.error.message) || 'CALL-E returned ok:false');
        e.calle = parsed;
        return reject(e);
      }
      resolve(parsed);
    });
  });
}

// The CLI wraps every MCP response. The payload we want sits at
// result.structuredContent, with result.content[0].text as a JSON string fallback.
function unwrap(response) {
  const r = response && response.result;
  if (!r) return response || {};
  if (r.structuredContent) return r.structuredContent;
  const text = r.content && r.content[0] && r.content[0].text;
  if (text) { try { return JSON.parse(text); } catch { /* fall through */ } }
  return r;
}

// plan_call takes natural language. Confirmed from `calle mcp call --help`:
//   calle mcp call plan_call --args-json '{"user_input":"Call Alex"}'
//
// Planning is a loop, not one shot. If CALL-E is missing information it returns
// ready_to_run:false with clarifying_questions and a null confirm_token. Answer
// by calling again with the same plan_id.
async function planCall({ userInput, timezone, planId }) {
  const args = { user_input: userInput };
  if (planId) args.plan_id = planId;
  const raw = await mcpCall('plan_call', args, { timezone });
  return { raw, plan: readPlan(unwrap(raw)) };
}

function readPlan(p) {
  return {
    planId: p.plan_id || null,
    readyToRun: Boolean(p.ready_to_run),
    confirmToken: p.confirm_token || null,
    confirmSummary: p.confirm_summary || null,
    confirmExpiresAt: p.confirm_expires_at || null,
    expiresAt: p.expires_at || null,
    displayGoal: p.display_goal || null,
    questions: p.questions || [],
    clarifyingQuestions: p.clarifying_questions || [],
    scheduleMode: p.schedule_mode || 'immediate',
    scheduledAt: p.scheduled_at || null,
    scheduleTimezone: p.schedule_timezone || null
  };
}

// A confirm_token has a shelf life. Approving a call is not the same as
// approving it in time.
function tokenExpired(confirmExpiresAt, now = new Date()) {
  if (!confirmExpiresAt) return false;
  return new Date(confirmExpiresAt).getTime() <= now.getTime();
}

// run_call is annotated destructiveHint:true in the MCP tool list. This is the
// only function here that can dial a real person. Nothing calls it except an
// approved job.
async function runCall(args, opts = {}) {
  return unwrap(await mcpCall('run_call', args, opts));
}

async function getCallRun({ runId, cursor, limit }) {
  const args = { run_id: runId };
  if (cursor) args.cursor = cursor;
  if (limit) args.limit = limit;
  return unwrap(await mcpCall('get_call_run', args));
}

// Dry run. Returns the exact command and payload that would be sent, and sends
// nothing. This is what the console preview screen renders.
function preview(tool, args, opts = {}) {
  const argv = buildArgv(tool, args, opts);
  return {
    tool,
    args,
    command: 'calle ' + argv.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' '),
    destructive: tool === 'run_call',
    wouldDial: tool === 'run_call'
  };
}

// get_call_run returns next_step.action telling the orchestrator what to do next.
// Two of those actions mean "go ask a human", which is what the console is for.
const HUMAN_REQUIRED = ['ask_user_for_missing_info', 'ask_user_for_retry_confirmation'];

function interpretNextStep(run) {
  const step = run && run.next_step;
  if (!step) return { action: 'none', needsHuman: false };
  return {
    action: step.action,
    needsHuman: HUMAN_REQUIRED.includes(step.action),
    instruction: step.instruction || null,
    pollAfterSeconds: step.poll_after_seconds || null,
    requiredUserInput: step.required_user_input || [],
    runId: step.run_id || null,
    planId: step.plan_id || null
  };
}

// Terminal statuses named in the get_call_run output schema.
const TERMINAL = ['COMPLETED', 'NO ANSWER', 'DECLINED', 'FAILED'];
const isTerminal = status => TERMINAL.includes(String(status || '').toUpperCase());

// CALL-E's run envelope. Verified against two live runs: result.extracted always
// holds the same six keys. It is not a slot for caller-defined fields.
const ENVELOPE_KEYS = ['goal', 'region', 'repair', 'calling', 'language', 'to_phones'];

// What CALL-E genuinely returns in machine-readable form. A workflow can branch
// on these. It cannot branch on prose.
function branchable(run) {
  const r = (run && run.result) || {};
  const o = r.outcome || {};
  const call = (r.extracted && r.extracted.calling) || {};
  return {
    taskCompleted: o.task_completed === undefined ? null : o.task_completed,
    confidenceScore: o.completion_confidence ? o.completion_confidence.score : null,
    confidenceLabel: o.completion_confidence ? o.completion_confidence.label : null,
    evidence: o.evidence || [],
    callStatus: call.status || null,
    durationSeconds: call.duration_seconds === undefined ? null : call.duration_seconds,
    calleeCount: call.callee_count === undefined ? null : call.callee_count
  };
}

function extractResult(run) {
  const r = (run && run.result) || {};
  const ex = r.extracted || {};
  return {
    summary: r.summary || r.post_summary || null,
    postSummary: r.post_summary || null,
    envelope: ex,
    extracted: ex,
    branchable: branchable(run),
    transcript: r.transcript || null,
    taskCompleted: r.outcome ? r.outcome.task_completed : null,
    confidence: r.outcome ? r.outcome.completion_confidence : null,
    evidence: (r.outcome && r.outcome.evidence) || [],
    batch: r.batch || null,
    callIds: r.call_ids || []
  };
}

module.exports = {
  mcpCall, planCall, runCall, getCallRun,
  unwrap, readPlan, tokenExpired, branchable, ENVELOPE_KEYS,
  preview, interpretNextStep, extractResult,
  isTerminal, TERMINAL, HUMAN_REQUIRED
};
