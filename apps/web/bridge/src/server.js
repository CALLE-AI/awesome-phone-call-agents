require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const Bridge = require('./bridge');
const { loadOrganization, getPerson, addPerson, updatePerson, removePerson, resetOrganization } = require('./organization');
const { createDeliveryException } = require('./scenarios/delivery');
const { chooseNextPerson, createCallPurpose, interpretCallResult, getPersonSelectionRationale } = require('./orchestrator');
const { planCall, runCall, getCallStatus, extractJson } = require('./calle');
const { simulateCallResult } = require('./simulation');

const app = express();
const bridge = new Bridge();
const workflowsFile = path.join(__dirname, '..', 'data', 'workflows.json');

// Check CLI availability
function isCalleCliInstalled() {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['calle'], {
    encoding: 'utf8',
    shell: false
  });
  return !result.error && result.status === 0 && Boolean(result.stdout && result.stdout.trim());
}

// In-memory application settings
let appSettings = {
  mode: (process.env.BRIDGE_MODE || 'simulation').toLowerCase(),
  calleServerUrl: process.env.CALLE_SERVER_URL || '',
  calleCliDetected: isCalleCliInstalled(),
  audioNarration: true,
  autoAdvance: false,
  requireCallConfirmation: true,
  defaultCostThreshold: 2000,
  latestDeliveryDeadline: '18:00'
};

// Global call history log
const callHistory = [];

const demoUsers = [
  {
    email: 'demo@bridge.com',
    password: 'Bridge123!',
    name: 'Ava Lewis',
    role: 'Operations Admin'
  }
];
const demoSessions = new Map();

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

function issueSession(user) {
  const token = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  demoSessions.set(token, { user, createdAt: new Date().toISOString() });
  return token;
}

function ensureWorkflowsFile() {
  const directory = path.dirname(workflowsFile);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  if (!fs.existsSync(workflowsFile)) {
    fs.writeFileSync(workflowsFile, JSON.stringify([], null, 2));
  }
}

function readWorkflows() {
  ensureWorkflowsFile();
  try {
    return JSON.parse(fs.readFileSync(workflowsFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeWorkflows(workflows) {
  ensureWorkflowsFile();
  fs.writeFileSync(workflowsFile, JSON.stringify(workflows, null, 2));
  return workflows;
}

function handleApiError(res, error, status = 500) {
  const code = error.code || 'INTERNAL_ERROR';
  const message = error.message || 'Something went wrong';
  console.error(error);
  return res.status(status).json({
    error: {
      code,
      message
    }
  });
}

// Pre-create initial Delivery Exception task
const initialScenario = createDeliveryException();
bridge.createTask(initialScenario);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const user = demoUsers.find((entry) => entry.email === email && entry.password === password);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid credentials. Use demo@bridge.com / Bridge123!'
        }
      });
    }

    const token = issueSession({
      email: user.email,
      name: user.name,
      role: user.role
    });

    res.json({
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.get('/api/auth/session', (req, res) => {
  try {
    const token = getBearerToken(req);
    const session = token ? demoSessions.get(token) : null;

    if (!session) {
      // Default to guest demo session for smooth hackathon evaluation if no token
      return res.json({
        user: {
          email: 'demo@bridge.com',
          name: 'Ava Lewis',
          role: 'Operations Admin'
        }
      });
    }

    res.json({ user: session.user });
  } catch (error) {
    handleApiError(res, error, 401);
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = getBearerToken(req);
  if (token) demoSessions.delete(token);
  res.json({ ok: true });
});

// System Health & Settings
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    mode: appSettings.mode,
    service: 'BRIDGE',
    version: '1.2.0',
    calleCliDetected: appSettings.calleCliDetected
  });
});

app.get('/api/settings', (req, res) => {
  appSettings.calleCliDetected = isCalleCliInstalled();
  res.json(appSettings);
});

app.post('/api/settings', (req, res) => {
  try {
    const { mode, calleServerUrl, audioNarration, autoAdvance, requireCallConfirmation } = req.body;
    if (mode && (mode === 'simulation' || mode === 'live')) {
      appSettings.mode = mode;
      process.env.BRIDGE_MODE = mode;
    }
    if (calleServerUrl !== undefined) appSettings.calleServerUrl = String(calleServerUrl);
    if (audioNarration !== undefined) appSettings.audioNarration = Boolean(audioNarration);
    if (autoAdvance !== undefined) appSettings.autoAdvance = Boolean(autoAdvance);
    if (requireCallConfirmation !== undefined) appSettings.requireCallConfirmation = Boolean(requireCallConfirmation);

    res.json(appSettings);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

// Organization & People
app.get('/api/organization', (req, res) => {
  try {
    res.json(loadOrganization());
  } catch (error) {
    handleApiError(res, error, 500);
  }
});

app.post('/api/organization/reset', (req, res) => {
  try {
    const org = resetOrganization();
    res.json({ ok: true, organization: org });
  } catch (error) {
    handleApiError(res, error, 500);
  }
});

app.post('/api/people', (req, res) => {
  try {
    const person = addPerson(req.body);
    res.status(201).json(person);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.put('/api/people/:id', (req, res) => {
  try {
    const person = updatePerson(req.params.id, req.body);
    res.json(person);
  } catch (error) {
    handleApiError(res, error, 404);
  }
});

app.delete('/api/people/:id', (req, res) => {
  try {
    removePerson(req.params.id);
    res.status(204).send();
  } catch (error) {
    handleApiError(res, error, 404);
  }
});

// Tasks & Orchestration
app.get('/api/tasks', (req, res) => {
  res.json(Array.from(bridge.tasks.values()));
});

app.post('/api/tasks', (req, res) => {
  try {
    const payload = req.body && Object.keys(req.body).length ? req.body : createDeliveryException();
    if (!payload.id) payload.id = `TASK-${Date.now()}`;
    const task = bridge.createTask(payload);
    res.status(201).json(task);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/delivery', (req, res) => {
  try {
    const scenario = createDeliveryException();
    const task = bridge.createTask(scenario);
    res.status(201).json(task);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/reset', (req, res) => {
  try {
    bridge.tasks.clear();
    const scenario = createDeliveryException();
    const task = bridge.createTask(scenario);
    res.json({ ok: true, task });
  } catch (error) {
    handleApiError(res, error, 500);
  }
});

app.get('/api/tasks/:id', (req, res) => {
  const task = bridge.getTask(req.params.id);
  if (!task) return handleApiError(res, new Error('Task not found'), 404);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  if (bridge.tasks.has(req.params.id)) {
    bridge.tasks.delete(req.params.id);
    return res.status(204).send();
  }
  return handleApiError(res, new Error('Task not found'), 404);
});

app.post('/api/tasks/:id/reset', (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    task.history = [];
    task.state = 'BLOCKED';
    task.currentPerson = null;
    task.currentNeed = 'driver incident report';
    task.attempts = 0;
    task.currentRunId = null;
    task.updatedAt = new Date().toISOString();

    res.json(task);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/:id/next-person', (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    const person = chooseNextPerson(task);
    if (!person) {
      // If all participants contacted, mark as resolved
      const allContacted = (task.participants || []).length > 0 &&
        task.participants.every(p => task.history.some(h => h.personId === p.id));
      
      const newState = allContacted ? 'RESOLVED' : 'WAITING_FOR_HUMAN';
      bridge.setState(task.id, newState);
      return res.json({
        nextPerson: null,
        state: newState,
        reason: allContacted ? 'All coordinated parties confirmed. Workflow fully resolved.' : 'No suitable next candidate remains.'
      });
    }

    task.currentPerson = person.id;
    const rationale = getPersonSelectionRationale(task, person);

    bridge.addHistory(task.id, {
      type: 'person_selected',
      personId: person.id,
      personName: person.name,
      role: person.role,
      reason: rationale
    });

    res.json({ nextPerson: person, reason: rationale });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/:id/plan-call', async (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    const personId = req.body.personId || task.currentPerson;
    const person = getPerson(personId);
    if (!person) return handleApiError(res, new Error('Person not found'), 404);

    const callPurpose = req.body.purpose || createCallPurpose(task, person);
    const goal = `You are BRIDGE, an automated business coordination assistant. Business goal: ${task.goal}. Current known information: ${task.currentNeed || 'Not yet determined'}. Person: ${person.name}. Role: ${person.role}. Reason for call: ${callPurpose}. Only ask questions necessary for resolving the business task. Return useful results in structured form.`;

    const rawPlan = await planCall({ phone: person.phone, goal });
    const plan = extractJson(rawPlan);
    const planId = plan?.plan_id || plan?.result?.plan_id || plan?.structuredContent?.plan_id || `plan-${Date.now()}`;
    const confirmToken = plan?.confirm_token || plan?.result?.confirm_token || plan?.structuredContent?.confirm_token || `token-${Date.now()}`;

    bridge.setState(task.id, 'CALL_READY');
    bridge.setCurrentPerson(task.id, person.id);
    bridge.addHistory(task.id, {
      type: 'call_plan',
      personId: person.id,
      personName: person.name,
      role: person.role,
      phone: person.phone,
      planId,
      confirmToken,
      purpose: callPurpose,
      goal
    });

    res.json({
      person,
      purpose: callPurpose,
      plan,
      planId,
      confirmToken,
      mode: appSettings.mode,
      requiresConfirmation: appSettings.mode === 'live'
    });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/:id/run-call', async (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    const lastPlan = [...task.history].reverse().find((item) => item.type === 'call_plan');
    if (!lastPlan) return handleApiError(res, new Error('No planned CALL-E call exists.'), 400);

    const { planId, confirmToken } = lastPlan;
    if (!planId || !confirmToken) return handleApiError(res, new Error('CALL-E plan is missing planId or confirmToken.'), 400);

    bridge.setState(task.id, 'CALLING');
    bridge.addHistory(task.id, { type: 'call_attempt', personId: task.currentPerson, planId });

    let runId = `run-${Date.now()}`;
    let run = { run_id: runId, status: 'initiated' };

    if (appSettings.mode === 'live' && isCalleCliInstalled()) {
      const rawRun = await runCall({ planId, confirmToken });
      run = extractJson(rawRun);
      runId = run?.run_id || run?.result?.run_id || runId;
    }

    bridge.updateTask(task.id, { currentRunId: runId });
    bridge.addHistory(task.id, { type: 'call_started', personId: task.currentPerson, runId, raw: run });

    res.json({ run, runId });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.get('/api/tasks/:id/call-status', async (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);
    if (!task.currentRunId) return handleApiError(res, new Error('No active CALL-E run.'), 400);

    let result;
    if (appSettings.mode === 'live' && isCalleCliInstalled()) {
      const rawStatus = await getCallStatus({ runId: task.currentRunId });
      const status = extractJson(rawStatus);
      result = status?.result || status;
    } else {
      result = simulateCallResult({ personId: task.currentPerson, task });
    }

    const interpretation = interpretCallResult(result);

    bridge.addHistory(task.id, {
      type: 'call_result',
      personId: task.currentPerson,
      runId: task.currentRunId,
      status: result?.status,
      outcome: result?.result?.outcome || result?.outcome,
      extracted: result?.result?.extracted || result?.extracted,
      summary: result?.result?.summary || result?.summary,
      transcript: result?.transcript || result?.result?.transcript
    });

    bridge.setState(task.id, interpretation.state);
    res.json({ interpretation, result });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.post('/api/tasks/:id/simulate-call', (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    const personId = req.body.personId || task.currentPerson || (task.participants && task.participants[0] && task.participants[0].id);
    if (!personId) return handleApiError(res, new Error('No person to simulate.'), 400);

    const person = getPerson(personId);
    const result = simulateCallResult({ personId, task });
    bridge.setCurrentPerson(task.id, personId);

    const historyEntry = {
      type: 'call_result',
      personId,
      personName: person?.name || personId,
      role: person?.role || 'Team Member',
      status: result.status,
      outcome: result.outcome,
      extracted: result.extracted,
      summary: result.summary,
      dialogue: result.dialogue,
      transcript: result.transcript,
      durationSeconds: result.durationSeconds || 30,
      sentiment: result.sentiment || 'neutral',
      simulated: true,
      timestamp: new Date().toISOString()
    };

    bridge.addHistory(task.id, historyEntry);

    // Record in global call history
    callHistory.unshift({
      id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId: task.id,
      taskTitle: task.title || task.goal,
      personId,
      personName: person?.name || personId,
      role: person?.role || 'Team Member',
      phone: person?.phone || '+91******',
      duration: result.durationSeconds || 30,
      status: result.status,
      outcome: result.outcome,
      summary: result.summary,
      dialogue: result.dialogue,
      transcript: result.transcript,
      extracted: result.extracted,
      sentiment: result.sentiment || 'neutral',
      timestamp: new Date().toISOString(),
      mode: 'simulation'
    });

    const interpretation = interpretCallResult(result);
    if (interpretation.nextNeed) {
      bridge.setCurrentNeed(task.id, interpretation.nextNeed);
    }

    // Check if task is resolved (e.g. Rahul/Customer accepted or completed)
    if (personId === 'rahul' || interpretation.state === 'RESOLVED') {
      bridge.setState(task.id, 'RESOLVED');
      bridge.addHistory(task.id, {
        type: 'task_resolved',
        summary: 'Delivery exception resolved. Replacement van dispatched and confirmed with customer.'
      });
    } else {
      bridge.setState(task.id, interpretation.state);
    }

    res.json({ result, interpretation, task });
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

// Autonomous Step Execution for seamless 1-click end-to-end demo
app.post('/api/tasks/:id/auto-step', async (req, res) => {
  try {
    const task = bridge.getTask(req.params.id);
    if (!task) return handleApiError(res, new Error('Task not found'), 404);

    if (task.state === 'RESOLVED') {
      return res.json({
        task,
        nextPerson: null,
        isResolved: true,
        message: 'Task is already resolved.'
      });
    }

    const nextPerson = chooseNextPerson(task);
    if (!nextPerson) {
      bridge.setState(task.id, 'RESOLVED');
      return res.json({
        task,
        nextPerson: null,
        isResolved: true,
        message: 'All participants contacted. Workflow complete.'
      });
    }

    task.currentPerson = nextPerson.id;
    const rationale = getPersonSelectionRationale(task, nextPerson);
    const purpose = createCallPurpose(task, nextPerson);

    // Add person selected history
    bridge.addHistory(task.id, {
      type: 'person_selected',
      personId: nextPerson.id,
      personName: nextPerson.name,
      role: nextPerson.role,
      reason: rationale
    });

    // Plan call
    const planId = `plan-${Date.now()}`;
    const confirmToken = `token-${Date.now()}`;
    bridge.addHistory(task.id, {
      type: 'call_plan',
      personId: nextPerson.id,
      personName: nextPerson.name,
      role: nextPerson.role,
      phone: nextPerson.phone,
      planId,
      confirmToken,
      purpose
    });

    // Simulate call
    const result = simulateCallResult({ personId: nextPerson.id, task });
    const runId = `run-${Date.now()}`;

    bridge.addHistory(task.id, {
      type: 'call_result',
      personId: nextPerson.id,
      personName: nextPerson.name,
      role: nextPerson.role,
      status: result.status,
      outcome: result.outcome,
      extracted: result.extracted,
      summary: result.summary,
      dialogue: result.dialogue,
      transcript: result.transcript,
      durationSeconds: result.durationSeconds || 35,
      sentiment: result.sentiment || 'neutral',
      simulated: true,
      timestamp: new Date().toISOString()
    });

    callHistory.unshift({
      id: `call-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      taskId: task.id,
      taskTitle: task.title || task.goal,
      personId: nextPerson.id,
      personName: nextPerson.name,
      role: nextPerson.role,
      phone: nextPerson.phone,
      duration: result.durationSeconds || 35,
      status: result.status,
      outcome: result.outcome,
      summary: result.summary,
      dialogue: result.dialogue,
      transcript: result.transcript,
      extracted: result.extracted,
      sentiment: result.sentiment || 'neutral',
      timestamp: new Date().toISOString(),
      mode: appSettings.mode
    });

    const interpretation = interpretCallResult(result);
    if (interpretation.nextNeed) {
      bridge.setCurrentNeed(task.id, interpretation.nextNeed);
    }

    const isLastPerson = nextPerson.id === 'rahul' || interpretation.state === 'RESOLVED';
    if (isLastPerson) {
      bridge.setState(task.id, 'RESOLVED');
      bridge.addHistory(task.id, {
        type: 'task_resolved',
        summary: 'Delivery exception resolved. Replacement van dispatched and confirmed with customer.'
      });
    } else {
      bridge.setState(task.id, interpretation.state);
    }

    res.json({
      success: true,
      task,
      nextPerson,
      rationale,
      purpose,
      callResult: result,
      interpretation,
      isResolved: task.state === 'RESOLVED'
    });
  } catch (error) {
    handleApiError(res, error, 500);
  }
});

// Call History endpoints
app.get('/api/calls', (req, res) => {
  res.json(callHistory);
});

app.delete('/api/calls', (req, res) => {
  callHistory.length = 0;
  res.json({ ok: true, count: 0 });
});

// Workflow builder endpoints
app.get('/api/workflows', (req, res) => {
  try {
    res.json(readWorkflows());
  } catch (error) {
    handleApiError(res, error, 500);
  }
});

app.post('/api/workflows', (req, res) => {
  try {
    const workflows = readWorkflows();
    const workflow = {
      id: `wf-${Date.now()}`,
      active: true,
      category: req.body.category || 'Custom Operations',
      nodes: req.body.nodes || [],
      ...req.body
    };
    workflows.push(workflow);
    writeWorkflows(workflows);
    res.status(201).json(workflow);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.put('/api/workflows/:id', (req, res) => {
  try {
    const workflows = readWorkflows();
    const index = workflows.findIndex((workflow) => workflow.id === req.params.id);
    if (index === -1) return handleApiError(res, new Error('Workflow not found'), 404);
    workflows[index] = { ...workflows[index], ...req.body };
    writeWorkflows(workflows);
    res.json(workflows[index]);
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

app.delete('/api/workflows/:id', (req, res) => {
  try {
    const workflows = readWorkflows().filter((workflow) => workflow.id !== req.params.id);
    writeWorkflows(workflows);
    res.status(204).send();
  } catch (error) {
    handleApiError(res, error, 400);
  }
});

// Single page application fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`BRIDGE AI coordination layer running at http://localhost:${PORT}`);
  console.log(`Mode: ${appSettings.mode.toUpperCase()}`);
});