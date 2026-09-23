const store = require('./store');
const { getProvider } = require('./providers');
const { MASK_SIGNATURE } = require('./mask');

// Every response masks phone numbers, and the dashboard pre-fills its plan editor from a
// response — so a plan saved back verbatim would store "•••••NN" where the owner's words
// were. Refused rather than stored, so the corruption is visible at the moment it happens.
function assertPlanNotMasked(plan) {
  const texts = [plan.goal, plan.fallback]
    .concat(plan.script_points || [], plan.success_criteria || [])
    .filter((t) => typeof t === 'string');
  if (texts.some((t) => MASK_SIGNATURE.test(t))) {
    throw new Error(
      'Plan text contains a masked phone number ("•••••" followed by two digits) — it was ' +
      'copied from a masked view. Rewrite that part of the plan in full before saving it.'
    );
  }
}

class ActivityLog {
  constructor() {
    this.entries = [];
  }

  log(tool, args, actor, result) {
    this.entries.push({
      timestamp: new Date().toISOString(),
      actor,
      tool,
      args,
      result
    });
  }

  getAll() {
    return this.entries;
  }

  clear() {
    this.entries = [];
  }
}

const activityLog = new ActivityLog();

// Per-task AbortController for a call currently in flight, populated by placeCall()
// for the duration of the dial and read by cancel_call. Never touched by a tool
// schema — it's plumbing internal to this chokepoint.
const inFlightControllers = new Map();

async function invoke(tool, args, actor) {
  if (!actor) {
    throw new Error('actor required');
  }

  let result;
  try {
    switch (tool) {
      case 'create_task': {
        // A new task always starts pending. status/approvedAt/approvedBy/rejected* are
        // never caller-supplied here — approve_task is the only place status can become
        // "approved", so a task cannot be born pre-approved through this path.
        // eslint-disable-next-line no-unused-vars
        const { status, approvedAt, approvedBy, rejectedAt, rejectedBy, rejectReason, ...safeArgs } = args || {};
        result = store.createTask(safeArgs);
        break;
      }
      case 'update_task': {
        const nextStatus = args && args.updates && args.updates.status;
        if (nextStatus === 'approved' || nextStatus === 'rejected') {
          throw new Error(
            `update_task cannot set status to "${nextStatus}" — use approve_task/reject_task ` +
            '(owner-only, never a registered tool) instead.'
          );
        }
        // approve_task/reject_task are the only place these fields are ever written —
        // stripped here the same way create_task strips them, so a caller can't stamp
        // fabricated approval/rejection metadata onto a task through the generic path,
        // even one that never touches `status` itself. `id` is stripped too — a task's
        // own identity is never a field this path may rewrite; doing so would silently
        // orphan the original id from every future lookup.
        // eslint-disable-next-line no-unused-vars
        const { id: _id, approvedAt, approvedBy, rejectedAt, rejectedBy, rejectReason, ...updates } =
          { ...(args && args.updates) };
        if (updates.plan && typeof updates.plan === 'object') {
          assertPlanNotMasked(updates.plan);
        }
        const task = store.getTask(args.id);
        // Changing what an approval actually covers — the plan or who gets called —
        // invalidates that approval rather than silently carrying it over; place_call
        // only dials a task the owner approved with this exact content.
        const changesApprovedContent = task.status === 'approved' &&
          (Object.prototype.hasOwnProperty.call(updates, 'plan') ||
            Object.prototype.hasOwnProperty.call(updates, 'suppliers'));
        if (changesApprovedContent) {
          delete task.approvedAt;
          delete task.approvedBy;
          updates.status = 'planned';
        }
        result = store.updateTask(args.id, updates);
        break;
      }
      case 'approve_task':
        result = approveTask(args, actor);
        break;
      case 'reject_task':
        result = rejectTask(args, actor);
        break;
      case 'list_tasks':
        result = store.listTasks();
        break;
      case 'get_task':
        result = store.getTask(args.id);
        break;
      case 'plan_call': {
        const { id, goal, script_points, success_criteria, fallback } = args;
        const plan = { goal, script_points, success_criteria, fallback };
        assertPlanNotMasked(plan);
        result = store.updateTask(id, { plan, status: 'planned' });
        break;
      }
      case 'place_call':
        result = await placeCall(args);
        break;
      case 'cancel_call':
        result = cancelCall(args);
        break;
      case 'retry_with_plan':
        result = retryWithPlan(args);
        break;
      case 'call_supplier': {
        // Mock supplier call - returns fake response
        const mockResult = await mockCallSupplier(args);
        const quoteId = store.storeQuote(mockResult);
        result = { ...mockResult, quote_id: quoteId };
        break;
      }
      case 'get_quote_status':
        result = store.getQuote(args.quote_id);
        break;
      case 'store_quote_result':
        result = store.storeQuote(args);
        break;
      case 'list_pending_quotes':
        result = store.listPendingQuotes();
        break;
      case 'request_human_approval':
        result = store.getTopQuotes(args.limit || 3);
        break;
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }

    activityLog.log(tool, args, actor, result);
    return {
      success: true,
      result,
      activity: activityLog.entries[activityLog.entries.length - 1]
    };
  } catch (error) {
    const errorResult = { error: error.message };
    activityLog.log(tool, args, actor, errorResult);
    return {
      success: false,
      error: error.message,
      activity: activityLog.entries[activityLog.entries.length - 1]
    };
  }
}

// Hands a task to the configured CallProvider (fake by default — see src/providers/index.js).
// Only acts on a task already approved — approval itself lives entirely outside this
// function, in approveTask() below, and never here.
async function placeCall({ id, scenario, providerOptions } = {}) {
  const task = store.getTask(id);
  if (task.status !== 'approved') {
    throw new Error(
      `Task ${id} must be approved by the owner before calling (status: "${task.status}"). ` +
      'Ask the owner to approve it from the dashboard — no tool call can approve a task.'
    );
  }

  // Which provider dials is an operator decision (CALL_PROVIDER in the server environment), never
  // a per-call one — no field in args can select or reconfigure it. providerOptions is a
  // same-process test hook (e.g. a `wait` that never resolves on its own, so a concurrent
  // cancel_call has something real to interrupt) and is honoured only for the fake
  // provider; the real provider is always built from environment alone, with zero
  // per-call overrides, so no request body can touch its credentials or destination.
  const providerName = process.env.CALL_PROVIDER || 'fake';
  const provider = getProvider(providerName, providerName === 'fake' ? providerOptions : undefined);
  const controller = new AbortController();
  inFlightControllers.set(id, { controller, provider });

  const onStatusChange = (status, at) => {
    store.updateTask(id, { call: { status, updatedAt: at } });
  };

  try {
    const outcome = await provider.placeCall(task, { onStatusChange, signal: controller.signal, scenario });
    return store.updateTask(id, {
      status: 'completed',
      call: { status: 'done', updatedAt: new Date().toISOString() },
      outcome
    });
  } catch (error) {
    const aborted = error.name === 'AbortError';
    if (aborted && !provider.cancelIsAuthoritative) {
      // The provider has no client cancel operation: aborting only stopped this process
      // waiting, so the phone call may still be ringing, connecting, or already billed
      // to an outcome we never fetched. "cancelled" would be a claim about the provider
      // side we can't back up — leave it unresolved for reconciliation instead.
      store.updateTask(id, {
        status: 'cancel_requested',
        call: { status: 'cancel_requested', updatedAt: new Date().toISOString() }
      });
    } else {
      store.updateTask(id, {
        status: aborted ? 'cancelled' : 'failed',
        call: { status: aborted ? 'cancelled' : 'failed', updatedAt: new Date().toISOString() }
      });
    }
    throw error;
  } finally {
    inFlightControllers.delete(id);
  }
}

// Stops a call already in flight (dialing/connected/wrapping_up) by aborting the
// AbortController placeCall() registered for this task. Agent-callable — cancelling
// never approves, rejects, or retries anything, it only ends the dial.
function cancelCall({ id } = {}) {
  const inFlight = inFlightControllers.get(id);
  if (!inFlight) {
    throw new Error(`Task ${id} has no in-flight call to cancel — nothing is currently dialing.`);
  }
  const { controller, provider } = inFlight;
  const task = store.getTask(id);
  const stage = (task.call && task.call.status) || 'dialing';
  controller.abort();
  if (!provider.cancelIsAuthoritative) {
    return {
      id,
      cancelledAtStage: stage,
      message: `Requested cancellation for task ${id} while it was "${stage}" — the real ` +
        'provider has no client cancel operation, so the call may still be ringing or ' +
        'already connected. The outcome is unknown until reconciled against the provider directly.'
    };
  }
  return {
    id,
    cancelledAtStage: stage,
    message: `Cancelled the in-flight call for task ${id} while it was "${stage}".`
  };
}

// Replaces the plan on a task that has already been attempted (completed, failed, or
// rejected) and resets it to "planned" for a fresh cycle. Like plan_call, this can
// never set status to "approved" — a fresh owner approval is required before
// place_call will dial it again.
function retryWithPlan({ id, goal, script_points, success_criteria, fallback } = {}) {
  const plan = { goal, script_points, success_criteria, fallback };
  assertPlanNotMasked(plan);
  const task = store.getTask(id);
  // cancel_requested is retryable too — against the real provider a cancelled wait
  // leaves the provider-side outcome unknown, with no automatic reconciliation, so
  // retrying here is the owner's own informed call, not this app's.
  const retryableStatuses = ['completed', 'failed', 'rejected', 'cancelled', 'cancel_requested'];
  if (!retryableStatuses.includes(task.status)) {
    throw new Error(
      `Task ${id} cannot be retried from status "${task.status}" — retry_with_plan only applies ` +
      'after a call has finished, failed, been cancelled, or been rejected (use plan_call for a ' +
      'task that has not been attempted yet).'
    );
  }

  delete task.outcome;
  delete task.call;
  delete task.approvedAt;
  delete task.approvedBy;
  delete task.rejectedAt;
  delete task.rejectedBy;
  delete task.rejectReason;

  return store.updateTask(id, { plan, status: 'planned' });
}

// Owner-only. Never a registered tool (see tools.js) — this is the only function in
// the codebase that may set status: "approved", and it refuses to run for any other actor.
function approveTask({ id } = {}, actor) {
  if (actor !== 'owner') {
    throw new Error('approve_task is an owner-only action; no agent tool can approve a task.');
  }
  const task = store.getTask(id);
  if (task.status !== 'planned') {
    throw new Error(`Task ${id} cannot be approved from status "${task.status}" — only a planned task can be approved.`);
  }
  return store.updateTask(id, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: actor
  });
}

// Owner-only. Never a registered tool (see tools.js). Refuses while a call is in
// flight so it can't race placeCall()'s own status update — cancel_call it first.
function rejectTask({ id, reason } = {}, actor) {
  if (actor !== 'owner') {
    throw new Error('reject_task is an owner-only action; no agent tool can reject a task.');
  }
  const task = store.getTask(id);
  if (inFlightControllers.has(id)) {
    throw new Error(`Task ${id} has a call in flight — cancel_call it first before rejecting.`);
  }
  if (!['planned', 'approved'].includes(task.status)) {
    throw new Error(`Task ${id} cannot be rejected from status "${task.status}".`);
  }
  return store.updateTask(id, {
    status: 'rejected',
    rejectedAt: new Date().toISOString(),
    rejectedBy: actor,
    rejectReason: reason
  });
}

async function mockCallSupplier(args) {
  return {
    supplier_name: args.supplier_name || 'Test Supplier',
    phone: args.phone || '+1-555-0100',
    sku: args.sku,
    quantity: args.quantity,
    price_per_unit: Math.round(Math.random() * 50 * 100) / 100,
    total_price: args.quantity * (Math.round(Math.random() * 50 * 100) / 100),
    lead_time_days: Math.floor(Math.random() * 14) + 1,
    moq: args.moq || 10,
    payment_terms: 'Net 30',
    confidence_score: 0.85 + Math.random() * 0.15,
    call_id: `call_${Date.now()}`,
    transcript: [
      { speaker: 'agent', text: `Hi, I'm calling to request a quote for ${args.sku}`, timestamp: new Date().toISOString() },
      { speaker: 'supplier', text: 'Thank you. Let me check availability.', timestamp: new Date(Date.now() + 1000).toISOString() }
    ],
    status: 'completed',
    requested_at: new Date().toISOString(),
    completed_at: new Date(Date.now() + 5000).toISOString()
  };
}

module.exports = {
  invoke,
  activityLog
};
