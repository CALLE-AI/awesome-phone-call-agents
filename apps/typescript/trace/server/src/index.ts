import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { taskService } from './services/taskService.js';
import { callService } from './services/callService.js';
import { generateTasksExcelWorkbook, generateTasksCsv } from './services/exportService.js';

// Load dotenv from local dir or parent dir
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// -------------------------------------------------------------
// 1. HEALTH & SYSTEM INFO & MODE SWITCHING
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const { mode } = callService.getActiveProvider();
  const hasApiKey = Boolean(process.env.CALLE_API_KEY || process.env.CALL_E_API_KEY);
  const isMockEnv = process.env.PHONE_PROVIDER_MODE === 'mock';

  res.json({
    status: 'ok',
    version: '1.0.0',
    mode,
    hasApiKey,
    isMockConfigured: isMockEnv,
    system: 'TRACE Autonomous Verification Engine',
  });
});

app.post('/api/mode', (req, res) => {
  const { mode } = req.body;
  if (mode !== 'LIVE' && mode !== 'MOCK') {
    return res.status(400).json({ error: 'Mode must be either LIVE or MOCK.' });
  }

  if (mode === 'LIVE' && !callService.isLiveAvailable()) {
    return res.status(400).json({
      error: 'Cannot switch to LIVE mode: CALL-E API key is not configured on the server.',
    });
  }

  callService.setMode(mode);
  res.json({
    success: true,
    mode,
    message: `Switched telephony engine to ${mode} mode.`,
  });
});

// -------------------------------------------------------------
// 2. VERIFICATION TASKS COLLECTION
// -------------------------------------------------------------
app.get('/api/tasks', (req, res) => {
  const tasks = taskService.getAllTasks();
  const stats = taskService.getStats();
  res.json({ tasks, stats });
});

app.post('/api/tasks', (req, res) => {
  const {
    target,
    item,
    verificationType,
    subject,
    verificationGoal,
    context,
    questions,
    digitalClaim,
  } = req.body;

  const result = taskService.createTask({
    target,
    item,
    verificationType,
    subject,
    verificationGoal,
    context,
    questions,
    digitalClaim,
  });

  if (!result.success) {
    return res.status(400).json({ error: result.error });
  }

  res.status(201).json(result.task);
});

// -------------------------------------------------------------
// 3. EXPORT ENDPOINTS (Defined before :id wildcards)
// -------------------------------------------------------------
app.get('/api/tasks/export.xlsx', async (req, res) => {
  try {
    const tasks = taskService.getAllTasks();
    const buffer = await generateTasksExcelWorkbook(tasks);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TRACE_Verification_Audit_${Date.now()}.xlsx"`
    );
    res.send(buffer);
  } catch (err: any) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: `Failed to generate Excel workbook: ${err.message}` });
  }
});

app.get('/api/tasks/export.csv', (req, res) => {
  try {
    const tasks = taskService.getAllTasks();
    const csv = generateTasksCsv(tasks);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TRACE_Verification_Summary_${Date.now()}.csv"`
    );
    res.send(csv);
  } catch (err: any) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: `Failed to generate CSV: ${err.message}` });
  }
});

app.get('/api/tasks/export.json', (req, res) => {
  try {
    const tasks = taskService.getAllTasks();
    const stats = taskService.getStats();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TRACE_Verification_Audit_${Date.now()}.json"`
    );
    res.json({ exportedAt: new Date().toISOString(), stats, tasks });
  } catch (err: any) {
    console.error('JSON export error:', err);
    res.status(500).json({ error: `Failed to generate JSON export: ${err.message}` });
  }
});

app.post('/api/tasks/verify-all', async (req, res) => {
  const tasks = taskService.getAllTasks();
  const pending = tasks.filter((t) => t.callState === 'IDLE');

  const results = [];
  for (const t of pending) {
    const outcome = await callService.startVerification(t.id);
    results.push(outcome);
  }

  res.json({
    triggered: results.length,
    tasks: taskService.getAllTasks(),
    stats: taskService.getStats(),
  });
});

// -------------------------------------------------------------
// 3. SINGLE TASK ACTIONS & CRUD
// -------------------------------------------------------------
app.get('/api/tasks/:id/export.xlsx', async (req, res) => {
  try {
    const task = taskService.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    const buffer = await generateTasksExcelWorkbook([task]);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TRACE_${task.id}_Audit.xlsx"`
    );
    res.send(buffer);
  } catch (err: any) {
    console.error('Single task Excel export error:', err);
    res.status(500).json({ error: `Failed to export task Excel: ${err.message}` });
  }
});

app.get('/api/tasks/:id/export.json', (req, res) => {
  try {
    const task = taskService.getTaskById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="TRACE_${task.id}_Audit.json"`
    );
    res.json(task);
  } catch (err: any) {
    console.error('Single task JSON export error:', err);
    res.status(500).json({ error: `Failed to export task JSON: ${err.message}` });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  const task = taskService.getTaskById(req.params.id);
  if (!task) {
    return res.status(404).json({ error: `Task ${req.params.id} not found.` });
  }
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const deleted = taskService.deleteTask(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: `Task ${req.params.id} not found.` });
  }
  res.json({ success: true, id: req.params.id });
});

// -------------------------------------------------------------
// 4. CALL TRIGGERING & POLLING
// -------------------------------------------------------------
app.post('/api/tasks/:id/verify', async (req, res) => {
  const taskId = req.params.id;
  const forceMock = req.query.mock === 'true';

  const outcome = await callService.startVerification(taskId, forceMock);
  if (!outcome.success) {
    return res.status(500).json({ error: outcome.error, task: outcome.task });
  }

  res.json(outcome.task);
});

app.get('/api/calls/:id', async (req, res) => {
  const callId = req.params.id;
  const taskId = req.query.taskId as string | undefined;

  const progress = await callService.pollCallProgress(callId, taskId);
  if (!progress.success) {
    return res.status(404).json({ error: progress.error });
  }

  res.json({
    task: progress.task,
    record: progress.record,
  });
});

// -------------------------------------------------------------
// 5. WEBHOOKS (CALL-E TERMINAL EVENTS)
// -------------------------------------------------------------
app.post('/api/calle/webhook', async (req, res) => {
  try {
    const result = await callService.handleWebhookEvent(req.body);
    res.json({ received: true, ...result });
  } catch (err: any) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 6. DEMO DATA MANAGEMENT
// -------------------------------------------------------------
app.post('/api/demo/load', (req, res) => {
  const tasks = taskService.loadDemoCampaign();
  res.json({
    message: 'Generic safe demo benchmark campaign loaded.',
    tasks,
    stats: taskService.getStats(),
  });
});

app.post('/api/demo/clear', (req, res) => {
  taskService.clearTasks();
  res.json({
    message: 'Tasks cleared.',
    tasks: [],
    stats: taskService.getStats(),
  });
});

// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[TRACE SERVER] Running on port ${PORT}`);
  const { mode } = callService.getActiveProvider();
  console.log(`[TRACE SERVER] Telephony Engine Mode: ${mode}`);
});
