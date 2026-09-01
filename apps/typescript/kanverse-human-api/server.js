import express from 'express';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const app = express();

app.use(express.json());
app.use(express.static('.'));

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runCalle(command) {
  if (process.platform === 'win32') {
    return execAsync(command, { shell: 'powershell.exe', windowsHide: true });
  }
  return execAsync(command, { windowsHide: true });
}

app.post('/api/plan', async (req, res) => {
  const { goal, phone, language = 'English', region = 'GB' } = req.body || {};
  if (!goal || !phone) return res.status(400).json({ error: 'goal and phone are required' });

  try {
    const command = process.platform === 'win32'
      ? `calle.cmd call plan --to-phone ${psQuote(phone)} --goal ${psQuote(goal)} --language ${psQuote(language)} --region ${psQuote(region)}`
      : `calle call plan --to-phone ${JSON.stringify(phone)} --goal ${JSON.stringify(goal)} --language ${JSON.stringify(language)} --region ${JSON.stringify(region)}`;

    const { stdout, stderr } = await runCalle(command);
    return res.json({ ok: true, raw: stdout, stderr: stderr || '' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, stdout: error.stdout || '', stderr: error.stderr || '' });
  }
});

app.post('/api/run', async (req, res) => {
  const { planId, confirmToken } = req.body || {};
  if (!planId || !confirmToken) return res.status(400).json({ error: 'planId and confirmToken are required' });

  try {
    const command = process.platform === 'win32'
      ? `calle.cmd call run --plan-id ${psQuote(planId)} --confirm-token ${psQuote(confirmToken)}`
      : `calle call run --plan-id ${JSON.stringify(planId)} --confirm-token ${JSON.stringify(confirmToken)}`;

    const { stdout, stderr } = await runCalle(command);
    return res.json({ ok: true, raw: stdout, stderr: stderr || '' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, stdout: error.stdout || '', stderr: error.stderr || '' });
  }
});

app.get('/api/status/:runId', async (req, res) => {
  const { runId } = req.params;
  try {
    const command = process.platform === 'win32'
      ? `calle.cmd call status --run-id ${psQuote(runId)}`
      : `calle call status --run-id ${JSON.stringify(runId)}`;

    const { stdout, stderr } = await runCalle(command);
    return res.json({ ok: true, raw: stdout, stderr: stderr || '' });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, stdout: error.stdout || '', stderr: error.stderr || '' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Kanverse Human API running on http://localhost:${port}`));
