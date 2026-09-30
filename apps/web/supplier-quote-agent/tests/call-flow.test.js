const { invoke, activityLog } = require('../src/invoke');
const store = require('../src/store');

describe('call planning and dialing flow (fake provider, per issue #5)', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('plan -> approved -> dialed -> outcome, all through invoke()', async () => {
    const created = await invoke(
      'create_task',
      {
        name: 'TechVend Quote',
        sku: 'WIDGET-42',
        quantity: 100,
        suppliers: [{ name: 'TechVend Inc', phone: '+1-555-0101' }]
      },
      'owner'
    );
    const taskId = created.result.id;

    const planned = await invoke(
      'plan_call',
      {
        id: taskId,
        goal: 'Get a quote for WIDGET-42',
        script_points: [
          'Introduce as procurement agent',
          'Ask unit price',
          'Ask lead time and MOQ'
        ],
        success_criteria: 'Price, lead time, and MOQ captured',
        fallback: 'Leave a voicemail with a callback number'
      },
      'agent'
    );
    expect(planned.success).toBe(true);
    expect(planned.result.status).toBe('planned');
    expect(planned.result.plan.goal).toBe('Get a quote for WIDGET-42');

    // Approval UI is #6's own thesis — approve via the real owner-only action, not a
    // generic update_task workaround.
    const approved = await invoke('approve_task', { id: taskId }, 'owner');
    expect(approved.result.status).toBe('approved');

    const dialed = await invoke('place_call', { id: taskId }, 'agent');
    expect(dialed.success).toBe(true);
    expect(dialed.result.status).toBe('completed');
    expect(dialed.result.call.status).toBe('done');
    expect(dialed.result.outcome).toEqual(
      expect.objectContaining({
        outcome: expect.any(String),
        summary: expect.any(String),
        next_action: expect.any(String)
      })
    );

    const persisted = store.getTask(taskId);
    expect(persisted.outcome).toEqual(dialed.result.outcome);

    const tools = activityLog.getAll().map((e) => e.tool);
    expect(tools).toEqual(['create_task', 'plan_call', 'approve_task', 'place_call']);
  });

  test('place_call refuses a task that is not approved, and leaves it untouched', async () => {
    const created = await invoke('create_task', { name: 'Unapproved', sku: 'X', quantity: 1 }, 'owner');
    const taskId = created.result.id;
    await invoke('plan_call', { id: taskId, goal: 'Get a quote' }, 'agent');

    const result = await invoke('place_call', { id: taskId }, 'agent');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be approved/i);
    expect(result.error).toMatch(/owner/i);
    expect(result.error).toMatch(/dashboard/i);

    const stillPlanned = store.getTask(taskId);
    expect(stillPlanned.status).toBe('planned');
    expect(stillPlanned.outcome).toBeUndefined();
  });

  test('place_call refuses a brand-new (pending, unplanned) task', async () => {
    const created = await invoke('create_task', { name: 'Fresh', sku: 'Y', quantity: 1 }, 'owner');
    const taskId = created.result.id;

    const result = await invoke('place_call', { id: taskId }, 'agent');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/must be approved/i);
  });

  test('place_call uses the fake provider by default — no CALLE_API_KEY required', async () => {
    expect(process.env.CALLE_API_KEY).toBeUndefined();

    const created = await invoke('create_task', { name: 'Safety', sku: 'Z', quantity: 1 }, 'owner');
    const taskId = created.result.id;
    await invoke('plan_call', { id: taskId, goal: 'Get a quote' }, 'agent');
    await invoke('approve_task', { id: taskId }, 'owner');

    const result = await invoke('place_call', { id: taskId }, 'agent');
    expect(result.success).toBe(true);
  });
});
