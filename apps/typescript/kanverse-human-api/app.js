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

const E164_RE = /^\+[1-9]\d{7,14}$/;

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
    ? 'Fully local simulation. No CALL-E authentication, network request, or call credit is used.'
    : 'Real CALL-E calls are enabled. The server must authorize the destination and every run still requires confirmation.';
  safetyText.textContent = dryRun
    ? 'Dry Run is local-only. Previewing and simulating a mission never contacts CALL-E.'
    : 'LIVE MODE is enabled. The server independently requires authentication, an authorized E.164 destination, explicit live intent, and a one-time approval token before a call can run.';
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
  return phonesInput.value
    .split('\n')
    .map(value => value.trim())
    .filter(Boolean);
}

function maskPhone(phone) {
  const clean = String(phone);
  return clean.length > 4 ? `...${clean.slice(-4)}` : clean;
}

function isTerminal(status) {
  return [
    'COMPLETED',
    'FAILED',
    'ERROR',
    'NO_ANSWER',
    'NO ANSWER',
    'DECLINED',
    'CANCELLED',
    'CANCELED'
  ].includes(String(status || '').toUpperCase());
}

function classifyMissionOutcome(result, summary) {
  const completed = result?.taskCompleted;
  const status = String(result?.status || '').toUpperCase();
  const text = String(summary || '').toLowerCase();

  const clearNoMatch = [
    'did not reach a live',
    'never reached a live',
    'automated phone menu',
    'keypad menu',
    'request was not completed',
    'was not completed',
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

  if (
    ['FAILED', 'ERROR', 'NO_ANSWER', 'NO ANSWER', 'DECLINED', 'CANCELLED', 'CANCELED'].includes(status) ||
    clearNoMatch
  ) {
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
  const entry = { index, phone, result, detail: String(detail || '') };
  if (existing) Object.assign(existing, entry);
  else history.push(entry);
  history.sort((a, b) => a.index - b.index);
  renderHistory();
}

function renderHistory() {
  historyCount.textContent = `${history.length} result${history.length === 1 ? '' : 's'}`;
  historyList.replaceChildren();

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No targets evaluated yet.';
    historyList.append(empty);
    return;
  }

  for (const item of history) {
    const safeResult = item.result === 'success'
      ? 'success'
      : item.result === 'failed'
        ? 'failed'
        : 'running';

    const label = item.result === 'review'
      ? 'REVIEW NEEDED'
      : safeResult === 'success'
        ? 'SUCCESS'
        : safeResult === 'failed'
          ? 'NOT A MATCH'
          : 'IN PROGRESS';

    const row = document.createElement('div');
    row.className = 'history-item';

    const index = document.createElement('div');
    index.className = 'history-index';
    index.textContent = String(item.index + 1);

    const main = document.createElement('div');
    main.className = 'history-main';

    const title = document.createElement('strong');
    title.textContent = `Target ${item.index + 1} · ${maskPhone(item.phone)}`;

    const detail = document.createElement('span');
    detail.textContent = item.detail;

    const pill = document.createElement('span');
    pill.className = `result-pill ${safeResult}`;
    pill.textContent = label;

    main.append(title, detail);
    row.append(index, main, pill);
    historyList.append(row);
  }
}

function createLocalPlan(index, phone) {
  return {
    readyToRun: true,
    approvalToken: null,
    phone,
    targetIndex: index,
    confirmSummary: 'Local Dry Run only. No CALL-E request will be made.'
  };
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

  statusBadge.textContent = dryRun
    ? `LOCAL PLAN ${index + 1}/${mission.targets.length} · DRY RUN`
    : `PLANNING ${index + 1}/${mission.targets.length} · LIVE`;
  statusBadge.className = 'badge ready';

  setDecision(
    dryRun
      ? `Preparing local simulation for target ${index + 1} of ${mission.targets.length}: ${maskPhone(phone)}.`
      : `Requesting an authorized CALL-E plan for target ${index + 1} of ${mission.targets.length}: ${maskPhone(phone)}.`
  );

  if (dryRun) {
    activePlan = createLocalPlan(index, phone);
  } else {
    const response = await fetch('/api/plan', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: mission.goal,
        phone,
        language: 'English',
        region: 'GB',
        liveIntent: true
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'CALL-E planning failed');
    }

    const plan = data.plan;
    if (!plan || typeof plan.readyToRun !== 'boolean') {
      throw new Error('CALL-E returned no structured plan.');
    }

    activePlan = {
      ...plan,
      phone,
      targetIndex: index
    };

    if (!plan.readyToRun) {
      statusBadge.textContent = 'NEEDS INFO';
      setDecision(
        plan.clarifyingQuestions?.join(' ') ||
        plan.nextStep ||
        'CALL-E needs more information.'
      );
      return;
    }

    if (!plan.approvalToken) {
      throw new Error('Server did not issue a one-time live approval token.');
    }
  }

  statusBadge.textContent = dryRun
    ? `PLAN READY ${index + 1}/${mission.targets.length} · LOCAL`
    : `PLAN READY ${index + 1}/${mission.targets.length} · LIVE`;

  planGoal.textContent = mission.goal;
  planTarget.textContent = `Target ${index + 1}/${mission.targets.length}: ${maskPhone(phone)}`;
  planSummary.textContent = activePlan.confirmSummary || 'Ready for explicit confirmation.';
  confirmCallBtn.textContent = dryRun ? 'Simulate Call' : 'Confirm & Call';
  planCard.classList.remove('hidden');

  setDecision(
    dryRun
      ? 'Review this local fake plan. Simulate Call will not contact CALL-E or use the network.'
      : 'LIVE MODE: review carefully. The server will accept only an authorized destination and a one-time approval token.'
  );
}

function simulateCall() {
  const currentIndex = activePlan.targetIndex;
  const currentPhone = activePlan.phone;

  setStage(2);
  confirmCallBtn.disabled = true;
  cancelPlanBtn.disabled = true;
  planCard.classList.add('hidden');

  recordHistory(
    currentIndex,
    currentPhone,
    'running',
    'Local fake call is being evaluated. No CALL-E request was made.'
  );

  statusBadge.textContent = `SIMULATING ${currentIndex + 1}/${mission.targets.length}`;
  statusBadge.className = 'badge ready';
  setDecision(`Dry Run: locally simulating target ${maskPhone(currentPhone)}.`);

  setTimeout(() => {
    statusBadge.textContent = 'LOCAL CALL STARTED';
    setDecision(`Dry Run: local fake call to ${maskPhone(currentPhone)} started.`);
  }, 500);

  setTimeout(async () => {
    setStage(3);
    const success = currentIndex === mission.targets.length - 1;

    if (success) {
      recordHistory(
        currentIndex,
        currentPhone,
        'success',
        'Local simulation marked the mission goal satisfied. CallChain stopped here.'
      );
      statusBadge.textContent = 'GOAL ACHIEVED';
      setDecision(
        `Dry Run: target ${currentIndex + 1} satisfied the simulated mission. No CALL-E authentication, network access, or call credits were used.`
      );
      completeTimeline();
      confirmCallBtn.disabled = false;
      cancelPlanBtn.disabled = false;
      return;
    }

    recordHistory(
      currentIndex,
      currentPhone,
      'failed',
      'Local simulation marked the goal unsatisfied. CallChain continued to the next target.'
    );

    setStage(4);
    statusBadge.textContent = 'CONTINUING';
    setDecision(
      `Dry Run: target ${currentIndex + 1} did not satisfy the simulated goal. Human API is moving to target ${currentIndex + 2}.`
    );

    try {
      await prepareTarget(currentIndex + 1);
    } catch (error) {
      statusBadge.textContent = 'ERROR';
      statusBadge.className = 'badge idle';
      setDecision(error.message);
    } finally {
      confirmCallBtn.disabled = false;
      cancelPlanBtn.disabled = false;
    }
  }, 1800);
}

async function pollStatus(statusToken) {
  try {
    setStage(3);

    const response = await fetch(
      `/api/status/${encodeURIComponent(statusToken)}`,
      { credentials: 'same-origin' }
    );
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Status check failed');
    }

    const status = data.status || 'RUNNING';
    const summary = data.summary || '';

    statusBadge.textContent = String(status).toUpperCase();
    statusBadge.className = 'badge ready';
    setDecision(summary || `CALL-E status: ${status}`);

    if (isTerminal(status)) {
      clearTimeout(pollTimer);
      confirmCallBtn.disabled = false;
      cancelPlanBtn.disabled = false;

      const missionOutcome = classifyMissionOutcome(data, summary);
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
        if (
          mission &&
          activePlan?.targetIndex + 1 < mission.targets.length
        ) {
          statusBadge.textContent = 'CONTINUING';
          setDecision('Goal not achieved. Preparing the next authorized target for user confirmation.');
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

    pollTimer = setTimeout(() => pollStatus(statusToken), 7000);
  } catch (error) {
    statusBadge.textContent = 'STATUS ERROR';
    statusBadge.className = 'badge idle';
    setDecision(error.message);
    confirmCallBtn.disabled = false;
    cancelPlanBtn.disabled = false;
  }
}

previewBtn.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  const targets = getTargets();

  activePlan = null;
  mission = null;
  planCard.classList.add('hidden');
  resetHistory();
  setStage(0);

  if (!goal || targets.length === 0) {
    statusBadge.textContent = 'INCOMPLETE';
    statusBadge.className = 'badge idle';
    setDecision('Add a goal and at least one phone number.');
    return;
  }

  const invalidTarget = targets.find(phone => !E164_RE.test(phone));
  if (invalidTarget) {
    statusBadge.textContent = 'INVALID NUMBER';
    statusBadge.className = 'badge idle';
    setDecision('Every destination must use strict E.164 format, for example +442073238000.');
    return;
  }

  mission = { goal, targets, index: 0 };
  goalPreview.textContent = goal;
  targetCount.textContent = `${targets.length} phone number${targets.length === 1 ? '' : 's'}`;
  previewBtn.disabled = true;

  try {
    await prepareTarget(0);
  } catch (error) {
    statusBadge.textContent = 'ERROR';
    statusBadge.className = 'badge idle';
    setDecision(error.message);
  } finally {
    previewBtn.disabled = false;
  }
});

confirmCallBtn.addEventListener('click', async () => {
  if (!activePlan) return;

  if (dryRun) {
    simulateCall();
    return;
  }

  if (!activePlan.approvalToken) {
    statusBadge.textContent = 'RE-PLAN REQUIRED';
    statusBadge.className = 'badge idle';
    setDecision('The one-time server approval token is missing. Preview the mission again before attempting a live call.');
    return;
  }

  setStage(2);
  confirmCallBtn.disabled = true;
  cancelPlanBtn.disabled = true;

  recordHistory(
    activePlan.targetIndex,
    activePlan.phone,
    'running',
    'Authorized CALL-E call started; awaiting bounded structured outcome.'
  );

  statusBadge.textContent = 'STARTING LIVE CALL';
  statusBadge.className = 'badge ready';
  setDecision(`LIVE: user confirmed target ${maskPhone(activePlan.phone)}. Requesting the one-time server-authorized run.`);

  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        approvalToken: activePlan.approvalToken,
        liveIntent: true
      })
    });

    const data = await response.json();

    if (data.indeterminate === true) {
      activePlan.approvalToken = null;
      statusBadge.textContent = 'RECONCILE REQUIRED';
      statusBadge.className = 'badge idle';
      setDecision(
        data.error ||
          'CALL-E run status is uncertain. Do not retry. Verify CALL-E call history before attempting another call.'
      );
      confirmCallBtn.disabled = true;
      cancelPlanBtn.disabled = false;
      return;
    }

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'CALL-E call failed to start');
    }

    if (!data.statusToken) {
      activePlan.approvalToken = null;
      statusBadge.textContent = 'RECONCILE REQUIRED';
      statusBadge.className = 'badge idle';
      setDecision(
        'CALL-E returned no status token. Do not retry. Verify CALL-E call history before attempting another call.'
      );
      confirmCallBtn.disabled = true;
      cancelPlanBtn.disabled = false;
      return;
    }

    activePlan.approvalToken = null;
    statusBadge.textContent = 'CALL STARTED';
    setDecision('Real call started. Waiting for the bounded CALL-E result…');
    planCard.classList.add('hidden');
    pollTimer = setTimeout(() => pollStatus(data.statusToken), 10000);
  } catch (error) {
    activePlan.approvalToken = null;
    statusBadge.textContent = 'CALL ERROR';
    statusBadge.className = 'badge idle';
    setDecision(
      `${error.message} Do not immediately retry if the request may have reached CALL-E. Verify call history first.`
    );
    confirmCallBtn.disabled = true;
    cancelPlanBtn.disabled = false;
  }
});

cancelPlanBtn.addEventListener('click', () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  activePlan = null;
  mission = null;
  planCard.classList.add('hidden');
  statusBadge.textContent = 'CANCELLED';
  statusBadge.className = 'badge idle';
  setDecision('Mission cancelled. No further calls will be placed.');
  setStage(0);
});

renderHistory();
setStage(0);
updateModeUI();
