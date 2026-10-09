const store = require('../src/store');

describe('store with seeded data', () => {
  beforeEach(() => {
    // Store has seeded data on startup
  });

  test('should have seeded tasks on startup', () => {
    const tasks = store.listTasks();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0]).toHaveProperty('id');
    expect(tasks[0]).toHaveProperty('name');
    expect(tasks[0]).toHaveProperty('sku');
  });

  test('should have seeded quotes on startup', () => {
    const seeded = store.getSeededState();
    expect(seeded.quotes.length).toBeGreaterThan(0);
    expect(seeded.quotes[0]).toHaveProperty('quote_id');
    expect(seeded.quotes[0]).toHaveProperty('supplier_name');
  });

  test('seeded task should have suppliers', () => {
    const tasks = store.listTasks();
    const task = tasks[0];
    expect(task).toHaveProperty('suppliers');
    expect(Array.isArray(task.suppliers)).toBe(true);
    expect(task.suppliers.length).toBeGreaterThan(0);
  });

  test('seeded quote should have transcript', () => {
    const seeded = store.getSeededState();
    const quote = seeded.quotes[0];
    expect(quote).toHaveProperty('transcript');
    expect(Array.isArray(quote.transcript)).toBe(true);
    expect(quote.transcript[0]).toHaveProperty('speaker');
    expect(quote.transcript[0]).toHaveProperty('text');
  });

  test('should create new task', () => {
    const newTask = store.createTask({
      name: 'New Widget Quote',
      sku: 'WIDGET-NEW',
      quantity: 500
    });

    expect(newTask.id).toBeTruthy();
    expect(newTask.name).toBe('New Widget Quote');
    expect(newTask.status).toBe('pending');
    expect(newTask.createdBy).toBe('owner');
  });

  test('should update task', () => {
    const tasks = store.listTasks();
    const taskId = tasks[0].id;

    const updated = store.updateTask(taskId, {
      status: 'completed',
      name: 'Updated Name'
    });

    expect(updated.status).toBe('completed');
    expect(updated.name).toBe('Updated Name');
  });

  test('should get specific task', () => {
    const tasks = store.listTasks();
    const taskId = tasks[0].id;

    const task = store.getTask(taskId);
    expect(task.id).toBe(taskId);
  });

  test('should throw when getting non-existent task', () => {
    expect(() => store.getTask('nonexistent')).toThrow();
  });

  test('should store quote', () => {
    const quoteId = store.storeQuote({
      supplier_name: 'New Supplier',
      sku: 'NEW-SKU',
      phone: '+1-555-0104',
      price_per_unit: 25.00,
      lead_time_days: 10,
      status: 'completed'
    });

    expect(quoteId).toMatch(/^q_/);
    const quote = store.getQuote(quoteId);
    expect(quote.supplier_name).toBe('New Supplier');
  });

  test('should upsert quote by supplier+SKU', () => {
    const initialQuotes = store.listPendingQuotes().length;

    store.storeQuote({
      supplier_name: 'Acme Corp',
      sku: 'WIDGET-42',
      phone: '+1-555-0100',
      price_per_unit: 10.00,
      lead_time_days: 3,
      status: 'completed'
    });

    const finalQuotes = store.listPendingQuotes().length;
    expect(finalQuotes).toBe(initialQuotes);
  });

  test('should list pending quotes', () => {
    const pending = store.listPendingQuotes();
    expect(Array.isArray(pending)).toBe(true);
    expect(pending.length).toBeGreaterThan(0);
    pending.forEach(q => {
      expect(q.status).not.toBe('rejected');
    });
  });

  test('should get top quotes sorted by price', () => {
    store.storeQuote({
      supplier_name: 'Expensive Supplier',
      sku: 'TEST-EXPENSIVE',
      price_per_unit: 100.00,
      status: 'completed'
    });

    store.storeQuote({
      supplier_name: 'Cheap Supplier',
      sku: 'TEST-CHEAP',
      price_per_unit: 5.00,
      status: 'completed'
    });

    const top = store.getTopQuotes(2);
    expect(top.length).toBeLessThanOrEqual(2);
    if (top.length > 1) {
      expect(top[0].price_per_unit).toBeLessThanOrEqual(top[1].price_per_unit);
    }
  });

  test('get state includes all data', () => {
    const state = store.getState();
    expect(state).toHaveProperty('tasks');
    expect(state).toHaveProperty('quotes');
    expect(state).toHaveProperty('activityLog');
    expect(Array.isArray(state.tasks)).toBe(true);
    expect(Array.isArray(state.quotes)).toBe(true);
  });

  test('seeded state is independent', () => {
    const seeded1 = store.getSeededState();
    const seeded2 = store.getSeededState();

    expect(seeded1).not.toBe(seeded2);
    expect(seeded1.tasks).toEqual(seeded2.tasks);
  });
});
