import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluatePairs, formatTime } from '../web/engine.js';

const fixture = JSON.parse(await readFile(new URL('../web/scenario.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);
const pair = (result, storage = 'riverside', carrier = 'swift') =>
  result.pairs.find((item) => item.storage_id === storage && item.carrier_id === carrier);

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test('default rehearsal checks all six pairs and proposes the full-load Riverside handoff', () => {
  const result = evaluatePairs(fixture);
  assert.equal(result.pairs.length, 6);
  assert.equal(result.feasible.length, 1);
  assert.deepEqual(result.best, pair(result));
  assert.equal(result.best.id, 'riverside--swift');
  assert.equal(result.best.cost_usd, 310);
  assert.equal(result.best.arrival_min, 865);
  assert.equal(result.best.handoff_min, 865);
  assert.equal(result.best.slack_min, 35);
  assert.deepEqual(result.best.reasons, []);
  assert.match(pair(result, 'orchard').reasons.join(' '), /receiv|clos|cutoff/i);
  assert.match(pair(result, 'hillcrest').reasons.join(' '), /temperature/i);
  assert.match(pair(result, 'orchard', 'local').reasons.join(' '), /capacity|carries|load/i);
});

test('650 kg allows the earlier $190 local van and Orchard handoff', () => {
  const result = evaluatePairs(fixture, { quantity_kg: 650 });
  assert.equal(result.feasible.length, 3);
  assert.equal(result.best.id, 'orchard--local');
  assert.equal(result.best.cost_usd, 190);
  assert.equal(result.best.handoff_min, 825);
  assert.equal(result.lot.quantity_kg, 650);
});

test('a 14:00 deadline leaves no complete 900 kg handoff', () => {
  const result = evaluatePairs(fixture, { latest_arrival_min: 840 });
  assert.equal(result.best, null);
  assert.deepEqual(result.feasible, []);
  assert.match(pair(result).reasons.join(' '), /deadline/i);
});

test('budget boundaries are inclusive and can eliminate every pair', () => {
  assert.equal(evaluatePairs(fixture, { budget_usd: 310 }).best.cost_usd, 310);
  const result = evaluatePairs(fixture, { budget_usd: 309.99 });
  assert.equal(result.best, null);
  assert.match(pair(result).reasons.join(' '), /budget/i);
});

test('an unavailable storage is excluded without deleting its explanatory pair', () => {
  const result = evaluatePairs(fixture, { unavailable_storage_ids: ['riverside'] });
  assert.equal(result.pairs.length, 6);
  assert.equal(result.best, null);
  assert.match(pair(result).reasons.join(' '), /unavailable/i);
});

test('the solver does not mutate inputs and only applies permitted lot overrides', () => {
  const input = freeze(fresh());
  const overrides = freeze({ quantity_kg: 650, min_temp_c: 6, unavailable_storage_ids: ['hillcrest'] });
  const before = structuredClone(input);
  const result = evaluatePairs(input, overrides);
  assert.deepEqual(input, before);
  assert.equal(result.lot.min_temp_c, 0);
  assert.equal(result.lot.quantity_kg, 650);
  assert.notEqual(result.lot, input.lot);
});

for (const value of [undefined, null, NaN, Infinity, -1, 0, '900']) {
  test(`invalid quantity ${String(value)} cannot become an eligible lot`, () => {
    const result = evaluatePairs(fixture, { quantity_kg: value });
    assert.equal(result.best, null);
    assert.ok(result.pairs.every((item) => item.reasons.some((reason) => /quantity/i.test(reason))));
  });
}

test('positive fractional kilograms are allowed without rounding the load down', () => {
  assert.equal(evaluatePairs(fixture, { quantity_kg: 650.5 }).best.id, 'orchard--local');
  assert.equal(evaluatePairs(fixture, { quantity_kg: 1000.01 }).best, null);
});

for (const [location, field] of [
  ['lot', 'min_temp_c'], ['lot', 'max_temp_c'], ['lot', 'latest_arrival_min'], ['lot', 'budget_usd'],
  ['storage', 'capacity_kg'], ['storage', 'min_temp_c'], ['storage', 'max_temp_c'],
  ['storage', 'receive_from_min'], ['storage', 'receive_until_min'], ['storage', 'cost_usd'],
  ['storage', 'valid_until_min'], ['carrier', 'capacity_kg'], ['carrier', 'min_temp_c'],
  ['carrier', 'max_temp_c'], ['carrier', 'pickup_min'], ['carrier', 'cost_usd'], ['carrier', 'valid_until_min'],
]) {
  test(`missing ${location}.${field} is unknown, never zero`, () => {
    const input = fresh();
    const target = location === 'lot' ? input.lot : location === 'storage' ? input.storages[1] : input.carriers[0];
    delete target[field];
    const result = evaluatePairs(input);
    assert.equal(result.best, null);
    assert.ok(pair(result).reasons.length > 0);
  });
}

test('a missing or nonfinite evaluation time prevents quote validation', () => {
  for (const value of [undefined, NaN, Infinity, null, '780', -1]) {
    const input = fresh();
    input.now_min = value;
    assert.equal(evaluatePairs(input).best, null);
  }
});

test('nonfinite, null and numeric-string provider facts cannot become eligible', () => {
  for (const value of [NaN, Infinity, null, '1000']) {
    const input = fresh();
    input.storages[1].capacity_kg = value;
    assert.equal(evaluatePairs(input).best, null);
  }
});

test('every provider must have a confirmed result', () => {
  for (const provider of ['storage', 'carrier']) {
    const input = fresh();
    (provider === 'storage' ? input.storages[1] : input.carriers[0]).status = 'unknown';
    const result = evaluatePairs(input);
    assert.equal(result.best, null);
    assert.match(pair(result).reasons.join(' '), /confirm/i);
  }
});

test('quotes are current only before their expiry, and need not last until arrival', () => {
  for (const provider of ['storage', 'carrier']) {
    const input = fresh();
    const target = provider === 'storage' ? input.storages[1] : input.carriers[0];
    target.valid_until_min = input.now_min;
    assert.equal(evaluatePairs(input).best, null);
    target.valid_until_min = input.now_min - 1;
    assert.equal(evaluatePairs(input).best, null);
    target.valid_until_min = input.now_min + 1;
    assert.equal(evaluatePairs(input).best.id, 'riverside--swift');
  }
});

test('an optional future quote start is distinguished from an expired quote', () => {
  const input = fresh();
  input.storages[1].valid_from_min = 781;
  const result = evaluatePairs(input);
  assert.equal(result.best, null);
  assert.match(pair(result).reasons.join(' '), /not yet|future|starts/i);
  input.storages[1].valid_from_min = 780;
  assert.equal(evaluatePairs(input).best.id, 'riverside--swift');
  input.storages[1].valid_from_min = NaN;
  assert.equal(evaluatePairs(input).best, null);
});

test('pickup cannot be in the past, while a pickup now is allowed', () => {
  const input = fresh();
  input.carriers[0].pickup_min = 779;
  assert.equal(evaluatePairs(input).best, null);
  input.carriers[0].pickup_min = 780;
  assert.ok(evaluatePairs(input).best);
});

test('the full lot must fit both providers, including exact capacity equality', () => {
  assert.equal(evaluatePairs(fixture, { quantity_kg: 1000 }).best.id, 'riverside--swift');
  assert.equal(evaluatePairs(fixture, { quantity_kg: 1001 }).best, null);
  const input = fresh();
  input.storages[1].capacity_kg = 899;
  assert.equal(evaluatePairs(input).best, null);
});

test('each entire provider temperature band must be inside the requested band', () => {
  for (const provider of ['storage', 'carrier']) {
    for (const [min, max] of [[-1, 3], [1, 5], [4, 1], [NaN, 3]]) {
      const input = fresh();
      const target = provider === 'storage' ? input.storages[1] : input.carriers[0];
      target.min_temp_c = min;
      target.max_temp_c = max;
      assert.equal(evaluatePairs(input).best, null);
    }
  }
  const input = fresh();
  input.lot.min_temp_c = 5;
  input.lot.max_temp_c = 4;
  assert.equal(evaluatePairs(input).best, null);
});

test('missing, negative or nonfinite route duration is rejected instead of using zero', () => {
  for (const value of [undefined, null, -1, NaN, Infinity, '50']) {
    const input = fresh();
    input.carriers[0].travel_min.riverside = value;
    const result = evaluatePairs(input);
    assert.equal(result.best, null);
    assert.equal(pair(result).arrival_min, null);
    assert.match(pair(result).reasons.join(' '), /travel|route/i);
  }
});

test('early arrival waits for receiving to open and waiting consumes deadline slack', () => {
  const result = evaluatePairs(fixture, { quantity_kg: 650 });
  const waiting = pair(result, 'riverside', 'local');
  assert.equal(waiting.arrival_min, 825);
  assert.equal(waiting.handoff_min, 840);
  assert.equal(waiting.slack_min, 60);
  const tightened = evaluatePairs(fixture, { quantity_kg: 650, latest_arrival_min: 830 });
  assert.equal(pair(tightened, 'riverside', 'local').feasible, false);
  assert.match(pair(tightened, 'riverside', 'local').reasons.join(' '), /deadline/i);
});

test('zero travel is a valid known value and still observes opening time', () => {
  const input = fresh();
  input.carriers[0].travel_min.riverside = 0;
  const result = evaluatePairs(input);
  assert.equal(result.best.arrival_min, 815);
  assert.equal(result.best.handoff_min, 840);
});

test('receiving cutoff and lot deadline include exact-boundary handoffs', () => {
  const input = fresh();
  input.storages[0].receive_until_min = 865;
  assert.equal(evaluatePairs(input).best.id, 'orchard--swift');
  input.storages[0].receive_until_min = 864;
  assert.equal(pair(evaluatePairs(input), 'orchard').feasible, false);
  assert.equal(evaluatePairs(fixture, { latest_arrival_min: 865 }).best.slack_min, 0);
  assert.equal(evaluatePairs(fixture, { latest_arrival_min: 864 }).best, null);
});

test('a reversed receiving window cannot be used even if arrival precedes its close', () => {
  const input = fresh();
  input.storages[1].receive_from_min = 961;
  assert.equal(evaluatePairs(input).best, null);
});

test('money uses cents so 10 cents plus 20 cents fits a 30 cent budget', () => {
  const input = fresh();
  input.storages[1].cost_usd = 0.1;
  input.carriers[0].cost_usd = 0.2;
  const result = evaluatePairs(input, { budget_usd: 0.3 });
  assert.equal(result.best.cost_usd, 0.3);
});

test('negative, sub-cent or unrepresentable money is rejected', () => {
  for (const value of [-1, 0.001, Number.MAX_VALUE]) {
    const input = fresh();
    input.storages[1].cost_usd = value;
    assert.equal(evaluatePairs(input).best, null);
  }
});

test('zero-priced quotes and a zero budget can be feasible', () => {
  const input = fresh();
  input.storages[1].cost_usd = 0;
  input.carriers[0].cost_usd = 0;
  assert.equal(evaluatePairs(input, { budget_usd: 0 }).best.cost_usd, 0);
});

test('computed arrival overflow is unknown rather than an apparent handoff', () => {
  const input = fresh();
  input.carriers[0].pickup_min = Number.MAX_VALUE;
  input.carriers[0].travel_min.riverside = Number.MAX_VALUE;
  const result = evaluatePairs(input);
  assert.equal(result.best, null);
  assert.equal(pair(result).arrival_min, null);
});

test('equal costs choose earlier handoff and then stable ID independent of array order', () => {
  const input = fresh();
  input.carriers = [input.carriers[1]];
  input.lot.quantity_kg = 650;
  input.storages = [input.storages[1], input.storages[0]];
  for (const storage of input.storages) {
    storage.cost_usd = 90;
    storage.receive_from_min = 780;
  }
  input.carriers[0].travel_min.riverside = 30;
  assert.equal(evaluatePairs(input).best.id, 'riverside--local');
  input.carriers[0].travel_min.riverside = 35;
  assert.equal(evaluatePairs(input).best.id, 'orchard--local');
  input.storages.reverse();
  assert.equal(evaluatePairs(input).best.id, 'orchard--local');
});

test('unknown pair metrics use null and every rejection has readable reasons', () => {
  const input = fresh();
  delete input.storages[1].cost_usd;
  delete input.carriers[0].pickup_min;
  const result = evaluatePairs(input);
  const target = pair(result);
  for (const key of ['cost_usd', 'arrival_min', 'handoff_min', 'slack_min']) assert.equal(target[key], null);
  for (const candidate of result.pairs) {
    if (!candidate.feasible) assert.ok(candidate.reasons.every((reason) => typeof reason === 'string' && reason.length > 5));
  }
});

test('formatTime renders valid minutes and preserves unknowns', () => {
  assert.equal(formatTime(865), '14:25');
  assert.equal(formatTime(0), '00:00');
  for (const value of [undefined, null, NaN, Infinity, '865', -1]) assert.equal(formatTime(value), '—');
});
