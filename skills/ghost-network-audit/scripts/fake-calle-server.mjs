#!/usr/bin/env node
// A local stand-in for the CALL-E API so the whole audit can be rehearsed with no
// credentials and no phone calls. It implements the two endpoints the auditor uses
// and returns a deterministic mix of outcomes derived from the recipient number, so
// the same sample directory always produces the same report.
//
// It is deliberately strict about the disclosure: a payload whose task text does not
// introduce itself as an automated call gets a 422, the same way a reviewer would
// reject it. A fake server that accepts anything only proves the client can send.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);

function seed(value) {
  return parseInt(createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16);
}

// Outcome mix roughly matching what published directory audits of behavioral-health
// networks tend to find: a large ghost share, a large unreachable share, and a
// minority of listings that a patient could actually use.
function scenarioFor(phone, providerNames) {
  const bucket = seed(phone) % 100;

  if (bucket < 10) {
    return {
      status: 'completed',
      result: {
        reached_office: 'no',
        providers: providerNames.map((name) => ({ name, practices_here: 'unknown' })),
        accepts_plan: 'unknown',
        accepting_new_patients: 'unknown',
        next_appointment_weeks: null,
        declined: false,
        notes: 'Rang out to voicemail; no message left.',
      },
    };
  }
  if (bucket < 15) {
    return {
      status: 'completed',
      result: {
        reached_office: 'yes',
        providers: providerNames.map((name) => ({ name, practices_here: 'unknown' })),
        accepts_plan: 'unknown',
        accepting_new_patients: 'unknown',
        next_appointment_weeks: null,
        declined: true,
        notes: 'Front desk asked to end the call.',
      },
    };
  }
  if (bucket < 24) {
    return {
      status: 'completed',
      result: {
        reached_office: 'yes',
        providers: providerNames.map((name) => ({ name, practices_here: 'unknown' })),
        accepts_plan: 'unknown',
        accepting_new_patients: 'unknown',
        next_appointment_weeks: null,
        declined: false,
        notes: 'Reached scheduling; they could not speak to plan participation.',
      },
    };
  }
  if (bucket < 48) {
    return {
      status: 'completed',
      result: {
        reached_office: 'yes',
        providers: providerNames.map((name) => ({ name, practices_here: 'no' })),
        accepts_plan: 'unknown',
        accepting_new_patients: 'unknown',
        next_appointment_weeks: null,
        declined: false,
        notes: 'Clinician no longer practices at this location.',
      },
    };
  }
  if (bucket < 60) {
    return {
      status: 'completed',
      result: {
        reached_office: 'yes',
        providers: providerNames.map((name) => ({ name, practices_here: 'yes' })),
        accepts_plan: 'no',
        accepting_new_patients: 'unknown',
        next_appointment_weeks: null,
        declined: false,
        notes: 'Office stopped accepting this plan.',
      },
    };
  }
  if (bucket < 78) {
    return {
      status: 'completed',
      result: {
        reached_office: 'yes',
        providers: providerNames.map((name) => ({ name, practices_here: 'yes' })),
        accepts_plan: 'yes',
        accepting_new_patients: 'no',
        next_appointment_weeks: null,
        declined: false,
        notes: 'Panel closed to new patients.',
      },
    };
  }
  return {
    status: 'completed',
    result: {
      reached_office: 'yes',
      providers: providerNames.map((name) => ({ name, practices_here: 'yes' })),
      accepts_plan: 'yes',
      accepting_new_patients: 'yes',
      next_appointment_weeks: 2 + (seed(`${phone}:wait`) % 22),
      declined: false,
      notes: 'Listing verified.',
    },
  };
}

function providerNamesFromTask(task) {
  return task
    .split('\n')
    .filter((line) => /^- .+,/.test(line))
    .map((line) => line.slice(2).split(',')[0].trim());
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function buildServer() {
  const calls = new Map();

  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/v1/calls') {
      let raw = '';
      for await (const chunk of req) raw += chunk;

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return json(res, 400, { error: { code: 'bad_request', message: 'Body was not JSON.' } });
      }

      const task = String(payload.task || '');
      const phone = payload.recipients?.[0]?.phones?.[0];

      if (!phone) {
        return json(res, 400, {
          error: { code: 'bad_request', message: 'A recipient phone number is required.' },
        });
      }
      if (!/automated call from \S/i.test(task)) {
        return json(res, 422, {
          error: {
            code: 'call_not_ready',
            message: 'Task text is missing the automated-call disclosure.',
            details: {
              questions: [
                'Who is this call from? The task must name the auditing organization in an automated-call disclosure before it asks anything.',
              ],
            },
          },
        });
      }
      if (!payload.result_schema) {
        return json(res, 422, {
          error: {
            code: 'call_not_ready',
            message: 'A result_schema is required so answers come back parsed rather than as prose.',
            details: { questions: ['What structured fields should this call return?'] },
          },
        });
      }

      const idempotencyKey = req.headers['idempotency-key'];
      // Replaying the same key returns the same call rather than placing a second one.
      // This is what makes a 5xx retry safe.
      if (idempotencyKey) {
        const existing = [...calls.values()].find((call) => call.idempotency_key === idempotencyKey);
        if (existing) return json(res, 200, { id: existing.id, status: existing.status });
      }

      const id = `call_${createHash('sha256').update(`${phone}:${idempotencyKey || raw}`).digest('hex').slice(0, 16)}`;
      const scenario = scenarioFor(phone, providerNamesFromTask(task));

      calls.set(id, {
        id,
        idempotency_key: idempotencyKey || null,
        status: scenario.status,
        result: scenario.result,
        correlation_id: payload.metadata?.correlation_id ?? null,
      });

      return json(res, 201, { id, status: 'queued' });
    }

    const match = url.pathname.match(/^\/v1\/calls\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const call = calls.get(decodeURIComponent(match[1]));
      if (!call) {
        return json(res, 404, { error: { code: 'not_found', message: 'No such call.' } });
      }
      return json(res, 200, call);
    }

    return json(res, 404, { error: { code: 'not_found', message: 'Unknown route.' } });
  });
}

export function startFakeServer(port = 0) {
  return new Promise((resolve) => {
    const instance = buildServer().listen(port, '127.0.0.1', () => {
      resolve({ server: instance, port: instance.address().port });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().listen(PORT, '127.0.0.1', () => {
    process.stdout.write(`fake CALL-E server listening on http://127.0.0.1:${PORT}\n`);
  });
}
