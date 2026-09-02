import express from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { expandHomePath, resolveServerUrl } from '@call-e/core/config';
import { callMcpTool } from '@call-e/core/mcp-client';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb', strict: true }));
app.use(express.static('.'));

const E164_RE = /^\+[1-9]\d{7,14}$/;
const TOKEN_RE = /^[0-9a-f-]{36}$/i;

const AUTH_USER = process.env.HUMAN_API_USER || '';
const AUTH_PASSWORD = process.env.HUMAN_API_PASSWORD || '';
const LIVE_ENABLED = process.env.HUMAN_API_LIVE_ENABLED === 'true';

const ALLOWED_NUMBERS = new Set(
  String(process.env.HUMAN_API_ALLOWED_NUMBERS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => E164_RE.test(value))
);

const APPROVAL_TTL_MS = 5 * 60 * 1000;
const RUN_TTL_MS = 30 * 60 * 1000;

const approvals = new Map();
const runs = new Map();

const calleConfig = {
  cacheRoot: expandHomePath(
    process.env.CALLE_MCP_CACHE_ROOT || '~/.calle-mcp/cli'
  ),
  serverUrl: resolveServerUrl({
    serverUrl: process.env.CALLE_MCP_SERVER_URL,
  }),
  timeoutSeconds: 30,
};

function safeEqual(left, right) {
  const a = Buffer.from(String(left), 'utf8');
  const b = Buffer.from(String(right), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireBasicAuth(req, res, next) {
  if (!AUTH_USER || !AUTH_PASSWORD) {
    return res.status(503).json({
      ok: false,
      error: 'Live API authentication is not configured.',
    });
  }

  const header = req.get('authorization') || '';
  if (!header.startsWith('Basic ')) {
    res.set(
      'WWW-Authenticate',
      'Basic realm="Kanverse Human API", charset="UTF-8"'
    );
    return res.status(401).json({
      ok: false,
      error: 'Authentication required.',
    });
  }

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    decoded = '';
  }

  const separator = decoded.indexOf(':');
  const user = separator >= 0 ? decoded.slice(0, separator) : '';
  const password = separator >= 0 ? decoded.slice(separator + 1) : '';

  if (
    !safeEqual(user, AUTH_USER) ||
    !safeEqual(password, AUTH_PASSWORD)
  ) {
    res.set(
      'WWW-Authenticate',
      'Basic realm="Kanverse Human API", charset="UTF-8"'
    );
    return res.status(401).json({
      ok: false,
      error: 'Authentication required.',
    });
  }

  next();
}

function boundedText(value, maxLength = 800) {
  return String(value ?? '')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[redacted phone]')
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
      ''
    )
    .slice(0, maxLength);
}

function validGoal(value) {
  return (
    typeof value === 'string' &&
    value.trim().length >= 3 &&
    value.trim().length <= 1200
  );
}

function validLanguage(value) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z][A-Za-z -]{0,31}$/.test(value)
  );
}

function validRegion(value) {
  return (
    typeof value === 'string' &&
    /^[A-Z]{2}$/.test(value)
  );
}

function pruneState() {
  const now = Date.now();

  for (const [token, value] of approvals) {
    if (value.used || value.expiresAt <= now) {
      approvals.delete(token);
    }
  }

  for (const [token, value] of runs) {
    if (value.expiresAt <= now) {
      runs.delete(token);
    }
  }
}

function normalizeConfidence(outcome) {
  const confidence = outcome?.completion_confidence;

  if (!confidence || typeof confidence !== 'object') {
    return null;
  }

  const score = Number(confidence.score);

  return {
    score: Number.isFinite(score)
      ? Math.max(0, Math.min(1, score))
      : null,
    label: boundedText(confidence.label, 32),
  };
}

function requireLiveConfiguration(res) {
  if (!LIVE_ENABLED) {
    res.status(403).json({
      ok: false,
      error:
        'Live calling is disabled on this server. Set HUMAN_API_LIVE_ENABLED=true to enable it.',
    });
    return false;
  }

  if (!ALLOWED_NUMBERS.size) {
    res.status(503).json({
      ok: false,
      error: 'No authorized live destinations are configured.',
    });
    return false;
  }

  return true;
}

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api', requireBasicAuth);

app.post('/api/plan', async (req, res) => {
  pruneState();

  if (!requireLiveConfiguration(res)) {
    return;
  }

  const {
    goal,
    phone,
    language = 'English',
    region = 'GB',
    liveIntent,
  } = req.body || {};

  if (liveIntent !== true) {
    return res.status(400).json({
      ok: false,
      error: 'Explicit live intent is required for CALL-E planning.',
    });
  }

  if (!validGoal(goal)) {
    return res.status(400).json({
      ok: false,
      error: 'Goal must be between 3 and 1200 characters.',
    });
  }

  if (typeof phone !== 'string' || !E164_RE.test(phone)) {
    return res.status(400).json({
      ok: false,
      error: 'Destination must be a strict E.164 phone number.',
    });
  }

  if (!ALLOWED_NUMBERS.has(phone)) {
    return res.status(403).json({
      ok: false,
      error: 'Destination is not authorized for live calling.',
    });
  }

  const normalizedRegion = String(region).toUpperCase();

  if (
    !validLanguage(language) ||
    !validRegion(normalizedRegion)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid language or region.',
    });
  }

  try {
    const plan = await callMcpTool({
      config: calleConfig,
      toolName: 'plan_call',
      toolArguments: {
        to_phones: [phone],
        goal: goal.trim(),
        language,
        region: normalizedRegion,
        user_input:
          'Plan the call exactly as specified in the goal.',
      },
    });

    if (!plan?.plan_id) {
      return res.status(502).json({
        ok: false,
        error: 'CALL-E returned an invalid plan.',
      });
    }

    let approvalToken = null;

    if (
      plan.ready_to_run === true &&
      typeof plan.confirm_token === 'string' &&
      plan.confirm_token
    ) {
      approvalToken = randomUUID();

      approvals.set(approvalToken, {
        planId: plan.plan_id,
        confirmToken: plan.confirm_token,
        expiresAt: Date.now() + APPROVAL_TTL_MS,
        used: false,
      });
    }

    return res.json({
      ok: true,
      plan: {
        readyToRun: plan.ready_to_run === true,
        nextStep: boundedText(plan.next_step),
        clarifyingQuestions: Array.isArray(
          plan.clarifying_questions
        )
          ? plan.clarifying_questions
              .slice(0, 5)
              .map((value) => boundedText(value, 240))
          : [],
        confirmSummary: boundedText(
          plan.confirm_summary,
          1000
        ),
        approvalToken,
      },
    });
  } catch (error) {
    console.error(
      'CALL-E plan failed:',
      error?.name || 'Error'
    );

    return res.status(502).json({
      ok: false,
      error: 'CALL-E planning failed.',
    });
  }
});

app.post('/api/run', async (req, res) => {
  pruneState();

  if (!requireLiveConfiguration(res)) {
    return;
  }

  const { approvalToken, liveIntent } = req.body || {};

  if (liveIntent !== true) {
    return res.status(400).json({
      ok: false,
      error: 'Explicit live intent is required.',
    });
  }

  if (
    typeof approvalToken !== 'string' ||
    !TOKEN_RE.test(approvalToken)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'A valid one-time approval token is required.',
    });
  }

  const approval = approvals.get(approvalToken);

  if (
    !approval ||
    approval.used ||
    approval.expiresAt <= Date.now()
  ) {
    approvals.delete(approvalToken);

    return res.status(403).json({
      ok: false,
      error:
        'Approval token is invalid or expired. Re-plan before calling.',
    });
  }

  approval.used = true;

  try {
    const run = await callMcpTool({
      config: calleConfig,
      toolName: 'run_call',
      toolArguments: {
        plan_id: approval.planId,
        confirm_token: approval.confirmToken,
      },
    });

    if (!run?.run_id) {
      return res.status(502).json({
        ok: false,
        error: 'CALL-E did not return a run identifier.',
      });
    }

    const statusToken = randomUUID();

    runs.set(statusToken, {
      runId: run.run_id,
      expiresAt: Date.now() + RUN_TTL_MS,
    });

    return res.json({
      ok: true,
      statusToken,
      status: boundedText(run.status || 'STARTED', 40),
    });
  } catch (error) {
    console.error(
      'CALL-E run failed:',
      error?.name || 'Error'
    );

    return res.status(502).json({
      ok: false,
      error:
        'CALL-E call failed to start. Re-plan before retrying.',
    });
  } finally {
    approvals.delete(approvalToken);
  }
});

app.get('/api/status/:statusToken', async (req, res) => {
  pruneState();

  const { statusToken } = req.params;

  if (!TOKEN_RE.test(statusToken)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid status token.',
    });
  }

  const record = runs.get(statusToken);

  if (!record) {
    return res.status(404).json({
      ok: false,
      error: 'Status token is unknown or expired.',
    });
  }

  try {
    const run = await callMcpTool({
      config: calleConfig,
      toolName: 'get_call_run',
      toolArguments: {
        run_id: record.runId,
      },
    });

    const outcome =
      run?.result?.outcome ||
      run?.outcome ||
      null;

    const summary =
      run?.result?.summary ||
      run?.summary ||
      '';

    return res.json({
      ok: true,
      status: boundedText(run?.status || 'UNKNOWN', 40),
      summary: boundedText(summary, 1000),
      taskCompleted:
        typeof outcome?.task_completed === 'boolean'
          ? outcome.task_completed
          : null,
      confidence: normalizeConfidence(outcome),
    });
  } catch (error) {
    console.error(
      'CALL-E status failed:',
      error?.name || 'Error'
    );

    return res.status(502).json({
      ok: false,
      error: 'CALL-E status check failed.',
    });
  }
});

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(
    `Kanverse Human API running on http://localhost:${port}`
  );
});
