import { evaluatePairs, formatTime } from './engine.js';

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const money = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value).replace(/\.00$/, '') : '—';
const pause = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = { scenario: null, providers: [], selected: 'orchard', revealed: new Set(), running: false, finished: false, transcriptCount: 3, result: null, overrides: {}, runToken: 0, reviewedAt: null, completedAt: null, request: null, toastTimer: null };

function deepFreeze(value) {
  Object.values(value).forEach((entry) => {
    if (entry && typeof entry === 'object') deepFreeze(entry);
  });
  return Object.freeze(value);
}

function readOverrides() {
  const time = byId('deadline').value;
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return {
    quantity_kg: Number(document.querySelector('input[name="quantity"]:checked').value),
    latest_arrival_min: match ? Number(match[1]) * 60 + Number(match[2]) : null,
    unavailable_storage_ids: byId('riverside-offline').checked ? ['riverside'] : [],
  };
}

function announce(message) {
  byId('live-status').textContent = message;
}

function toast(message) {
  window.clearTimeout(state.toastTimer);
  byId('toast').textContent = message;
  byId('toast').hidden = false;
  state.toastTimer = window.setTimeout(() => { byId('toast').hidden = true; }, 4500);
}

function scrollToSection(id) {
  byId(id).scrollIntoView({ behavior: reduceMotion.matches ? 'instant' : 'smooth', block: 'start' });
}

function updateControls() {
  const invalidTime = state.overrides.latest_arrival_min === null;
  byId('control-error').hidden = !invalidTime;
  byId('control-error').textContent = invalidTime ? 'Enter a latest arrival time to evaluate the handoff.' : '';
  byId('run-button').disabled = state.running || invalidTime;
  byId('start-secondary').disabled = state.running || invalidTime;
  byId('run-label').textContent = state.running ? 'Replaying conversations' : state.finished ? 'Replay rehearsal' : 'Run rehearsal';
  byId('skip-button').hidden = !state.running;
  byId('review-link').hidden = !state.finished || state.running;
  document.querySelectorAll('input[name="quantity"], #deadline, #riverside-offline, #reset-button').forEach((control) => { control.disabled = state.running; });
  document.body.classList.toggle('is-running', state.running);
  byId('plan-placeholder').hidden = state.finished;
  byId('plan-content').hidden = !state.finished;
  byId('rehearsal-note').textContent = state.running ? 'Playing text fixtures. No telephone connection.' : 'Synthetic rehearsal. No calls. No bookings.';
}

function updateHero() {
  const { lot, feasible } = state.result;
  byId('headline-quantity').textContent = lot.quantity_kg;
  byId('map-quantity').textContent = `${lot.quantity_kg} kg`;
  byId('hero-deadline').textContent = formatTime(lot.latest_arrival_min);
  byId('headline-outcome').innerHTML = feasible.length === 0 ? 'No working<br><em>handoff.</em>' : feasible.length === 1 ? 'One working<br><em>handoff.</em>' : 'More ways<br><em>forward.</em>';
}

function renderCallList() {
  byId('call-list').innerHTML = state.providers.map((provider, index) => {
    const selected = state.selected === provider.id;
    const played = state.revealed.has(provider.id);
    const current = state.running && selected;
    const description = played || state.finished ? provider.discovery : provider.kind === 'storage' ? 'Capacity · cooling · receiving' : 'Load limit · pickup · route time';
    return `<button class="call-item${played ? ' is-played' : ''}${current ? ' is-playing' : ''}" type="button" data-call="${escapeHtml(provider.id)}" aria-pressed="${selected}"${state.running ? ' disabled' : ''}><span class="call-number">${String(index + 1).padStart(2, '0')}</span><span><span class="call-item-name">${escapeHtml(provider.name)}</span><span class="call-item-description">${escapeHtml(description)}</span></span><span class="call-item-indicator" aria-hidden="true">${played ? '✓' : '↗'}</span></button>`;
  }).join('');
  byId('call-progress-label').textContent = state.running ? `${state.revealed.size} / 5 REPLAYED` : state.finished ? 'ALL 5 REPLAYED' : 'SCRIPT PREVIEW';
}

function renderTranscript() {
  const provider = state.providers.find((entry) => entry.id === state.selected);
  if (!provider) return;
  const index = state.providers.indexOf(provider) + 1;
  byId('transcript-category').textContent = `${provider.kind === 'storage' ? 'COLD STORAGE' : 'REFRIGERATED TRANSPORT'} / CALL ${String(index).padStart(2, '0')}`;
  byId('transcript-title').textContent = provider.name;
  byId('evidence-id').textContent = provider.call_id;
  const messages = provider.transcript.slice(0, state.transcriptCount).map((message) => {
    let messageText = escapeHtml(message.text);
    if (provider.id === 'orchard' && message.speaker === 'Provider') {
      messageText = messageText.replace('Our receiving team leaves at two, not five.', '<mark>Our receiving team leaves at two, not five.</mark>');
    }
    return `<div class="transcript-message${message.speaker === 'Provider' ? ' provider' : ''}"><span class="transcript-speaker">${message.speaker === 'Provider' ? 'PROVIDER' : 'CALL-E'}</span><p>${messageText}</p></div>`;
  });
  if (state.running && state.transcriptCount < provider.transcript.length) messages.push('<p class="transcript-waiting">Replaying scripted response…</p>');
  byId('transcript-messages').innerHTML = messages.join('');
  byId('evidence-finding').hidden = state.transcriptCount < 2;
  byId('finding-text').textContent = provider.discovery;
}

function providerVerdict(provider) {
  const revealed = state.finished || state.revealed.has(provider.id);
  if (!revealed) return provider.id === 'orchard' ? 'Directory says 17:00' : 'Awaiting rehearsal';
  if (state.finished && provider.id === 'riverside' && state.overrides.unavailable_storage_ids.includes('riverside')) return 'Unavailable in this brief';
  const best = state.finished ? state.result.best : null;
  if (best && provider.id === best.carrier_id) return `Chosen · ${formatTime(provider.pickup_min)} pickup`;
  if (best && provider.id === best.storage_id) return `Chosen · ${formatTime(best.handoff_min)} handoff`;
  const descriptions = {
    orchard: 'Actual cutoff: 14:00',
    riverside: 'Receiving: 14:00–16:00',
    hillcrest: 'Above requested 0–4°C',
    swift: 'Full load · 13:35 pickup',
    local: '700 kg maximum load',
  };
  return descriptions[provider.id];
}

function updateNetwork() {
  const best = state.finished ? state.result.best : null;
  byId('network-progress').textContent = `${state.finished ? state.providers.length : state.revealed.size} / ${state.providers.length} replayed`;
  document.querySelectorAll('.route-line').forEach((line) => {
    line.classList.remove('route-active', 'route-muted');
    if (state.finished) line.classList.add('route-muted');
  });
  if (best) {
    [`path-${best.carrier_id}-${best.storage_id}`, `path-origin-${best.carrier_id}`].forEach((id) => {
      const line = byId(id);
      if (line) { line.classList.remove('route-muted'); line.classList.add('route-active'); }
    });
  }
  state.providers.forEach((provider) => {
    const node = byId(`node-${provider.id}`);
    const isBest = best && (provider.id === best.storage_id || provider.id === best.carrier_id);
    const inFeasiblePair = state.result.feasible.some((pair) => pair.storage_id === provider.id || pair.carrier_id === provider.id);
    node.classList.toggle('is-best', Boolean(isBest));
    node.classList.toggle('is-active', !state.finished && state.revealed.has(provider.id));
    node.classList.toggle('is-rejected', state.finished && !inFeasiblePair);
    node.classList.toggle('is-calling', state.running && state.selected === provider.id);
    node.disabled = state.running;
    byId(`verdict-${provider.id}`).textContent = providerVerdict(provider);
  });
  if (!state.finished) {
    byId('route-caption').textContent = state.running ? 'Reading the facts. Connecting the constraints.' : 'Five confirmations. Six possible pairings.';
    byId('board-insight').textContent = state.revealed.has('orchard') ? 'The directory said 17:00. The dock closes at 14:00.' : 'A room with space is only half the answer.';
  } else if (best) {
    byId('route-caption').textContent = `${state.result.feasible.length} compatible ${state.result.feasible.length === 1 ? 'pair' : 'pairs'} · best plan highlighted`;
    byId('board-insight').textContent = `${money(best.cost_usd)}. ${formatTime(best.handoff_min)} handoff. ${best.slack_min} minutes to spare.`;
  } else {
    byId('route-caption').textContent = 'No compatible pair. Nothing is silently booked.';
    byId('board-insight').textContent = 'One changed constraint. A different decision.';
  }
}

function resetReview() {
  state.reviewedAt = null;
  byId('operator-confirm').checked = false;
  byId('download-button').disabled = true;
}

function renderRecommendation() {
  const { best, lot, feasible } = state.result;
  const panel = byId('recommendation');
  panel.classList.toggle('no-plan', !best);
  if (!best) {
    panel.innerHTML = '<div class="recommendation-kicker"><span aria-hidden="true">×</span> NO COMPATIBLE HANDOFF</div><h3 id="recommendation-title">The brief changed.<br><span>The answer did, too.</span></h3><p class="recommendation-explanation">None of the six pairings meets every constraint. Review the reasons, revise the brief, or collect new provider confirmations. No requirement has been relaxed.</p><button class="recovery-button" type="button" id="restore-brief">Restore the original brief <span aria-hidden="true">↗</span></button>';
    return;
  }
  const storage = state.scenario.storages.find((entry) => entry.id === best.storage_id);
  const carrier = state.scenario.carriers.find((entry) => entry.id === best.carrier_id);
  panel.innerHTML = `<div class="recommendation-kicker"><span class="status-dot"></span> ${feasible.length === 1 ? 'THE ONE COMPATIBLE PAIR' : `BEST OF ${feasible.length} COMPATIBLE PAIRS`}</div><h3 id="recommendation-title">The whole lot.<br><span>In one handoff.</span></h3><div class="recommendation-route"><strong>${escapeHtml(carrier.name)}</strong><span aria-label="to">→</span><strong>${escapeHtml(storage.name)}</strong></div><dl class="recommendation-metrics"><div><dt>Transport + 24h storage</dt><dd>${money(best.cost_usd)}</dd></div><div><dt>Before the deadline</dt><dd>${best.slack_min}<span>min</span></dd></div></dl><p class="recommendation-explanation"><strong>${lot.quantity_kg} kg · ${formatTime(best.handoff_min)} receiving handoff.</strong><br>${money(carrier.cost_usd)} transport + ${money(storage.cost_usd)} storage, within the ${money(lot.budget_usd)} budget. Both services meet the requested ${lot.min_temp_c}–${lot.max_temp_c}°C range.</p><div class="recommendation-tag"><span aria-hidden="true">✓</span> FIXTURE FACTS MATCH · OPERATOR REVIEW REQUIRED</div>`;
}

function renderPairs() {
  const { best, pairs, feasible } = state.result;
  const ordered = best ? [best, ...pairs.filter((pair) => pair.id !== best.id)] : pairs;
  byId('pair-count').textContent = `${pairs.length} CHECKED / ${feasible.length} COMPATIBLE`;
  byId('pair-list').innerHTML = ordered.map((pair) => {
    const carrier = state.scenario.carriers.find((entry) => entry.id === pair.carrier_id);
    const storage = state.scenario.storages.find((entry) => entry.id === pair.storage_id);
    const chosen = pair.id === best?.id;
    const explanation = pair.feasible ? `All constraints pass. ${formatTime(pair.handoff_min)} handoff, ${pair.slack_min} minutes before the deadline.${pair.arrival_min < pair.handoff_min ? ` Arrival at ${formatTime(pair.arrival_min)}; wait until receiving opens.` : ''}` : pair.reasons.join(' ');
    return `<div class="pair-row${pair.feasible ? ' is-feasible' : ''}" role="listitem"><span class="pair-icon" aria-label="${pair.feasible ? 'Compatible' : 'Rejected'}">${pair.feasible ? '✓' : '×'}</span><div class="pair-route">${escapeHtml(carrier.short)} <span aria-label="to">→</span> ${escapeHtml(storage.short)}${chosen ? '<b class="best-label">SELECTED</b>' : ''}</div><div class="pair-details"><span class="pair-arrival" aria-label="Handoff time ${formatTime(pair.handoff_min)}">${formatTime(pair.handoff_min)}</span><span>${money(pair.cost_usd)}</span></div><p class="pair-reasons">${escapeHtml(explanation)}</p></div>`;
  }).join('');
}

function renderTimeline() {
  const { best, lot } = state.result;
  byId('handoff-timeline').hidden = !best;
  byId('export-panel').hidden = !best;
  if (!best) return;
  const carrier = state.scenario.carriers.find((entry) => entry.id === best.carrier_id);
  const points = [
    { time: state.scenario.now_min, label: 'Harvest ready' },
    { time: carrier.pickup_min, label: 'Refrigerated pickup' },
    { time: best.handoff_min, label: 'Receiving handoff', important: true },
    { time: lot.latest_arrival_min, label: 'Latest arrival' },
  ];
  byId('handoff-timeline').innerHTML = `<div class="timeline-label">THE HANDOFF WINDOW<small>Scenario local time · same day</small></div><div class="timeline-track">${points.map((point) => `<div class="timeline-point${point.important ? ' important' : ''}"><time>${formatTime(point.time)}</time><span>${point.label}</span></div>`).join('')}</div>`;
}

function renderResult() {
  if (!state.finished) return;
  renderRecommendation();
  renderPairs();
  renderTimeline();
}

function recompute({ notify = false } = {}) {
  state.overrides = readOverrides();
  state.result = evaluatePairs(state.scenario, state.overrides);
  resetReview();
  updateHero();
  updateControls();
  updateNetwork();
  renderResult();
  renderRequest();
  if (notify) {
    const best = state.result.best;
    announce(best ? `Brief updated: ${state.result.feasible.length} compatible pairings. ${best.carrier_name} to ${best.storage_name}, ${money(best.cost_usd)}, handoff at ${formatTime(best.handoff_min)}.` : 'Brief updated: no compatible handoff. Inspect each rejected pairing for the reason.');
  }
}

function selectEvidence(id, scroll = false) {
  if (state.running) return;
  state.selected = id;
  state.transcriptCount = 3;
  renderCallList();
  renderTranscript();
  if (scroll) {
    scrollToSection('rehearsal');
    byId('transcript-title').tabIndex = -1;
    byId('transcript-title').focus({ preventScroll: true });
  } else {
    byId('call-list').querySelector(`[data-call="${id}"]`)?.focus({ preventScroll: true });
  }
}

function completeReplay({ scroll = true } = {}) {
  state.runToken += 1;
  state.running = false;
  state.finished = true;
  state.transcriptCount = 3;
  state.completedAt = new Date().toISOString();
  state.providers.forEach((provider) => state.revealed.add(provider.id));
  recompute();
  renderCallList();
  renderTranscript();
  const best = state.result.best;
  announce(best ? `Synthetic rehearsal complete. ${state.result.feasible.length} compatible pairings. Recommended ${best.carrier_name} to ${best.storage_name} for ${money(best.cost_usd)}, arriving at ${formatTime(best.handoff_min)}. No calls or bookings were made.` : 'Synthetic rehearsal complete. No compatible handoff. Review the constraints; no calls or bookings were made.');
  if (scroll) {
    scrollToSection('plan');
    byId('plan-title').tabIndex = -1;
    byId('plan-title').focus({ preventScroll: true });
  }
}

async function runRehearsal() {
  if (state.running || readOverrides().latest_arrival_min === null) return;
  const token = ++state.runToken;
  state.running = true;
  state.finished = false;
  state.revealed.clear();
  state.completedAt = null;
  state.transcriptCount = 1;
  resetReview();
  updateControls();
  scrollToSection('rehearsal');
  for (const provider of state.providers) {
    if (token !== state.runToken) return;
    state.selected = provider.id;
    state.transcriptCount = 1;
    renderCallList();
    renderTranscript();
    updateNetwork();
    announce(`Replaying simulated conversation ${state.providers.indexOf(provider) + 1} of ${state.providers.length}: ${provider.name}.`);
    await pause(600);
    if (token !== state.runToken) return;
    state.transcriptCount = 2;
    state.revealed.add(provider.id);
    renderCallList();
    renderTranscript();
    updateNetwork();
    await pause(900);
    if (token !== state.runToken) return;
    state.transcriptCount = 3;
    renderTranscript();
    await pause(550);
  }
  if (token === state.runToken) completeReplay();
}

function resetBrief() {
  if (state.running) return;
  document.querySelector('input[name="quantity"][value="900"]').checked = true;
  byId('deadline').value = '15:00';
  byId('riverside-offline').checked = false;
  recompute({ notify: true });
}

function downloadHandoff() {
  if (!state.finished || !state.result.best || !state.reviewedAt || !byId('operator-confirm').checked) return;
  const evidence = state.providers.map(({ kind, ...provider }) => ({ provider_type: kind, provenance: 'synthetic', ...provider }));
  const artifact = {
    schema: 'harvest-relay-handoff/v1',
    provenance: 'synthetic-rehearsal',
    notice: state.scenario.notice,
    calls_placed: 0,
    bookings_made: 0,
    scenario_id: state.scenario.id,
    evaluation_time_min: state.scenario.now_min,
    scenario_overrides: state.overrides,
    lot: state.result.lot,
    selected_pair: state.result.best,
    evaluated_pairs: state.result.pairs,
    source_evidence: evidence,
    rehearsal_completed_at: state.completedAt,
    operator_review: { reviewed: true, reviewed_at: state.reviewedAt, acknowledgement: 'I reviewed the source facts. This is a rehearsal plan, not a booking.' },
    exported_at: new Date().toISOString(),
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `harvest-relay-${state.result.lot.id.toLowerCase()}-${state.result.lot.quantity_kg}kg.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Handoff evidence downloaded. No booking was made.');
}

function illustrativeRequest() {
  return {
    task: `Identify yourself as Harvest Relay's automated assistant. Ask the authorized cold-storage provider whether they can receive the full ${state.result.lot.quantity_kg} kg strawberry lot, maintaining 0–4°C, by ${formatTime(state.result.lot.latest_arrival_min)}. Confirm actual receiving hours, capacity, total 24-hour price and quote expiry. Ask again if directory hours conflict. Record unknown answers as unknown. Do not reserve, book or promise payment.`,
    recipients: [{ phones: ['+12025550123'], region: 'US', locale: 'en-US' }],
    recipient_result_schema: {
      type: 'object',
      required: ['availability', 'capacity_kg', 'temperature_c', 'receiving_window', 'price_usd', 'quote_expiry', 'source_evidence'],
      properties: {
        availability: { type: 'string', enum: ['yes', 'no', 'unknown'] },
        capacity_kg: { type: 'string', description: 'Confirmed full-load capacity, or unknown.' },
        temperature_c: { type: 'string', description: 'Confirmed minimum and maximum Celsius, or unknown.' },
        receiving_window: { type: 'string', description: 'Actual receiving start and cutoff in local time, or unknown.' },
        price_usd: { type: 'string', description: 'Total quoted price for 24 hours, or unknown.' },
        quote_expiry: { type: 'string', description: 'When this quote ceases to be valid, or unknown.' },
        source_evidence: { type: 'string', description: 'Exact supporting words from the provider; do not invent missing facts.' },
      },
      additionalProperties: false,
    },
    metadata: { workflow_run_id: 'harvest-relay-preview', provider_id: 'orchard', provenance: 'preview-only' },
  };
}

function renderRequest() {
  document.querySelector('.api-description').textContent = 'Illustrative request · reserved fictional phone number · never sent by this page.';
  state.request = illustrativeRequest();
  byId('api-request').textContent = JSON.stringify(state.request, null, 2);
}

async function copyRequest() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(state.request, null, 2));
    toast('Request copied. This page never sends it to CALL-E.');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(byId('api-request'));
    selection.removeAllRanges();
    selection.addRange(range);
    toast('Request selected. Use your browser’s Copy command.');
  }
}

async function checkConnection() {
  const button = byId('check-connection');
  button.disabled = true;
  byId('api-status').textContent = 'Checking the local adapter. This does not place a call.';
  try {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      byId('api-status').textContent = 'You are using the static rehearsal. Run npm start from the source repository to inspect the local CALL-E adapter. No credentials are needed for this demo.';
      return;
    }
    const response = await fetch('./api/health', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Local adapter is unavailable.');
    await response.json();
    const preview = await fetch('./api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ provider_type: 'storage', provider_id: 'orchard', phone: '+12025550123', region: 'US', locale: 'en-US' }),
      signal: AbortSignal.timeout(5000),
    });
    if (!preview.ok) throw new Error('The adapter is running; its preview endpoint did not return a request.');
    const result = await preview.json();
    if (result.mode !== 'preview' || result.dialed !== false || !result.request) throw new Error('The preview response was not recognized.');
    state.request = result.request;
    byId('api-request').textContent = JSON.stringify(state.request, null, 2);
    document.querySelector('.api-description').textContent = 'Adapter-generated request · reserved fictional phone number · not sent to CALL-E.';
    byId('api-status').textContent = 'Local adapter verified. This request was generated by the server. No authentication test or phone call was performed; real calls require a separate, explicitly authorized CLI action.';
  } catch (error) {
    byId('api-status').textContent = `${error.message} The synthetic rehearsal still works. Start the companion Node server with npm start to inspect the adapter.`;
  } finally {
    button.disabled = false;
  }
}

function wireEvents() {
  byId('run-button').addEventListener('click', runRehearsal);
  byId('start-secondary').addEventListener('click', runRehearsal);
  byId('skip-button').addEventListener('click', () => completeReplay());
  document.querySelectorAll('input[name="quantity"], #deadline, #riverside-offline').forEach((input) => input.addEventListener('change', () => recompute({ notify: true })));
  byId('reset-button').addEventListener('click', resetBrief);
  byId('call-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-call]');
    if (button) selectEvidence(button.dataset.call);
  });
  byId('network').addEventListener('click', (event) => {
    const button = event.target.closest('[data-evidence]');
    if (button) selectEvidence(button.dataset.evidence, true);
  });
  byId('recommendation').addEventListener('click', (event) => {
    if (event.target.closest('#restore-brief')) resetBrief();
  });
  byId('operator-confirm').addEventListener('change', (event) => {
    state.reviewedAt = event.target.checked ? new Date().toISOString() : null;
    byId('download-button').disabled = !(event.target.checked && state.finished && state.result.best);
    if (event.target.checked) announce('Rehearsal source facts reviewed. The JSON handoff is now ready to download. No booking will be made.');
  });
  byId('download-button').addEventListener('click', downloadHandoff);
  byId('copy-request').addEventListener('click', copyRequest);
  byId('check-connection').addEventListener('click', checkConnection);
}

async function initialize() {
  try {
    const response = await fetch(new URL('./scenario.json', import.meta.url));
    if (!response.ok) throw new Error(`Scenario returned HTTP ${response.status}.`);
    state.scenario = deepFreeze(await response.json());
    state.providers = [
      ...state.scenario.storages.map((provider) => ({ ...provider, kind: 'storage' })),
      ...state.scenario.carriers.map((provider) => ({ ...provider, kind: 'carrier' })),
    ];
    byId('pair-list').setAttribute('role', 'list');
    byId('source-link').href = 'https://github.com/lvoliverrrr/harvest-relay';
    wireEvents();
    recompute();
    renderCallList();
    renderTranscript();
    announce('Harvest Relay loaded. Run the synthetic rehearsal to inspect five conversations and six transport-storage pairings.');
  } catch (error) {
    byId('run-label').textContent = 'Rehearsal unavailable';
    byId('rehearsal-note').textContent = `Could not load the scenario. ${error.message} Open this page through a local HTTP server or the public demo.`;
    announce('The rehearsal could not load. Open the project through npm start, or reload the public demo.');
  }
}

initialize();
