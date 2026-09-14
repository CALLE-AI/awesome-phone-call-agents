import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { remediationEngine } from './remediation.js';
import { dispatchVoiceSRECall } from './calle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const config = loadConfig();

// Get real-time system metrics
app.get('/api/status', (req, res) => {
  res.json({
    metrics: remediationEngine.getState(),
    config: {
      mode: config.mode,
      hasApiKey: Boolean(config.calleApiKey && !config.calleApiKey.startsWith('mock_')),
      targetPhoneMasked: config.onCallPhoneNumber ? `${config.onCallPhoneNumber.substring(0, 3)}******${config.onCallPhoneNumber.substring(config.onCallPhoneNumber.length - 4)}` : 'N/A'
    }
  });
});

// Trigger a P0 outage simulation
app.post('/api/incident/trigger', (req, res) => {
  const incident = remediationEngine.triggerOutage();
  res.json({
    success: true,
    incident,
    metrics: remediationEngine.getState()
  });
});

// Dispatch VoiceSRE Phone Call (Live or Preview)
app.post('/api/dispatch', async (req, res) => {
  try {
    const currentState = remediationEngine.getState();
    if (!currentState.activeIncident) {
      return res.status(400).json({ error: 'No active incident found. Trigger an incident first.' });
    }

    const mode = (req.body.mode || config.mode) as 'preview' | 'live';
    const phoneNumber = req.body.phoneNumber || config.onCallPhoneNumber;
    const apiKey = req.body.apiKey || config.calleApiKey;

    const dispatchResult = await dispatchVoiceSRECall({
      apiKey,
      phoneNumber,
      mode,
      incident: currentState.activeIncident
    });

    // Automatically execute remediation based on voice decision
    const remediationResult = await remediationEngine.executeRemediation(
      dispatchResult.result.action_decision,
      dispatchResult.result.target_version,
      dispatchResult.result.engineer_notes
    );

    res.json({
      success: true,
      dispatch: dispatchResult,
      remediation: remediationResult
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Dispatch failed' });
  }
});

// Direct remediation endpoint
app.post('/api/remediate', async (req, res) => {
  const { decision, targetVersion, notes } = req.body;
  const result = await remediationEngine.executeRemediation(decision || 'rollback', targetVersion, notes);
  res.json(result);
});

app.listen(config.port, () => {
  console.log(`=======================================================`);
  console.log(`🚀 VoiceSRE Incident Response Server running on port ${config.port}`);
  console.log(`📡 Mission Control UI: http://localhost:${config.port}`);
  console.log(`🔒 Execution Mode: ${config.mode.toUpperCase()}`);
  console.log(`=======================================================`);
});
