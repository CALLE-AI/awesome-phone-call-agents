const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadOrganization,
  getPerson,
  addPerson,
  updatePerson,
  removePerson,
  resetOrganization
} = require('../src/organization');

const {
  createDeliveryException
} = require('../src/scenarios/delivery');

const { chooseNextPerson, getPersonSelectionRationale, interpretCallResult } = require('../src/orchestrator');
const { planCall } = require('../src/calle');
const { simulateCallResult } = require('../src/simulation');

const defaultOrg = loadOrganization();

test('organization can load and expose people by id', () => {
  assert.ok(defaultOrg);
  assert.ok(defaultOrg.people.length >= 4);
  const arjun = getPerson('arjun');
  assert.equal(arjun.name, 'Arjun');
  assert.equal(arjun.role, 'Driver');
});

test('organization can add and update a person', () => {
  const created = addPerson({
    id: 'nina',
    name: 'Nina',
    role: 'Finance Manager',
    type: 'internal',
    phone: '+91******0123',
    responsibilities: ['Expense approvals'],
    canDecide: ['Approval'],
    connections: []
  });

  assert.equal(created.name, 'Nina');

  const updated = updatePerson('nina', {
    role: 'Finance Director'
  });

  assert.equal(updated.role, 'Finance Director');

  removePerson('nina');
});

test('organization reset restores defaults', () => {
  const org = resetOrganization();
  assert.ok(org.people.some(p => p.id === 'arjun'));
  assert.ok(org.people.some(p => p.id === 'amit'));
  assert.ok(org.people.some(p => p.id === 'priya'));
  assert.ok(org.people.some(p => p.id === 'rahul'));
});

test('delivery scenario creates a valid task template', () => {
  const task = createDeliveryException();
  assert.equal(task.type, 'delivery_exception');
  assert.ok(task.participants.some((person) => person.id === 'arjun'));
  assert.ok(task.goal.includes('delivery'));
});

test('orchestrator skips contacted people and selects the best candidate', () => {
  const task = {
    participants: [
      { id: 'arjun', role: 'Driver' },
      { id: 'amit', role: 'Warehouse Manager' },
      { id: 'priya', role: 'Operations Head' },
      { id: 'rahul', role: 'Customer' }
    ],
    history: [
      { type: 'call_attempt', personId: 'arjun' }
    ]
  };

  const next = chooseNextPerson(task);
  assert.ok(next);
  assert.equal(next.id, 'amit');
});

test('orchestrator progresses through full Delivery Exception workflow in order', () => {
  const task = createDeliveryException();
  task.history = [];

  // 1. Initial person should be Driver (Arjun)
  const step1 = chooseNextPerson(task);
  assert.equal(step1.id, 'arjun');
  const rat1 = getPersonSelectionRationale(task, step1);
  assert.ok(rat1.includes('Driver'));
  task.history.push({ type: 'call_result', personId: 'arjun' });

  // 2. Next person should be Warehouse Manager (Amit)
  const step2 = chooseNextPerson(task);
  assert.equal(step2.id, 'amit');
  const rat2 = getPersonSelectionRationale(task, step2);
  assert.ok(rat2.includes('Warehouse Manager'));
  task.history.push({ type: 'call_result', personId: 'amit' });

  // 3. Next person should be Operations Head (Priya)
  const step3 = chooseNextPerson(task);
  assert.equal(step3.id, 'priya');
  const rat3 = getPersonSelectionRationale(task, step3);
  assert.ok(rat3.includes('Operations Head'));
  task.history.push({ type: 'call_result', personId: 'priya' });

  // 4. Next person should be Customer (Rahul)
  const step4 = chooseNextPerson(task);
  assert.equal(step4.id, 'rahul');
  const rat4 = getPersonSelectionRationale(task, step4);
  assert.ok(rat4.includes('Customer'));
  task.history.push({ type: 'call_result', personId: 'rahul' });

  // 5. Complete
  const step5 = chooseNextPerson(task);
  assert.equal(step5, null);
});

test('simulation produces rich dialogues and structured data', () => {
  const task = createDeliveryException();
  const arjunSim = simulateCallResult({ personId: 'arjun', task });
  assert.equal(arjunSim.status, 'COMPLETED');
  assert.ok(arjunSim.dialogue.length > 0);
  assert.ok(arjunSim.extracted.eta);

  const rahulSim = simulateCallResult({ personId: 'rahul', task });
  const interp = interpretCallResult(rahulSim);
  assert.equal(interp.state, 'RESOLVED');
});

test('simulation mode returns a local CALL-E plan instead of crashing when the CLI is absent', async () => {
  process.env.BRIDGE_MODE = 'simulation';

  const plan = await planCall({
    phone: '+919999999999',
    goal: 'Check delivery status and resolve exception.'
  });

  const parsed = JSON.parse(plan.stdout);
  assert.ok(parsed.plan_id);
  assert.ok(parsed.confirm_token);
  assert.equal(parsed.mode, 'simulation');
});
