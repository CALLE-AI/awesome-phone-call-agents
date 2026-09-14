const text = (id, value) => { document.getElementById(id).textContent = value; };
async function request(path, method = 'GET') {
  const response = await fetch(path, { method });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}
async function refresh() { text('state', JSON.stringify(await request('/api/state'), null, 2)); }
async function start() {
  const view = await request('/api/preview');
  text('name', `${view.playbook.name} · version ${view.playbook.version}`);
  text('objective', view.playbook.objective);
  text('schedule', `Fictional context: ${view.natural_time} (${view.timezone}). No scheduler runs.`);
  for (const [key, allowed] of Object.entries(view.playbook.authority)) {
    const item = document.createElement('li');
    item.textContent = `${key.replaceAll('_', ' ')}: ${allowed ? 'ALLOWED' : 'NOT ALLOWED'}`;
    document.getElementById('authority').append(item);
  }
  text('guardrails', view.playbook.guardrails.join(' '));
  text('stops', view.playbook.stop_conditions.join(' '));
  text('task', view.task); text('schema', JSON.stringify(view.result_schema, null, 2));
  await refresh();
}
for (const button of document.querySelectorAll('[data-outcome]')) button.addEventListener('click', async () => {
  button.disabled = true;
  try { await request(`/api/simulate/${button.dataset.outcome}`, 'POST'); await refresh(); text('message', 'Synthetic result persisted. No call was made.'); }
  catch (error) { text('message', error.message); }
  finally { button.disabled = false; }
});
start().catch(error => text('message', error.message));
