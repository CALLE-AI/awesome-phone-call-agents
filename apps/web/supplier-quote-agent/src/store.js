const state = {
  tasks: [
    {
      id: 'task_1',
      name: 'Widget-42 Quote Request',
      sku: 'WIDGET-42',
      quantity: 100,
      deliveryDeadline: '2026-09-15',
      status: 'pending',
      suppliers: [
        // DEMO_SUPPLIER_PHONE lets a real call reach a number you own without that
        // number ever entering the repo (the committed default stays in the NANP
        // block reserved for fiction, which verify.sh enforces).
        { name: 'Acme Corp', phone: process.env.DEMO_SUPPLIER_PHONE || '+1-555-0100' },
        { name: 'TechVend Inc', phone: '+1-555-0101' },
        { name: 'Global Parts Ltd', phone: '+1-555-0102' }
      ],
      createdAt: new Date().toISOString(),
      createdBy: 'owner'
    }
  ],
  quotes: [
    {
      quote_id: 'q_1',
      supplier_name: 'Acme Corp',
      phone: '+1-555-0100',
      sku: 'WIDGET-42',
      quantity: 100,
      price_per_unit: 12.50,
      total_price: 1250.00,
      lead_time_days: 5,
      moq: 50,
      payment_terms: 'Net 30',
      confidence_score: 0.92,
      call_id: 'call_001',
      transcript: [
        { speaker: 'agent', text: 'Hi, I\'m calling to request a quote for Widget-42', timestamp: '2026-09-08T12:00:00Z' },
        { speaker: 'supplier', text: 'Thank you. Let me check availability.', timestamp: '2026-09-08T12:00:15Z' }
      ],
      status: 'completed',
      requested_at: '2026-09-08T11:55:00Z',
      completed_at: '2026-09-08T12:05:00Z'
    }
  ],
  activityLog: []
};

let taskSeq = 0;
let quoteSeq = 0;

function createTask(task) {
  const newTask = {
    ...task,
    id: `task_${Date.now()}_${taskSeq++}`,
    createdAt: new Date().toISOString(),
    createdBy: task.createdBy || 'owner',
    status: task.status || 'pending'
  };
  state.tasks.push(newTask);
  return newTask;
}

function updateTask(id, updates) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }
  Object.assign(task, updates);
  return task;
}

function listTasks() {
  return state.tasks;
}

function getTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }
  return task;
}

function storeQuote(quote) {
  const quoteId = quote.quote_id || `q_${Date.now()}_${quoteSeq++}`;
  const existingIndex = state.quotes.findIndex(
    q => q.supplier_name === quote.supplier_name && q.sku === quote.sku
  );
  if (existingIndex >= 0) {
    state.quotes[existingIndex] = { ...quote, quote_id: quoteId };
  } else {
    state.quotes.push({ ...quote, quote_id: quoteId });
  }
  return quoteId;
}

function getQuote(quoteId) {
  const quote = state.quotes.find(q => q.quote_id === quoteId);
  if (!quote) {
    throw new Error(`Quote ${quoteId} not found`);
  }
  return quote;
}

function listPendingQuotes() {
  return state.quotes.filter(q => q.status !== 'rejected');
}

function getTopQuotes(limit = 3) {
  return state.quotes
    .sort((a, b) => (a.price_per_unit || 0) - (b.price_per_unit || 0))
    .slice(0, limit);
}

function getState() {
  return {
    tasks: state.tasks,
    quotes: state.quotes,
    activityLog: state.activityLog
  };
}

function getSeededState() {
  return JSON.parse(JSON.stringify(state));
}

module.exports = {
  createTask,
  updateTask,
  listTasks,
  getTask,
  storeQuote,
  getQuote,
  listPendingQuotes,
  getTopQuotes,
  getState,
  getSeededState
};
