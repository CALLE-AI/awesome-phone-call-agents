#!/usr/bin/env node
// A stand-in CALL-E Developer API, so an escalation can be exercised end to end
// without ringing anybody.
//
//   node scripts/fake-calle-api.mjs            # recipient answers and confirms
//   node scripts/fake-calle-api.mjs voicemail  # a message exists; nobody heard it
//   node scripts/fake-calle-api.mjs noAnswer   # nothing landed
//   node scripts/fake-calle-api.mjs stranger   # someone else picked up
//   node scripts/fake-calle-api.mjs heardNotGoing
//
// Point your app at it:
//   CALLE_API_KEY=test CALLE_API_BASE_URL=http://127.0.0.1:9099 npm start
//
// The contribution guidelines rule out apps that depend on a private service
// with no fake-server path. The reasoning applies to whoever maintains this
// first: nobody should have to place a real emergency call to find out whether
// the ladder works.

import http from 'http';

const PORT = Number(process.env.FAKE_CALLE_PORT || 9099);
const scenario = process.argv[2] || 'acknowledged';

const SCENARIOS = {
  acknowledged: {
    structured: { reached: 'caregiver', acknowledged: 'yes' },
    turns: [
      { speaker: 'bot', text: 'Hello, this is Yadira. Am I speaking with Thomas?' },
      { speaker: 'user', text: 'Yes, this is Thomas.' },
      { speaker: 'bot', text: 'Eleanor pressed the help button at 3:14 and is asking for you. Are you able to get to them?' },
      { speaker: 'user', text: 'Yes, I am going now.' },
    ],
  },
  heardNotGoing: {
    structured: { reached: 'caregiver', acknowledged: 'no' },
    turns: [
      { speaker: 'bot', text: 'Hello, this is Yadira. Am I speaking with Thomas?' },
      { speaker: 'user', text: 'Yes, this is Thomas.' },
      { speaker: 'bot', text: 'Eleanor pressed the help button at 3:14 and is asking for you. Are you able to get to them?' },
      { speaker: 'user', text: 'I am two hours away, I cannot get there.' },
    ],
  },
  // The tempting failure: a message exists, but nobody has heard it. The ladder
  // must continue. The voicemail text intentionally names nobody.
  voicemail: {
    structured: { reached: 'voicemail', acknowledged: 'unknown' },
    turns: [
      { speaker: 'bot', text: 'This is Yadira calling. There is an alert waiting in your app. Please check it now.' },
    ],
  },
  noAnswer: {
    structured: { reached: 'no_answer', acknowledged: 'unknown' },
    turns: [],
  },
  stranger: {
    structured: { reached: 'someone_else', acknowledged: 'unknown' },
    turns: [
      { speaker: 'bot', text: 'Hello, this is Yadira. Am I speaking with Thomas?' },
      { speaker: 'user', text: 'No, wrong number.' },
      { speaker: 'bot', text: 'Sorry to have troubled you. Goodbye.' },
    ],
  },
};

const chosen = SCENARIOS[scenario] || SCENARIOS.acknowledged;

http
  .createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/v1/calls') {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const recipient = body.recipients?.[0] || {};
        console.log('[fake CALL-E] POST /v1/calls');
        console.log('  authorization:  ', req.headers.authorization ? 'Bearer <present>' : '(none)');
        console.log('  idempotency-key:', req.headers['idempotency-key'] || '(none)');
        console.log('  recipient:      ', JSON.stringify(recipient));
        console.log('  result schema:  ', Object.keys(body.recipient_result_schema?.properties || {}).join(', ') || '(none)');
        console.log('  message:        ', String(body.task || '').split('\n')[1] || String(body.task || '').slice(0, 90));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ call_id: 'call_fake_1', status: 'queued' }));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/v1/calls/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'completed',
            task_completed: chosen.structured.reached === 'caregiver',
            completion_confidence: { score: 0.9, label: 'high' },
            evidence: [`fake scenario: ${scenario}`],
            recipients: [
              {
                structured_result: chosen.structured,
                attempts: [
                  {
                    transcript_turns: chosen.turns.map((t, i) => ({ offset_seconds: i * 4, ...t })),
                  },
                ],
              },
            ],
          })
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  })
  .listen(PORT, '127.0.0.1', () =>
    console.log(`[fake CALL-E] listening on ${PORT}, scenario=${scenario} — no call will be placed`)
  );
