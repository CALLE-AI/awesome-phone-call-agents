const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/calls/trigger', async (req, res) => {
  try {
    const { seniorName, seniorPhone } = req.body;
    const apiKey = process.env.CALLE_API_KEY || '';
    const cleanPhone = (seniorPhone || '+919265408610').replace(/[^+\d]/g, '');
    const isIndia = cleanPhone.startsWith('+91');

    if (!apiKey) {
      return res.json({
        success: true,
        message: 'Preview mode: CALL-E API key not set.',
        call: { calleCallId: `calle_preview_${Date.now()}` }
      });
    }

    const response = await fetch('https://api.heycall-e.com/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `bridgecalle_${Date.now()}`
      },
      body: JSON.stringify({
        task: `Call ${cleanPhone} in ${isIndia ? 'English (India)' : 'English'}. Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm.`,
        recipients: [{ phones: [cleanPhone], region: isIndia ? 'IN' : 'US', locale: isIndia ? 'en-IN' : 'en-US' }]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(400).json({ success: false, message: data.error ? data.error.message : 'CALL-E API Error' });
    }

    res.json({
      success: true,
      call: { calleCallId: data.id }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BridgeCalle Server running on http://localhost:${PORT}`);
});
