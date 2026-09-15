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
    const { seniorName, seniorPhone, execute, confirmOptIn } = req.body;
    const apiKey = process.env.CALLE_API_KEY || '';

    if (!seniorPhone || !E164_REGEX.test(seniorPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number. A valid E.164 phone number is required (e.g. standards-reserved +15550100000 or sample +919876543210).'
      });
    }

    const cleanName = (seniorName || 'Human').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const masked = maskPhone(seniorPhone);
    const isIndia = seniorPhone.startsWith('+91');

    // Dry-run preview mode by default unless live execution and opt-in are explicitly authorized
    if (!execute || !confirmOptIn || !apiKey) {
      return res.json({
        success: true,
        mode: 'preview',
        message: 'Dry-run preview mode (no network call placed). Provide server CALLE_API_KEY and pass execute: true & confirmOptIn: true for live calls.',
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
      console.error('[CALL-E Engine] Provider response error:', data.error || data);
      return res.status(400).json({
        success: false,
        message: 'Unable to initiate call task at provider. Please verify phone number and try again.'
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
    res.status(500).json({ success: false, message: 'Server error triggering call.' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BridgeCalle Server running on http://localhost:${PORT}`);
});
