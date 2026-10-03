export type Scenario = 'accepted' | 'declined' | 'unclear' | 'unanswered';
export type Phase = 'queued' | 'calling' | 'review' | 'booked' | 'closed' | 'error' | 'uncertain';
export type Mode = 'demo' | 'live';
export interface Slot {
  id: string; startsAt: string; duration: number; clinician: string; kind: string;
  status: 'open' | 'booked'; bookedFor?: string;
}
export interface Candidate {
  id: string; name: string; initials: string; color: string; preference: string;
  language: string; consent: boolean; waitingDays: number;
}
export interface Call {
  id: string; slotId: string; candidateId: string; mode: Mode; scenario: Scenario;
  phase: Phase; createdAt: string; updatedAt: string; providerId?: string;
  canAttend: 'yes' | 'no' | 'unknown'; taskCompleted: boolean; confidence: number | null;
  summary: string; evidence: string[]; transcript: {speaker: string; text: string}[];
  decision?: string;
}
export interface AuditEvent { id: string; at: string; text: string; mode: Mode }
export interface Workspace { version: 1; slots: Slot[]; candidates: Candidate[]; calls: Call[]; audit: AuditEvent[] }
export interface Settings { liveReady: boolean; liveEnabled: boolean; hasApiKey: boolean; hasTestPhone: boolean; testPhoneHint: string; testPhone: string }
export interface View extends Workspace { settings: Settings }
export class WorkflowError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function newWorkspace(now = new Date()): Workspace {
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = tomorrow.toISOString().slice(0, 10);
  return {
    version: 1,
    slots: [
      { id: 'slot-1', startsAt: `${day}T10:30:00+05:30`, duration: 30, clinician: 'Dr. Mira Shah', kind: 'General consultation', status: 'open' },
      { id: 'slot-2', startsAt: `${day}T14:00:00+05:30`, duration: 30, clinician: 'Dr. Arjun Rao', kind: 'Follow-up visit', status: 'open' },
      { id: 'slot-3', startsAt: `${day}T16:15:00+05:30`, duration: 45, clinician: 'Dr. Mira Shah', kind: 'General consultation', status: 'open' },
    ],
    candidates: [
      {id: 'person-1', name: 'Aanya Patel', initials: 'AP', color: 'mint', preference: 'Morning preferred', language: 'English', consent: true, waitingDays: 5},
      {id: 'person-2', name: 'Rohan Mehta', initials: 'RM', color: 'lavender', preference: 'Flexible availability', language: 'English', consent: true, waitingDays: 3},
      {id: 'person-3', name: 'Sara Thomas', initials: 'ST', color: 'peach', preference: 'Afternoon preferred', language: 'English', consent: true, waitingDays: 2},
      {id: 'person-4', name: 'Dev Kumar', initials: 'DK', color: 'blue', preference: 'Flexible availability', language: 'English', consent: false, waitingDays: 1},
    ], calls: [], audit: [],
  };
}
export function slotTime(slot: Slot) { return new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit'}).format(new Date(slot.startsAt)); }
export function slotDate(slot: Slot) { return new Intl.DateTimeFormat('en-IN', {timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short'}).format(new Date(slot.startsAt)); }
export function audit(state: Workspace, text: string, mode: Mode, now = new Date()) {
  state.audit.unshift({id: crypto.randomUUID(), at: now.toISOString(), text, mode});
  state.audit = state.audit.slice(0, 100);
}
export function isActive(call: Call) { return ['queued', 'calling', 'uncertain'].includes(call.phase); }
export function reconcileInterruptedCalls(state: Workspace, now = new Date()): boolean {
  let changed = false;
  for (const call of state.calls) {
    if (call.mode === 'live' && call.phase === 'queued' && !call.providerId && now.getTime() - new Date(call.createdAt).getTime() > 30000) {
      call.phase = 'uncertain';
      call.summary = 'This app stopped receiving confirmation while the call was starting. Check the CALL-E dashboard. Another call will not be placed automatically.';
      changed = true;
    }
  }
  return changed;
}
export function canConfirm(call: Call) {
  return call.phase === 'review' && call.taskCompleted && call.canAttend === 'yes' && call.confidence !== null && call.confidence >= 0.8;
}
export interface CreateInput { requestId: string; slotId: string; candidateId: string; mode: Mode; scenario: Scenario; consent: boolean; approved: boolean }
export function createCall(state: Workspace, input: CreateInput, now = new Date()): Call {
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId)) throw new WorkflowError('Invalid request reference. Refresh and try again.');
  if (!['demo', 'live'].includes(input.mode) || !['accepted','declined','unclear','unanswered'].includes(input.scenario)) throw new WorkflowError('Choose a valid call mode and demo outcome.');
  const previous = state.calls.find(c => c.id === input.requestId);
  if (previous) {
    if (previous.slotId !== input.slotId || previous.candidateId !== input.candidateId || previous.mode !== input.mode || previous.scenario !== input.scenario) throw new WorkflowError('This request reference has already been used.', 409);
    return previous;
  }
  const slot = state.slots.find(s => s.id === input.slotId);
  const person = state.candidates.find(p => p.id === input.candidateId);
  if (!slot || !person) throw new WorkflowError('Select an appointment and a waitlist person.');
  if (slot.status !== 'open') throw new WorkflowError('This appointment is already booked.', 409);
  if (new Date(slot.startsAt).getTime() <= now.getTime()) throw new WorkflowError('This appointment has already passed. Reset the demo for new dates.', 409);
  if (!person.consent || input.consent !== true || input.approved !== true) throw new WorkflowError('Contact consent and staff approval are required.');
  if (state.slots.some(s => s.bookedFor === person.id)) throw new WorkflowError('This person already has a confirmed appointment.', 409);
  if (state.calls.some(c => (c.slotId === slot.id || c.candidateId === person.id) && (isActive(c) || c.phase === 'review'))) throw new WorkflowError('Review the existing call before starting another for this slot or person.', 409);
  const call: Call = {id: input.requestId, slotId: slot.id, candidateId: person.id, mode: input.mode, scenario: input.scenario, phase: 'queued', createdAt: now.toISOString(), updatedAt: now.toISOString(), canAttend: 'unknown', taskCompleted: false, confidence: null, summary: '', evidence: [], transcript: []};
  state.calls.unshift(call);
  audit(state, `Staff approved a ${input.mode === 'demo' ? 'simulated' : 'live test'} call for ${slotTime(slot)}.`, input.mode, now);
  return call;
}
export function advanceDemo(state: Workspace, now = new Date()): boolean {
  let changed = false;
  for (const call of state.calls) {
    if (call.mode !== 'demo' || !['queued', 'calling'].includes(call.phase)) continue;
    const elapsed = now.getTime() - new Date(call.createdAt).getTime();
    if (elapsed > 900 && call.phase === 'queued') { call.phase = 'calling'; changed = true; }
    if (elapsed < 4800) continue;
    const slot = state.slots.find(s => s.id === call.slotId)!;
    const response = {accepted: `Yes, ${slotTime(slot)} works for me. Please reserve it.`, declined: 'Thank you, but I cannot make that time.', unclear: 'Maybe. I need to check and call you back.', unanswered: ''}[call.scenario];
    call.phase = 'review'; call.taskCompleted = call.scenario !== 'unanswered';
    call.canAttend = call.scenario === 'accepted' ? 'yes' : call.scenario === 'declined' ? 'no' : 'unknown';
    call.confidence = call.scenario === 'unclear' ? 0.45 : call.scenario === 'unanswered' ? null : 0.96;
    call.summary = {accepted: 'The person accepted the offered time. Staff confirmation is still required.', declined: 'The person declined this appointment time. The slot remains available.', unclear: 'Availability was not confirmed. Follow up manually before offering a booking.', unanswered: 'No answer was received. The appointment remains available.'}[call.scenario];
    call.evidence = response ? [response] : ['The simulated call was not answered.'];
    call.transcript = response ? [
      {speaker: 'Assistant', text: `Hello, this is an AI assistant from the fictional Clearview Clinic. Is now a good time to discuss an earlier appointment?`},
      {speaker: 'Volunteer', text: 'Yes, go ahead.'},
      {speaker: 'Assistant', text: `An appointment is available on ${slotDate(slot)} at ${slotTime(slot)}, India time. Would you like our staff to reserve it?`},
      {speaker: 'Volunteer', text: response},
      {speaker: 'Assistant', text: call.scenario === 'accepted' ? 'Thank you. Our staff will review your response and confirm the appointment.' : 'Thank you. I will pass your response to the clinic staff.'},
    ] : [];
    call.updatedAt = now.toISOString();
    audit(state, 'Simulated call finished. Response is ready for staff review.', 'demo', now);
    changed = true;
  }
  return changed;
}
export function decide(state: Workspace, callId: string, decision: 'confirm' | 'close', now = new Date()) {
  const call = state.calls.find(c => c.id === callId);
  if (!call) throw new WorkflowError('Call not found.', 404);
  if (call.phase === 'booked' && decision === 'confirm') return;
  if (call.phase === 'closed' && decision === 'close') return;
  if (call.phase !== 'review') throw new WorkflowError('A completed, reviewed result is required.', 409);
  const slot = state.slots.find(s => s.id === call.slotId)!;
  const person = state.candidates.find(p => p.id === call.candidateId)!;
  if (decision === 'confirm') {
    if (!canConfirm(call)) throw new WorkflowError('The result does not clearly confirm availability. Follow up manually.', 409);
    if (slot.status !== 'open' || state.slots.some(s => s.bookedFor === person.id)) throw new WorkflowError('This appointment or person is already booked.', 409);
    slot.status = 'booked'; slot.bookedFor = person.id; call.phase = 'booked';
    call.decision = call.mode === 'demo' ? 'Staff confirmed a demo booking.' : 'Staff confirmed a fictional test booking; no clinic system was changed.';
    audit(state, `${call.mode === 'demo' ? 'Demo booking' : 'Test booking'} confirmed by staff for ${slotTime(slot)}.`, call.mode, now);
  } else {
    call.phase = 'closed'; call.decision = call.canAttend === 'unknown' ? 'Closed for manual follow-up. No booking made.' : 'Staff kept the slot open.';
    audit(state, call.decision, call.mode, now);
  }
  call.updatedAt = now.toISOString();
}
