import test from 'node:test';
import assert from 'node:assert/strict';
const url = process.env.TEST_URL || 'http://localhost:3101';
async function post(body) {
  const r = await fetch(url + '/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, ...(await r.json()) };
}
test('durable practice workflow and concurrent execution protection', async () => {
  let d = await post({
    action: 'create',
    name: 'Synthetic acceptance test',
    purpose: 'Ask about tomorrow 3–4 pm; do not book.',
    mode: 'practice',
  });
  assert.equal(d.status, 200);
  const id = d.id;
  assert.equal((await post({ action: 'run', id })).status, 400);
  assert.equal((await post({ action: 'approve', id })).status, 200);
  const outcomes = await Promise.all([
    post({ action: 'run', id }),
    post({ action: 'run', id }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 200).length, 1);
  d = await post({ action: 'refresh' });
  const job = d.jobs.find((j) => j.id === id);
  assert.equal(job.state, 'needs_review');
  assert.equal(
    job.audit.filter((a) => a.action === 'execution_reserved').length,
    1,
  );
  assert.match(job.runId, /^synthetic-/);
  d = await post({ action: 'confirm', id });
  assert.equal(d.jobs.find((j) => j.id === id).state, 'window_accepted');
  assert.equal((await post({ action: 'poll', id })).status, 400);
  const persisted = await (await fetch(url + '/api/jobs')).json();
  assert.equal(
    persisted.jobs.find((j) => j.id === id).state,
    'window_accepted',
  );
});
test('live creation requires authorization', async () =>
  assert.equal(
    (
      await post({
        action: 'create',
        name: 'Test',
        purpose: 'Test',
        phone: '+15555550100',
        mode: 'live',
      })
    ).status,
    403,
  ));
test('cross-origin mutation rejected', async () => {
  const r = await fetch(url + '/api/jobs', {
    method: 'POST',
    headers: { Origin: 'https://example.com' },
    body: '{}',
  });
  assert.equal(r.status, 403);
});

