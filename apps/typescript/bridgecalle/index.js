const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Strictly validate E.164 phone numbers (+15550100000, +919876543210, etc.)
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

function maskPhone(phone) {
  if (!phone || phone.length < 6) return '****';
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-4);
  return `${prefix} ***** *${suffix}`;
}

app.post('/api/calls/trigger', async (req, res) => {
  try {
    const { seniorName, seniorPhone, execute, confirmOptIn, operatorKey } = req.body;
    const apiKey = process.env.CALLE_API_KEY || '';

    if (!seniorPhone || !E164_REGEX.test(seniorPhone)) {
      return res.status(400).json({
        success: false,
        mode: 'invalid_input',
        message: 'Invalid phone number. A valid E.164 phone number is required (e.g. standards-reserved +15550100000 or sample +919876543210).'
      });
    }

    const cleanName = (seniorName || 'Human').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const masked = maskPhone(seniorPhone);
    const isIndia = seniorPhone.startsWith('+91');

    // Operator Authorization / Local Boundary Verification
    const clientIp = req.ip || req.socket.remoteAddress || '';
    const isLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIp) || req.hostname === 'localhost';
    const serverOperatorKey = process.env.OPERATOR_KEY || process.env.OPERATOR_SECRET || '';
    const reqKey = req.headers['x-operator-key'] || operatorKey || '';
    const isOperatorAuthorized = serverOperatorKey ? (reqKey === serverOperatorKey) : true;

    const isLiveAuthorized = (isLocal || (serverOperatorKey && isOperatorAuthorized)) && isOperatorAuthorized;

    // Dry-run preview mode by default unless live execution, opt-in, and local/operator authorization are ALL present
    if (!execute || !confirmOptIn || !apiKey || !isLiveAuthorized) {
      return res.json({
        success: true,
        mode: 'preview',
        message: 'Dry-run preview mode (no network call placed). Requires server CALLE_API_KEY, local operator authorization, and explicit execute flags.',
        call: {
          calleCallId: `calle_preview_${Date.now()}`,
          maskedPhone: masked,
          name: cleanName,
          status: 'PREVIEW_COMPLETED'
        }
      });
    }

    // Live execution route (Server-side key only)
    const response = await fetch('https://api.heycall-e.com/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `bridgecalle_${Date.now()}`
      },
      body: JSON.stringify({
        task: `Call ${seniorPhone} in ${isIndia ? 'English (India)' : 'English'}. Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm.`,
        recipients: [{ phones: [seniorPhone], region: isIndia ? 'IN' : 'US', locale: isIndia ? 'en-IN' : 'en-US' }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      // Omit/sanitize raw provider error output to prevent internal diagnostic leaks
      console.error(`[CALL-E Engine] Provider returned HTTP ${response.status} failure status.`);
      return res.status(400).json({
        success: false,
        mode: 'live_failed',
        message: 'Unable to initiate call task at provider. Please verify phone number and parameters.'
      });
    }

    res.json({
      success: true,
      mode: 'live',
      call: {
        calleCallId: data.id,
        maskedPhone: masked,
        name: cleanName,
        status: 'DISPATCHED'
      }
    });
  } catch (err) {
    console.error('[CALL-E Engine] Internal server error encountered during dispatch.');
    res.status(500).json({
      success: false,
      mode: 'server_error',
      message: 'Server error processing call task.'
    });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BridgeCalle Server running on http://localhost:${PORT}`);
});
