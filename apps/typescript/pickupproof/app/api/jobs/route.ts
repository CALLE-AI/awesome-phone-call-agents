import { bindings, get, insert, list, save } from '@/lib/store';
import {
  approve,
  canRun,
  confirm,
  providerResult,
  type Job,
} from '@/lib/domain';
const live = () =>
  Boolean(
    bindings.CALLE_API_KEY &&
    bindings.OPERATOR_TOKEN &&
    bindings.LIVE_CALLS_ENABLED === 'true',
  );
const schema = {
  type: 'object',
  required: ['outcome', 'window', 'evidence'],
  properties: {
    outcome: {
      type: 'string',
      enum: [
        'confirmed_window',
        'callback_requested',
        'declined',
        'no_answer',
        'wrong_number',
        'ambiguous',
      ],
    },
    window: {
      type: 'string',
      description: 'Unambiguous proposed date and time, or empty',
    },
    evidence: { type: 'string', description: 'Exact customer quote or empty' },
  },
};
function auth(req: Request) {
  return (
    !!bindings.OPERATOR_TOKEN &&
    req.headers.get('authorization') === `Bearer ${bindings.OPERATOR_TOKEN}`
  );
}
async function response(req: Request, id?: string) {
  return Response.json({
    jobs: (await list()).filter((j) => j.mode === 'practice' || auth(req)),
    id,
    live: live(),
  });
}
export async function GET(req: Request) {
  try {
    return await response(req);
  } catch {
    return Response.json(
      { error: 'Database unavailable. Apply the included migrations.' },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  try {
    if (
      req.headers.get('origin') &&
      req.headers.get('origin') !== new URL(req.url).origin
    )
      return Response.json({ error: 'Origin rejected' }, { status: 403 });
    const raw = await req.text();
    if (raw.length > 12000) throw Error('Request too large.');
    const b = JSON.parse(raw),
      action = b.action;
    if (action === 'refresh') return response(req);
    if (action === 'create') {
      if (
        typeof b.name !== 'string' ||
        !b.name.trim() ||
        b.name.length > 100 ||
        typeof b.purpose !== 'string' ||
        !b.purpose.trim() ||
        b.purpose.length > 1500
      )
        throw Error('Enter a customer and allowed request.');
      const mode = b.mode === 'live' ? 'live' : 'practice';
      if (mode === 'live' && (!live() || !auth(req)))
        return Response.json(
          { error: 'Live calls require service and operator credentials.' },
          { status: 403 },
        );
      if (mode === 'live' && !/^\+[1-9]\d{7,14}$/.test(b.phone))
        throw Error('Use an international phone number.');
      const now = new Date();
      const job: Job = {
        id: crypto.randomUUID(),
        name: b.name.trim(),
        phone: mode === 'live' ? b.phone : '',
        purpose: b.purpose.trim(),
        mode,
        state: 'awaiting_approval',
        created: now.toISOString(),
        expires: new Date(+now + 1800000).toISOString(),
        audit: [{ at: now.toISOString(), action: 'case_created' }],
      };
      await insert(job);
      return response(req, job.id);
    }
    if (typeof b.id !== 'string') throw Error('Select a case.');
    let { job, version } = await get(b.id);
    if (job.mode === 'live' && !auth(req))
      return Response.json(
        { error: 'Operator authentication required.' },
        { status: 403 },
      );
    const audit = (action: string) =>
      job.audit.push({ at: new Date().toISOString(), action });
    if (action === 'approve') job = approve(job);
    else if (action === 'cancel') {
      if (!['awaiting_approval', 'approved'].includes(job.state))
        throw Error('A started call cannot be cancelled here.');
      job.state = 'cancelled';
    } else if (action === 'confirm') job = confirm(job);
    else if (action === 'run') {
      canRun(job);
      if (job.mode === 'live' && !live())
        throw Error('Live calls are disabled.');
      job.state = 'running';
      audit('execution_reserved');
      await save(job, version);
      version++;
      if (job.mode === 'practice') {
        job.runId = `synthetic-${job.id}`;
        job.result = {
          outcome: 'confirmed_window',
          window: 'Tomorrow, 3–4 pm (synthetic scenario)',
          evidence:
            'SYNTHETIC CUSTOMER: Yes, tomorrow between three and four works for me.',
        };
        job.state = 'needs_review';
      } else {
        try {
          const r = await fetch('https://api.heycall-e.com/v1/calls', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${bindings.CALLE_API_KEY}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': `pickupproof-${job.id}`,
            },
            body: JSON.stringify({
              task: `Identify yourself as an AI assistant for the pickup operator. Ask only this approved question: ${job.purpose}\nDo not book, charge, request private information, or contact another person. Respect refusal.`,
              recipients: [{ phones: [job.phone] }],
              result_schema: schema,
              recipient_result_schema: schema,
              metadata: { workflow_run_id: job.id },
            }),
            signal: AbortSignal.timeout(20000),
          });
          if (!r.ok) throw Error('Provider rejected request');
          const d = (await r.json()) as { id?: string; call_id?: string };
          job.runId = d.call_id || d.id;
          if (!job.runId) throw Error('Missing provider ID');
        } catch {
          job.state = 'status_unresolved';
          audit('provider_response_uncertain_no_redial');
        }
      }
    } else if (action === 'poll') {
      if (!['running', 'status_unresolved'].includes(job.state))
        throw Error('Only pending calls may be polled.');
      if (job.mode !== 'live' || !job.runId)
        throw Error(
          'No provider ID. Reconcile in the CALL-E dashboard; do not redial.',
        );
      const r = await fetch(
        `https://api.heycall-e.com/v1/calls/${encodeURIComponent(job.runId)}`,
        {
          headers: { Authorization: `Bearer ${bindings.CALLE_API_KEY}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok) throw Error('Status unavailable; existing call retained.');
      const result = providerResult(await r.json(), job.phone);
      if (result) {
        job.result = result;
        job.state = 'needs_review';
      }
    } else throw Error('Unknown action.');
    audit(action);
    await save(job, version);
    return response(req, job.id);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Request failed.' },
      { status: 400 },
    );
  }
}
