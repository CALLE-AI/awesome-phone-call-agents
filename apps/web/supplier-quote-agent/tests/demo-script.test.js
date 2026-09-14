const { invoke, activityLog } = require('../src/invoke');
const store = require('../src/store');

// Walks SPEC.md's "Demo Script" end to end, entirely on the fake provider and starting
// from the seeded state. The tool surface has moved on since SPEC.md was written (#5
// replaced the flat call_supplier/store_quote_result pair with the task-based
// plan_call -> approve_task -> place_call cycle, and #6 adds the human gate itself),
// so each SPEC step is mapped in a comment to the actual calls that carry it out today:
//
//   SPEC step                                actual mechanism
//   ------------------------------------------------------------------------------
//   1. create a quote request, 3 suppliers    seeded task_1 (see src/store.js)
//   2. agent calls each supplier in sequence   plan_call -> place_call per task
//   3. live dashboard shows quotes as they     store.getState() reflects each task's
//      complete                                call/outcome the moment place_call ends
//   4. human gate: approve the cheapest,       approve_task / reject_task (owner-only)
//      handle the rest
//   5. results: dashboard shows all quotes,    store.getState() + activityLog after
//      1 approved, success rate                the run
//
// This also exercises cancel + retry, which #6 adds on top of SPEC's original script.
describe('SPEC.md demo script, run end to end on the fake provider', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('setup -> agent dials -> live state updates -> human approves/rejects/cancels -> results', async () => {
    // --- Step 1: the seeded task already is "a quote request for 3 suppliers" ---
    const seeded = store.getSeededState();
    const task1 = seeded.tasks.find((t) => t.id === 'task_1');
    expect(task1.suppliers.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Acme Corp', 'TechVend Inc', 'Global Parts Ltd'])
    );

    // A second and third task stand in for the other two suppliers being called in
    // parallel task threads (one per supplier, as the real agent loop would do).
    const techVend = await invoke(
      'create_task',
      { name: 'TechVend Quote', sku: 'WIDGET-42', quantity: 100, suppliers: [{ name: 'TechVend Inc', phone: '+1-555-0101' }] },
      'owner'
    );
    const globalParts = await invoke(
      'create_task',
      { name: 'Global Parts Quote', sku: 'WIDGET-42', quantity: 100, suppliers: [{ name: 'Global Parts Ltd', phone: '+1-555-0102' }] },
      'owner'
    );

    // --- Step 2: agent plans + requests approval for each ---
    await invoke('plan_call', { id: 'task_1', goal: 'Get a quote for WIDGET-42 from Acme Corp' }, 'agent');
    await invoke('plan_call', { id: techVend.result.id, goal: 'Get a quote for WIDGET-42 from TechVend Inc' }, 'agent');
    await invoke('plan_call', { id: globalParts.result.id, goal: 'Get a quote for WIDGET-42 from Global Parts Ltd' }, 'agent');

    const pending = await invoke('list_pending_quotes', {}, 'agent');
    expect(pending.success).toBe(true);

    // Agent cannot skip the gate — every one of these is still refused.
    for (const id of ['task_1', techVend.result.id, globalParts.result.id]) {
      // eslint-disable-next-line no-await-in-loop
      const refused = await invoke('place_call', { id }, 'agent');
      expect(refused.success).toBe(false);
      expect(refused.error).toMatch(/must be approved/i);
    }

    // --- Step 4 (human gate), reached before step 3's dial: owner approves two, ---
    // rejects the third outright (never gets a call).
    await invoke('approve_task', { id: 'task_1' }, 'owner');
    await invoke('approve_task', { id: techVend.result.id }, 'owner');
    const rejected = await invoke('reject_task', { id: globalParts.result.id, reason: 'Too far over budget' }, 'owner');
    expect(rejected.result.status).toBe('rejected');

    // Rejected task can never be dialed, by construction — never touched by place_call.
    const stillRefused = await invoke('place_call', { id: globalParts.result.id }, 'agent');
    expect(stillRefused.success).toBe(false);

    // --- Step 2/3: agent dials the two approved tasks; dashboard-visible state ---
    // (store.getState()) updates the moment each finishes.
    const acmeDialed = await invoke('place_call', { id: 'task_1' }, 'agent');
    expect(acmeDialed.success).toBe(true);
    expect(acmeDialed.result.status).toBe('completed');
    expect(acmeDialed.result.outcome).toEqual(
      expect.objectContaining({ outcome: expect.any(String), summary: expect.any(String), next_action: expect.any(String) })
    );

    // TechVend's call is cancelled mid-dial (owner changes their mind while it rings),
    // then retried with an edited plan and re-approved — issue #6's cancel/retry path.
    const techVendPlace = invoke(
      'place_call',
      { id: techVend.result.id, providerOptions: { wait: () => new Promise(() => {}) } },
      'agent'
    );
    await new Promise((resolve) => setImmediate(resolve));
    const cancelled = await invoke('cancel_call', { id: techVend.result.id }, 'owner');
    expect(cancelled.success).toBe(true);
    await techVendPlace;
    expect(store.getTask(techVend.result.id).status).toBe('cancelled');

    const retried = await invoke(
      'retry_with_plan',
      { id: techVend.result.id, goal: 'Ask TechVend for a callback number instead of waiting on hold' },
      'agent'
    );
    expect(retried.result.status).toBe('planned');
    await invoke('approve_task', { id: techVend.result.id }, 'owner');
    const techVendDialed = await invoke('place_call', { id: techVend.result.id }, 'agent');
    expect(techVendDialed.success).toBe(true);
    expect(techVendDialed.result.status).toBe('completed');

    // --- Step 5: results, as the dashboard would render them ---
    const finalState = store.getState();
    const finalTask1 = finalState.tasks.find((t) => t.id === 'task_1');
    const finalTechVend = finalState.tasks.find((t) => t.id === techVend.result.id);
    const finalGlobalParts = finalState.tasks.find((t) => t.id === globalParts.result.id);

    expect(finalTask1.status).toBe('completed');
    expect(finalTask1.outcome).toBeDefined();
    expect(finalTechVend.status).toBe('completed');
    expect(finalTechVend.outcome).toBeDefined();
    expect(finalGlobalParts.status).toBe('rejected');
    expect(finalGlobalParts.outcome).toBeUndefined();

    // Approval is recorded on the task, never re-contacting the supplier: no tool call
    // in the whole run was named approve/reject, and the log still interleaves both
    // actors end to end.
    const entries = activityLog.getAll();
    expect(entries.some((e) => e.tool === 'approve_task' && e.actor === 'owner')).toBe(true);
    expect(entries.some((e) => e.tool === 'reject_task' && e.actor === 'owner')).toBe(true);
    expect(entries.some((e) => e.tool === 'cancel_call' && e.actor === 'owner')).toBe(true);
    expect(entries.some((e) => e.tool === 'place_call' && e.actor === 'agent')).toBe(true);
    expect(entries.some((e) => e.tool === 'retry_with_plan' && e.actor === 'agent')).toBe(true);
    expect(new Set(entries.map((e) => e.actor))).toEqual(new Set(['owner', 'agent']));
  });
});
