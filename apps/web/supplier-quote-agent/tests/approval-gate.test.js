const { invoke, activityLog } = require('../src/invoke');
const store = require('../src/store');
const { tools, getAllTools, getToolByName, OWNER_ONLY_CLAUSE } = require('../src/tools');

// This is the entry's thesis (issue #6): Approve/Reject exist only as owner buttons on
// the dashboard. No registered tool — present or future — may move a task to
// "approved" (or "rejected"). These tests check the actual registry, not just the
// current file by eye, so a future addition trips a real assertion.
describe('the approval gate — no registered tool can approve or reject', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('the full agent tool registry is exactly this allow-list', () => {
    const names = getAllTools().map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'cancel_call',
        'get_quote_status',
        'get_task',
        'list_pending_quotes',
        'list_tasks',
        'plan_call',
        'place_call',
        'request_human_approval',
        'retry_with_plan'
      ].sort()
    );
  });

  test('no tool named approve/reject is registered, under any spelling', () => {
    const names = getAllTools().map((t) => t.name.toLowerCase());
    for (const bad of ['approve_task', 'reject_task', 'approve', 'reject', 'approve_call', 'reject_call']) {
      expect(names).not.toContain(bad);
    }
    expect(getToolByName('approve_task')).toBeUndefined();
    expect(getToolByName('reject_task')).toBeUndefined();
  });

  test('every registered tool description states approve/reject are owner-only', () => {
    expect(tools.length).toBeGreaterThan(0);
    tools.forEach((t) => {
      expect(t.description).toEqual(expect.stringContaining(OWNER_ONLY_CLAUSE));
    });
  });

  test('mutating tools also spell out, in their own words, that they cannot approve', () => {
    const mustMentionApproval = ['plan_call', 'place_call', 'cancel_call', 'retry_with_plan'];
    mustMentionApproval.forEach((name) => {
      const tool = getToolByName(name);
      expect(tool).toBeDefined();
      expect(tool.description).toMatch(/approv/i);
    });
  });

  test('executing every registered tool never results in any task reaching status "approved"', async () => {
    const created = await invoke('create_task', { name: 'Gate check', sku: 'GATE-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    // Try every tool with the most permissive args we can throw at it (including a
    // literal attempt to smuggle status through anything that takes free-form input).
    for (const tool of getAllTools()) {
      const attempts = [
        { id },
        { id, status: 'approved' },
        { id, updates: { status: 'approved' } },
        { id, goal: 'approved', script_points: ['approved'] }
      ];
      for (const args of attempts) {
        // eslint-disable-next-line no-await-in-loop
        await tool.execute(args, 'agent').catch(() => {});
      }
    }

    expect(store.getTask(id).status).not.toBe('approved');
  });

  test('approve_task is owner-only even called directly on invoke() (defense in depth)', async () => {
    const created = await invoke('create_task', { name: 'DiD check', sku: 'DID-1', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');

    const asAgent = await invoke('approve_task', { id }, 'agent');
    expect(asAgent.success).toBe(false);
    expect(asAgent.error).toMatch(/owner-only/i);
    expect(store.getTask(id).status).toBe('planned');

    const asOwner = await invoke('approve_task', { id }, 'owner');
    expect(asOwner.success).toBe(true);
    expect(asOwner.result.status).toBe('approved');
  });

  test('reject_task is owner-only even called directly on invoke() (defense in depth)', async () => {
    const created = await invoke('create_task', { name: 'DiD reject', sku: 'DID-2', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');

    const asAgent = await invoke('reject_task', { id }, 'agent');
    expect(asAgent.success).toBe(false);
    expect(asAgent.error).toMatch(/owner-only/i);
    expect(store.getTask(id).status).toBe('planned');

    const asOwner = await invoke('reject_task', { id, reason: 'too expensive' }, 'owner');
    expect(asOwner.success).toBe(true);
    expect(asOwner.result.status).toBe('rejected');
  });

  test('approve_task refuses a task that is not planned', async () => {
    const created = await invoke('create_task', { name: 'Too early', sku: 'EARLY-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    const result = await invoke('approve_task', { id }, 'owner');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be approved from status "pending"/i);
  });

  test('update_task can no longer be used to sneak a task to approved or rejected', async () => {
    const created = await invoke('create_task', { name: 'Loophole check', sku: 'LOOP-1', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');

    const viaApprove = await invoke('update_task', { id, updates: { status: 'approved' } }, 'owner');
    expect(viaApprove.success).toBe(false);
    expect(viaApprove.error).toMatch(/approve_task/i);
    expect(store.getTask(id).status).toBe('planned');

    const viaReject = await invoke('update_task', { id, updates: { status: 'rejected' } }, 'owner');
    expect(viaReject.success).toBe(false);
    expect(viaReject.error).toMatch(/reject_task/i);
    expect(store.getTask(id).status).toBe('planned');

    // Other fields still update fine — only approval/rejection is blocked.
    const rename = await invoke('update_task', { id, updates: { name: 'Renamed' } }, 'owner');
    expect(rename.success).toBe(true);
    expect(rename.result.name).toBe('Renamed');
  });

  test('changing the plan on an approved task requires renewed approval', async () => {
    const created = await invoke(
      'create_task',
      { name: 'Bait and switch (plan)', sku: 'SWAP-1', quantity: 1 },
      'owner'
    );
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Original goal' }, 'agent');
    await invoke('approve_task', { id }, 'owner');
    expect(store.getTask(id).status).toBe('approved');

    const swapped = await invoke(
      'update_task',
      { id, updates: { plan: { goal: 'A completely different goal' } } },
      'agent'
    );
    expect(swapped.success).toBe(true);
    expect(swapped.result.status).toBe('planned');
    expect(swapped.result.approvedAt).toBeUndefined();
    expect(swapped.result.approvedBy).toBeUndefined();

    // The swapped plan cannot dial on the strength of the old approval.
    const blocked = await invoke('place_call', { id }, 'agent');
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/must be approved/i);
  });

  test('changing the supplier list on an approved task requires renewed approval', async () => {
    const created = await invoke(
      'create_task',
      {
        name: 'Bait and switch (recipient)',
        sku: 'SWAP-2',
        quantity: 1,
        suppliers: [{ name: 'Acme Corp', phone: '+1-555-0100' }]
      },
      'owner'
    );
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');
    expect(store.getTask(id).status).toBe('approved');

    const swapped = await invoke(
      'update_task',
      { id, updates: { suppliers: [{ name: 'Attacker Inc', phone: '+1-555-0199' }] } },
      'agent'
    );
    expect(swapped.success).toBe(true);
    expect(swapped.result.status).toBe('planned');
    expect(swapped.result.approvedAt).toBeUndefined();

    const blocked = await invoke('place_call', { id }, 'agent');
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/must be approved/i);
  });

  test('update_task cannot overwrite a task\'s own id, orphaning it from future lookups', async () => {
    const created = await invoke('create_task', { name: 'Identity check', sku: 'ID-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    const result = await invoke('update_task', { id, updates: { id: 'task_hijacked', name: 'still allowed' } }, 'agent');

    expect(result.success).toBe(true);
    expect(result.result.id).toBe(id);
    expect(result.result.name).toBe('still allowed');
    // The original id still resolves — nothing was orphaned.
    expect(store.getTask(id).id).toBe(id);
  });

  test('update_task cannot stamp fabricated approval/rejection metadata on any task', async () => {
    const created = await invoke('create_task', { name: 'Metadata forgery', sku: 'FORGE-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    const result = await invoke(
      'update_task',
      {
        id,
        updates: {
          name: 'still allowed',
          approvedAt: '2020-01-01T00:00:00.000Z',
          approvedBy: 'owner',
          rejectedAt: '2020-01-01T00:00:00.000Z',
          rejectedBy: 'owner',
          rejectReason: 'forged'
        }
      },
      'agent'
    );

    expect(result.success).toBe(true);
    expect(result.result.name).toBe('still allowed');
    expect(result.result.approvedAt).toBeUndefined();
    expect(result.result.approvedBy).toBeUndefined();
    expect(result.result.rejectedAt).toBeUndefined();
    expect(result.result.rejectedBy).toBeUndefined();
    expect(result.result.rejectReason).toBeUndefined();
    expect(result.result.status).toBe('pending');
  });

  test('update_task on a task not currently approved leaves plan/suppliers changes alone', async () => {
    const created = await invoke('create_task', { name: 'Not yet approved', sku: 'PLAN-1', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'First draft' }, 'agent');
    expect(store.getTask(id).status).toBe('planned');

    const edited = await invoke(
      'update_task',
      { id, updates: { plan: { goal: 'Revised before approval' } } },
      'agent'
    );
    expect(edited.success).toBe(true);
    expect(edited.result.status).toBe('planned');
    expect(edited.result.plan.goal).toBe('Revised before approval');
  });

  test('reject_task refuses while a call is in flight', async () => {
    const created = await invoke('create_task', { name: 'Mid-call reject', sku: 'MID-1', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');

    const placePromise = invoke(
      'place_call',
      { id, providerOptions: { wait: () => new Promise(() => {}) } },
      'agent'
    );
    await flushMicrotasks();

    const result = await invoke('reject_task', { id }, 'owner');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/in flight/i);

    await invoke('cancel_call', { id }, 'owner');
    await placePromise;
  });
});

describe('cancel_call', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('refuses when nothing is currently dialing for that task', async () => {
    const created = await invoke('create_task', { name: 'Nothing dialing', sku: 'NONE-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    const result = await invoke('cancel_call', { id }, 'owner');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no in-flight call/i);
  });

  test('cancels a genuinely in-flight fake call and narrates it in the activity log', async () => {
    const created = await invoke(
      'create_task',
      { name: 'Cancel me', sku: 'CANCEL-1', quantity: 1, suppliers: [{ name: 'Acme Corp', phone: '+1-555-0100' }] },
      'owner'
    );
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');

    // A `wait` that never resolves on its own stands in for a call still ringing —
    // only an abort (from cancel_call) can end it.
    const placePromise = invoke(
      'place_call',
      { id, providerOptions: { wait: () => new Promise(() => {}) } },
      'agent'
    );
    await flushMicrotasks();

    const cancelled = await invoke('cancel_call', { id }, 'owner');
    expect(cancelled.success).toBe(true);
    expect(cancelled.result.message).toMatch(/cancelled the in-flight call/i);

    const placed = await placePromise;
    expect(placed.success).toBe(false);
    expect(placed.error).toMatch(/abort/i);

    const task = store.getTask(id);
    expect(task.status).toBe('cancelled');
    expect(task.call.status).toBe('cancelled');
    expect(task.outcome).toBeUndefined();

    const entries = activityLog.getAll();
    const cancelEntry = entries.find((e) => e.tool === 'cancel_call');
    expect(cancelEntry).toBeDefined();
    expect(cancelEntry.actor).toBe('owner');
    expect(cancelEntry.result.message).toMatch(/cancelled/i);

    const placeEntry = entries.find((e) => e.tool === 'place_call');
    expect(placeEntry.actor).toBe('agent');
    expect(placeEntry.result.error).toMatch(/abort/i);

    // Both actors show up, interleaved, for the same task.
    expect(entries.map((e) => e.actor)).toEqual(expect.arrayContaining(['agent', 'owner']));
  });

  test('against a provider with no real cancel operation, stopping local waiting is never reported as "cancelled"', async () => {
    const created = await invoke(
      'create_task',
      { name: 'Cancel me (no real cancel)', sku: 'CANCEL-2', quantity: 1 },
      'owner'
    );
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');

    // Simulates a provider like CallEProvider, whose network API offers no client
    // cancel operation — a fake with no network, so this stays deterministic.
    const placePromise = invoke(
      'place_call',
      { id, providerOptions: { wait: () => new Promise(() => {}), cancelIsAuthoritative: false } },
      'agent'
    );
    await flushMicrotasks();

    const cancelled = await invoke('cancel_call', { id }, 'owner');
    expect(cancelled.success).toBe(true);
    expect(cancelled.result.message).not.toMatch(/^cancelled/i);
    expect(cancelled.result.message).toMatch(/unknown/i);

    await placePromise;

    const task = store.getTask(id);
    expect(task.status).toBe('cancel_requested');
    expect(task.call.status).toBe('cancel_requested');
  });
});

describe('place_call ignores caller-supplied provider selection/config', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('a "provider" arg cannot select the real provider — the env-unconfigured default still dials the fake one', async () => {
    const created = await invoke('create_task', { name: 'No provider override', sku: 'PROV-1', quantity: 1 }, 'owner');
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id }, 'owner');

    // CALLE_API_KEY/CALL_PROVIDER are unset in the test process — if `provider: 'calle'`
    // reached provider selection this would throw ("CALLE_API_KEY is not set..."); it
    // succeeding on the deterministic fake path proves the arg was never read.
    const result = await invoke('place_call', { id, provider: 'calle' }, 'agent');
    expect(result.success).toBe(true);
    expect(result.result.status).toBe('completed');
  });

  // What happens when CALL_PROVIDER=calle and providerOptions carries a baseUrl/apiKey —
  // proving those never reach the real provider — needs to intercept provider selection
  // itself rather than let a real CallEProvider dial out; see
  // tests/invoke-provider-security.test.js for that (a live invoke() call here would
  // otherwise open a real socket to prove a negative, which this suite never does).
});

describe('retry_with_plan', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('refuses on a task that has never been attempted', async () => {
    const created = await invoke('create_task', { name: 'Never tried', sku: 'NEVER-1', quantity: 1 }, 'owner');
    const id = created.result.id;

    const result = await invoke('retry_with_plan', { id, goal: 'Try again' }, 'agent');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be retried from status "pending"/i);
  });

  test('resets a cancelled task to planned, clearing prior outcome/call, and still requires re-approval', async () => {
    const created = await invoke(
      'create_task',
      { name: 'Retry after cancel', sku: 'RETRY-1', quantity: 1 },
      'owner'
    );
    const id = created.result.id;
    await invoke('plan_call', { id, goal: 'First attempt' }, 'agent');
    await invoke('approve_task', { id }, 'owner');

    const placePromise = invoke(
      'place_call',
      { id, providerOptions: { wait: () => new Promise(() => {}) } },
      'agent'
    );
    await flushMicrotasks();
    await invoke('cancel_call', { id }, 'owner');
    await placePromise;
    expect(store.getTask(id).status).toBe('cancelled');

    const retried = await invoke(
      'retry_with_plan',
      { id, goal: 'Second attempt, ask for a callback instead', script_points: ['Ask for a callback'] },
      'agent'
    );
    expect(retried.success).toBe(true);
    expect(retried.result.status).toBe('planned');
    expect(retried.result.plan.goal).toBe('Second attempt, ask for a callback instead');
    expect(retried.result.outcome).toBeUndefined();
    expect(retried.result.call).toBeUndefined();

    // retry_with_plan never approves — place_call must still refuse until re-approved.
    const stillGated = await invoke('place_call', { id }, 'agent');
    expect(stillGated.success).toBe(false);
    expect(stillGated.error).toMatch(/must be approved/i);

    await invoke('approve_task', { id }, 'owner');
    const redialed = await invoke('place_call', { id }, 'agent');
    expect(redialed.success).toBe(true);
    expect(redialed.result.status).toBe('completed');
  });
});

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}
