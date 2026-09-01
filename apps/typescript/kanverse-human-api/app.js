const goalInput = document.querySelector('#goal');
const phonesInput = document.querySelector('#phones');
const previewBtn = document.querySelector('#previewBtn');
const goalPreview = document.querySelector('#goalPreview');
const targetCount = document.querySelector('#targetCount');
const decisionText = document.querySelector('#decisionText');
const statusBadge = document.querySelector('#statusBadge');
const planCard = document.querySelector('#planCard');
const planGoal = document.querySelector('#planGoal');
const planTarget = document.querySelector('#planTarget');
const planSummary = document.querySelector('#planSummary');
const confirmCallBtn = document.querySelector('#confirmCallBtn');
const cancelPlanBtn = document.querySelector('#cancelPlanBtn');
const historyList = document.querySelector('#historyList');
const historyCount = document.querySelector('#historyCount');
const timelineItems = [...document.querySelectorAll('.timeline-item')];
const modeToggle = document.querySelector('#modeToggle');
const modeTitle = document.querySelector('#modeTitle');
const modeDescription = document.querySelector('#modeDescription');
const modeSwitchText = document.querySelector('#modeSwitchText');
const safetyText = document.querySelector('#safetyText');

let dryRun = true;
let activePlan = null;
let pollTimer = null;
let mission = null;
let history = [];

function updateModeUI() {
  dryRun = !modeToggle.checked;
  modeTitle.textContent = dryRun ? 'Dry Run' : 'LIVE MODE';
  modeSwitchText.textContent = dryRun ? 'DRY RUN' : 'LIVE';
  modeDescription.textContent = dryRun
    ? 'Safe simulation. No CALL-E call credits are used.'
    : 'Real CALL-E calls are enabled. Each call still requires confirmation.';
  safetyText.textContent = dryRun
    ? 'Dry-run mode is enabled. Simulated calls use no CALL-E call credits. Switch to Live only when you intentionally want to place real calls.'
    : 'LIVE MODE is enabled. Planning remains non-destructive, but pressing Confirm & Call will place a real CALL-E phone call and may consume a call credit.';
  document.body.classList.toggle('live-mode', !dryRun);
}

modeToggle.addEventListener('change', () => {
  if (mission || activePlan) {
    activePlan = null;
    mission = null;
    planCard.classList.add('hidden');
    resetHistory();
    statusBadge.textContent = 'MODE CHANGED';
    statusBadge.className = 'badge idle';
    setDecision('Execution mode changed. Preview the mission again before continuing.');
    setStage(0);
  }
  updateModeUI();
});

function setStage(stage) {
  const max = timelineItems.length - 1;
  const current = Math.max(0, Math.min(stage, max));
  timelineItems.forEach((item, index) => {
    item.classList.toggle('active', index < current || (current === max && index === max));
    item.classList.toggle('current', index === current && current < max);
  });
}

function completeTimeline() {
  timelineItems.forEach(item => {
    item.classList.add('active');
    item.classList.remove('current');
  });
}

function getTargets() {
  return phonesInput.value.split('\n').map(value => value.trim()).filter(Boolean);
}

function parseCalle(raw) {
  const outer = JSON.parse(raw);
  return outer?.result?.structuredContent || outer?.result || outer;
}

function maskPhone(phone) {
  const clean = String(phone);
  return clean.length > 4 ? `...${clean.slice(-4)}` : clean;
}

function findRunId(result) {
  return result?.run_id || result?.runId || result?.id || result?.call_run_id || null;
}

function isTerminal(status) {
  return ['COMPLETED', 'FAILED', 'CANCELLED', 'CANCELED'].includes(String(status || '').toUpperCase());
}

function classifyMissionOutcome(result, summary) {
  const completed =
    result?.outcome?.task_completed ??
    result?.result?.outcome?.task_completed;

  const status = String(result?.status || result?.state || '').toUpperCase();
  const text = String(summary || '').toLowerCase();

  const clearNoMatch = [
    'did not reach a live',
    'no live representative',
    'no live person',
    'could not reach',
    'could not be reached',
    'no answer',
    'line is no longer in use',
    'number is no longer in use',
    'number is not in service',
    'invalid number',
    'disconnected',
    'goal not achieved',
    'goal not satisfied',
    'could not confirm'
  ].some(marker => text.includes(marker));

  if (['FAILED', 'CANCELLED', 'CANCELED'].includes(status) || clearNoMatch) {
    return 'failed';
  }

  if (completed === true) return 'success';
  if (completed === false) return 'failed';

  return 'review';
}

function setDecision(text) {
  decisionText.textContent = text;
}

function resetHistory() {
  history = [];
  renderHistory();
}

function recordHistory(index, phone, result, detail) {
  const existing = history.find(item => item.index === index);
  const entry = { index, phone, result, detail };
  if (existing) Object.assign(existing, entry);
  else history.push(entry);
  history.sort((a, b) => a.index - b.index);
  renderHistory();
}

function renderHistory() {
  historyCount.textContent = `${history.length} result${history.length === 1 ? '' : 's'}`;
  if (!history.length) {
    historyList.innerHTML = '<div class="history-empty">No targets evaluated yet.</div>';
    return;
  }
  historyList.innerHTML = history.map(item => {
    const safeResult = item.result === 'success' ? 'success' : item.result === 'failed' ? 'failed' : 'running';
    const label = item.result === 'review'
      ? 'REVIEW NEEDED'
      : safeResult === 'success'
        ? 'SUCCESS'
        : safeResult === 'failed'
          ? 'NOT A MATCH'
          : 'IN PROGRESS';
    return `<div class="history-item"><div class="history-index">${item.index + 1}</div><div class="history-main"><strong>Target ${item.index + 1} · ${maskPhone(item.phone)}</strong><span>${item.detail}</span></div><span class="result-pill ${safeResult}">${label}</span></div>`;
  }).join('');
}

async function prepareTarget(index) {
  setStage(1);
  if (!mission || index >= mission.targets.length) {
    statusBadge.textContent = 'NO MATCH';
    statusBadge.className = 'badge idle';
    setDecision('Mission finished: all targets were tried and the goal was not achieved.');
    activePlan = null;
    planCard.classList.add('hidden');
    completeTimeline();
    return;
  }
  mission.index = index;
  const phone = mission.targets[index];
  statusBadge.textContent = dryRun ? `PLANNING ${index + 1}/${mission.targets.length} · DRY RUN` : `PLANNING ${index + 1}/${mission.targets.length} · LIVE`;
  statusBadge.className = 'badge ready';
  setDecision(`Preparing target ${index + 1} of ${mission.targets.length}: ${maskPhone(phone)}…`);
  const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: mission.goal, phone, language: 'English', region: 'GB' }) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || 'CALL-E planning failed');
  const plan = parseCalle(data.raw);
  if (!plan?.plan_id) throw new Error('CALL-E returned no structured plan.');
  activePlan = { ...plan, phone, targetIndex: index };
  if (!plan.ready_to_run) {
    statusBadge.textContent = 'NEEDS INFO';
    setDecision(plan.clarifying_questions?.join(' ') || 'CALL-E needs more information.');
    return;
  }
  statusBadge.textContent = dryRun ? `PLAN READY ${index + 1}/${mission.targets.length} · DRY RUN` : `PLAN READY ${index + 1}/${mission.targets.length} · LIVE`;
  planGoal.textContent = plan.display_goal || mission.goal;
  planTarget.textContent = `Target ${index + 1}/${mission.targets.length}: ${maskPhone(phone)}`;
  planSummary.textContent = plan.confirm_summary || 'Ready for explicit confirmation.';
  confirmCallBtn.textContent = dryRun ? 'Simulate Call' : 'Confirm & Call';
  planCard.classList.remove('hidden');
  setDecision(dryRun ? 'Review this target. Dry-run mode is ON, so no real call will be placed.' : 'LIVE MODE: review carefully. Confirm & Call will place a real phone call.');
}

function simulateCall() {
  const currentIndex = activePlan.targetIndex;
  const currentPhone = activePlan.phone;
  setStage(2);
  confirmCallBtn.disabled = true;
  cancelPlanBtn.disabled = true;
  planCard.classList.add('hidden');
  recordHistory(currentIndex, currentPhone, 'running', 'Simulated CALL-E call is being evaluated.');
  statusBadge.textContent = `SIMULATING ${currentIndex + 1}/${mission.targets.length}`;
  statusBadge.className = 'badge ready';
  setDecision(`Dry run: simulating CALL-E call to ${maskPhone(currentPhone)}. No credit is being used.`);
  setTimeout(() => { statusBadge.textContent = 'CALL STARTED'; setDecision(`Dry run: simulated call to ${maskPhone(currentPhone)} started.`); }, 900);
  setTimeout(async () => {
    setStage(3);
    const success = currentIndex === mission.targets.length - 1;
    if (success) {
      recordHistory(currentIndex, currentPhone, 'success', 'Mission goal satisfied. CallChain stopped here.');
      statusBadge.textContent = 'GOAL ACHIEVED';
      setDecision(`Dry run: target ${currentIndex + 1} satisfied the mission goal. Human API stopped automatically. No CALL-E call credits were used.`);
      completeTimeline();
      confirmCallBtn.disabled = false;
      cancelPlanBtn.disabled = false;
      return;
    }
    recordHistory(currentIndex, currentPhone, 'failed', 'Goal not satisfied. CallChain continued to the next target.');
    setStage(4);
    statusBadge.textContent = 'CONTINUING';
    setDecision(`Dry run: target ${currentIndex + 1} did not satisfy the goal. Human API is moving to target ${currentIndex + 2}.`);
    try { await prepareTarget(currentIndex + 1); }
    catch (error) { statusBadge.textContent = 'ERROR'; statusBadge.className = 'badge idle'; setDecision(error.message); }
    finally { confirmCallBtn.disabled = false; cancelPlanBtn.disabled = false; }
  }, 2800);
}

async function pollStatus(runId) {
  try {
    setStage(3);
    const response = await fetch(`/api/status/${encodeURIComponent(runId)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Status check failed');
    const result = parseCalle(data.raw);
    const status = result?.status || result?.state || 'RUNNING';
    statusBadge.textContent = String(status).toUpperCase();
    statusBadge.className = 'badge ready';
    const summary = result?.result?.summary || result?.summary || result?.outcome?.summary || result?.post_summary;
    const completed = result?.outcome?.task_completed ?? result?.result?.outcome?.task_completed;
    setDecision(summary || `CALL-E status: ${status}`);
    if (isTerminal(status)) {
      clearTimeout(pollTimer);
      confirmCallBtn.disabled = false;
      cancelPlanBtn.disabled = false;
      const missionOutcome = classifyMissionOutcome(result, summary);

      const detail = summary || (
        missionOutcome === 'success'
          ? 'Mission goal satisfied.'
          : missionOutcome === 'failed'
            ? 'Goal not satisfied.'
            : 'Outcome requires human review.'
      );

      recordHistory(
        activePlan.targetIndex,
        activePlan.phone,
        missionOutcome,
        detail
      );

      setStage(4);

      if (missionOutcome === 'failed') {
        if (mission && activePlan?.targetIndex + 1 < mission.targets.length) {
          statusBadge.textContent = 'CONTINUING';
          setDecision('Goal not achieved. Preparing the next target…');
          await prepareTarget(activePlan.targetIndex + 1);
        } else {
          statusBadge.textContent = 'NO MATCH';
          statusBadge.className = 'badge idle';
          setDecision(summary || 'Mission finished: the goal was not achieved.');
          completeTimeline();
        }
      } else if (missionOutcome === 'success') {
        statusBadge.textContent = 'GOAL ACHIEVED';
        statusBadge.className = 'badge ready';
        setDecision(summary || 'Mission goal satisfied.');
        completeTimeline();
      } else {
        statusBadge.textContent = 'REVIEW NEEDED';
        statusBadge.className = 'badge idle';
        setDecision(
          (summary || 'CALL-E returned an unclear outcome.') +
          ' Human review is required before Human API continues.'
        );
      }

      return;
    }
    pollTimer = setTimeout(() => pollStatus(runId), 7000);
  } catch (error) {
    statusBadge.textContent = 'STATUS ERROR'; statusBadge.className = 'badge idle'; setDecision(error.message); confirmCallBtn.disabled = false; cancelPlanBtn.disabled = false;
  }
}

previewBtn.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  const targets = getTargets();
  activePlan = null; mission = null; planCard.classList.add('hidden'); resetHistory(); setStage(0);
  if (!goal || targets.length === 0) { statusBadge.textContent = 'INCOMPLETE'; statusBadge.className = 'badge idle'; setDecision('Add a goal and at least one phone number.'); return; }
  mission = { goal, targets, index: 0 };
  goalPreview.textContent = goal;
  targetCount.textContent = `${targets.length} phone number${targets.length === 1 ? '' : 's'}`;
  previewBtn.disabled = true;
  try { await prepareTarget(0); }
  catch (error) { statusBadge.textContent = 'ERROR'; statusBadge.className = 'badge idle'; setDecision(error.message); }
  finally { previewBtn.disabled = false; }
});

confirmCallBtn.addEventListener('click', async () => {
  if (!activePlan?.plan_id || !activePlan?.confirm_token) return;
  if (dryRun) { simulateCall(); return; }
  setStage(2);
  confirmCallBtn.disabled = true; cancelPlanBtn.disabled = true;
  recordHistory(activePlan.targetIndex, activePlan.phone, 'running', 'Real CALL-E call started; awaiting structured outcome.');
  statusBadge.textContent = 'STARTING LIVE CALL'; statusBadge.className = 'badge ready';
  setDecision(`LIVE: user confirmed. Starting CALL-E call to ${maskPhone(activePlan.phone)}…`);
  try {
    const response = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: activePlan.plan_id, confirmToken: activePlan.confirm_token }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'CALL-E call failed to start');
    const result = parseCalle(data.raw);
    const runId = findRunId(result);
    if (!runId) throw new Error('CALL-E started but no run ID was returned. Do not press Confirm again; check the terminal before retrying.');
    statusBadge.textContent = 'CALL STARTED'; setDecision('Real call started. Waiting for CALL-E result…'); planCard.classList.add('hidden'); setTimeout(() => pollStatus(runId), 10000);
  } catch (error) { statusBadge.textContent = 'CALL ERROR'; statusBadge.className = 'badge idle'; setDecision(error.message); confirmCallBtn.disabled = false; cancelPlanBtn.disabled = false; }
});

cancelPlanBtn.addEventListener('click', () => {
  activePlan = null; mission = null; planCard.classList.add('hidden'); statusBadge.textContent = 'CANCELLED'; statusBadge.className = 'badge idle'; setDecision('Mission cancelled. No further calls will be placed.'); setStage(0);
});

renderHistory();
setStage(0);
updateModeUI();
