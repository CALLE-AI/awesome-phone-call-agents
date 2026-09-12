import { NextRequest, NextResponse } from 'next/server';
import { load, save } from '../../../lib/store';
import { advanceDemo, audit, createCall, decide, isActive, newWorkspace, reconcileInterruptedCalls, WorkflowError, type CreateInput, type Workspace } from '../../../lib/model';
import { sameOrigin } from '../../../lib/request-guard';
import { applyProviderResult, getProviderCall, settings, startProviderCall } from '../../../lib/calle';
import { publicDemoEnabled } from '../../../lib/public-demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const cookie = 'clinic-slot-session';
function session(req: NextRequest) { const value = req.cookies.get(cookie)?.value; return value && /^[a-f0-9-]{36}$/i.test(value) ? value : crypto.randomUUID(); }
function response(state: Workspace, id: string, req: NextRequest) {
  const res = NextResponse.json({...state, settings: settings()}, {headers: {'Cache-Control': 'no-store'}});
  res.cookies.set(cookie, id, {httpOnly: true, sameSite: 'strict', secure: req.nextUrl.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 14});
  return res;
}
function failure(error: unknown) { return NextResponse.json({error: error instanceof WorkflowError ? error.message : 'Unable to update the workspace. Your saved state has been retained.'}, {status: error instanceof WorkflowError ? error.status : 500}); }
export async function GET(req: NextRequest) {
  try {
    if (publicDemoEnabled()) throw new WorkflowError('The public demo saves fictional activity in your browser. Server workspace access is disabled.', 403);
    const id = session(req); const state = load(id);
    const advanced = advanceDemo(state);
    if (reconcileInterruptedCalls(state) || advanced) save(id, state);
    return response(state, id, req);
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    if (publicDemoEnabled()) throw new WorkflowError('Server actions and real calls are disabled in the public demo.', 403);
    if (!sameOrigin(req.headers.get('origin'), req.headers.get('host'))) throw new WorkflowError('This request must come from the application.', 403);
    if (!req.cookies.get(cookie)) throw new WorkflowError('Reload the workspace before continuing.', 409);
    const text = await req.text();
    if (text.length > 8192) throw new WorkflowError('Request is too large.', 413);
    let body;
    try { body = JSON.parse(text); } catch { throw new WorkflowError('Invalid request.'); }
    if (!body || typeof body !== 'object') throw new WorkflowError('Invalid request.');
    const id = session(req); let state = load(id); advanceDemo(state);
    if (body.action === 'create') {
      const input = body as CreateInput;
      if (input.mode === 'live') {
        if (!['localhost', '127.0.0.1', '[::1]'].includes(req.nextUrl.hostname)) throw new WorkflowError('Live tests are available only on the local preview.', 403);
        if (!settings().liveReady) throw new WorkflowError('CALL-E live testing is not connected. Demo mode is ready to use.', 503);
        if (state.calls.some(c => c.mode === 'live' && isActive(c) && c.id !== input.requestId)) throw new WorkflowError('Wait for the current live test to finish.', 409);
      }
      const existing = state.calls.some(c => c.id === input.requestId);
      const call = createCall(state, input);
      save(id, state); // Persist the idempotency key before any external side effect.
      if (!existing && call.mode === 'live') {
        try {
          const result = await startProviderCall(call, state.slots.find(s => s.id === call.slotId)!);
          state = load(id);
          applyProviderResult(state.calls.find(c => c.id === call.id)!, result);
          save(id, state);
        } catch {
          state = load(id); const pending = state.calls.find(c => c.id === call.id)!;
          pending.phase = 'uncertain';
          pending.summary = 'CALL-E has not confirmed whether this request started. Check the CALL-E dashboard before taking further action. This app will not redial automatically.';
          audit(state, 'Call creation could not be confirmed. Slot locked to prevent another call.', 'live');
          save(id, state);
        }
      }
    } else if (body.action === 'poll') {
      const call = state.calls.find(c => c.id === body.callId);
      if (!call) throw new WorkflowError('Call not found.', 404);
      if (call.mode === 'live' && call.providerId && isActive(call) && Date.now() - new Date(call.updatedAt).getTime() >= 7000) {
        call.updatedAt = new Date().toISOString(); save(id, state);
        try {
          const result = await getProviderCall(call.providerId);
          state = load(id); const current = state.calls.find(c => c.id === call.id)!;
          if (isActive(current)) { applyProviderResult(current, result); if (current.phase === 'review') audit(state, 'CALL-E returned a result for staff review.', 'live'); }
        } catch { throw new WorkflowError('The status check failed. The saved call will be checked again; no new call was placed.', 502); }
      }
      save(id, state);
    } else if (body.action === 'decide') {
      if (!['confirm','close'].includes(body.decision)) throw new WorkflowError('Choose a valid review action.');
      decide(state, body.callId, body.decision); save(id, state);
    } else if (body.action === 'reset') {
      if (state.calls.some(c => c.mode === 'live')) throw new WorkflowError('Live test history is retained. Demo reset is only available before live testing.', 409);
      state = newWorkspace(); save(id, state);
    } else throw new WorkflowError('Unknown action.');
    return response(state, id, req);
  } catch (error) { return failure(error); }
}
