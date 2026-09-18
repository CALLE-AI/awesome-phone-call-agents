const { invoke, activityLog } = require('../src/invoke');

describe('invoke choicepoint', () => {
  beforeEach(() => {
    activityLog.clear();
  });

  test('should create a task through invoke', async () => {
    const result = await invoke('create_task', {
      name: 'Test Quote Request',
      sku: 'TEST-001',
      quantity: 50
    }, 'owner');

    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('id');
    expect(result.result.name).toBe('Test Quote Request');
    expect(result.result.createdBy).toBe('owner');
  });

  test('create_task ignores caller-supplied status/approval fields — a task is never born approved', async () => {
    const result = await invoke('create_task', {
      name: 'Smuggled approval',
      sku: 'SMUGGLE-001',
      quantity: 1,
      status: 'approved',
      approvedAt: '2020-01-01T00:00:00.000Z',
      approvedBy: 'owner',
      rejectedAt: '2020-01-01T00:00:00.000Z',
      rejectedBy: 'owner',
      rejectReason: 'nope'
    }, 'agent');

    expect(result.success).toBe(true);
    expect(result.result.status).toBe('pending');
    expect(result.result.approvedAt).toBeUndefined();
    expect(result.result.approvedBy).toBeUndefined();
    expect(result.result.rejectedAt).toBeUndefined();
    expect(result.result.rejectedBy).toBeUndefined();
    expect(result.result.rejectReason).toBeUndefined();
  });

  test('should log activity when creating a task', async () => {
    const initialCount = activityLog.getAll().length;

    await invoke('create_task', {
      name: 'Logged Task',
      sku: 'LOG-001',
      quantity: 100
    }, 'owner');

    const entries = activityLog.getAll();
    expect(entries.length).toBe(initialCount + 1);
    expect(entries[entries.length - 1].tool).toBe('create_task');
    expect(entries[entries.length - 1].actor).toBe('owner');
  });

  test('should update a task through invoke', async () => {
    const taskId = 'task_1'; // From seeded data
    const result = await invoke('update_task', {
      id: taskId,
      updates: { status: 'completed' }
    }, 'owner');

    expect(result.success).toBe(true);
    expect(result.result.status).toBe('completed');
  });

  test('should list tasks', async () => {
    const result = await invoke('list_tasks', {}, 'owner');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
    expect(result.result.length).toBeGreaterThan(0);
  });

  test('should get a task by id', async () => {
    const result = await invoke('get_task', { id: 'task_1' }, 'owner');

    expect(result.success).toBe(true);
    expect(result.result.id).toBe('task_1');
  });

  test('should handle unknown tool gracefully', async () => {
    const result = await invoke('unknown_tool', {}, 'owner');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });

  test('should fail when actor is missing', async () => {
    try {
      await invoke('create_task', { name: 'Test' }, null);
      throw new Error('Should have thrown an error');
    } catch (error) {
      expect(error.message).toContain('actor required');
    }
  });

  test('should call supplier and return mock response', async () => {
    const result = await invoke('call_supplier', {
      supplier_name: 'Test Supplier',
      phone: '+1-555-0100',
      sku: 'WIDGET-99',
      quantity: 200
    }, 'agent');

    expect(result.success).toBe(true);
    expect(result.result).toHaveProperty('price_per_unit');
    expect(result.result).toHaveProperty('lead_time_days');
    expect(result.result).toHaveProperty('transcript');
  });

  test('should store quote result through invoke', async () => {
    const result = await invoke('store_quote_result', {
      supplier_name: 'Store Test Supplier',
      phone: '+1-555-0103',
      sku: 'STORE-TEST',
      quantity: 100,
      price_per_unit: 15.00,
      lead_time_days: 7,
      payment_terms: 'Net 30'
    }, 'owner');

    expect(result.success).toBe(true);
    expect(result.result).toMatch(/^q_/);
  });

  test('should list pending quotes', async () => {
    const result = await invoke('list_pending_quotes', {}, 'agent');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
  });

  test('should get top quotes for approval', async () => {
    const result = await invoke('request_human_approval', { limit: 2 }, 'agent');

    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
    expect(result.result.length).toBeLessThanOrEqual(2);
  });

  test('create and edit task flow as owner', async () => {
    const createResult = await invoke('create_task', {
      name: 'Multi-step Test',
      sku: 'MULTI-001',
      quantity: 75,
      deliveryDeadline: '2026-09-20'
    }, 'owner');

    expect(createResult.success).toBe(true);
    const taskId = createResult.result.id;

    const updateResult = await invoke('update_task', {
      id: taskId,
      updates: {
        status: 'in-progress',
        name: 'Multi-step Test Updated'
      }
    }, 'owner');

    expect(updateResult.success).toBe(true);
    expect(updateResult.result.status).toBe('in-progress');
    expect(updateResult.result.name).toBe('Multi-step Test Updated');

    const getResult = await invoke('get_task', { id: taskId }, 'owner');
    expect(getResult.success).toBe(true);
    expect(getResult.result.status).toBe('in-progress');
  });
});
