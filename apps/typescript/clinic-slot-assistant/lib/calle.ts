import { CalleClient, type Call as ProviderCall } from '@call-e/calle';
import { type Call, type Settings, type Slot, WorkflowError, slotDate, slotTime } from './model';
import { demoSettings, publicDemoEnabled } from './public-demo';

export function settings(): Settings {
  if (publicDemoEnabled()) return demoSettings();
  const phone = process.env.CALLE_TEST_PHONE?.trim() ?? '';
  const hasApiKey = Boolean(process.env.CALLE_API_KEY?.trim());
  const hasTestPhone = /^\+91[6-9]\d{9}$/.test(phone);
  const liveEnabled = process.env.CALLE_LIVE_ENABLED === 'true';
  return {liveReady: hasApiKey && hasTestPhone && liveEnabled, liveEnabled, hasApiKey, hasTestPhone, testPhoneHint: hasTestPhone ? `+91 •••••• ${phone.slice(-4)}` : '', testPhone: ''};
}
function client() {
  if (publicDemoEnabled()) throw new WorkflowError('CALL-E requests are disabled in the public demo.', 403);
  if (!process.env.CALLE_API_KEY?.trim()) throw new WorkflowError('CALL-E is not connected.', 503);
  return new CalleClient({
    apiKey: process.env.CALLE_API_KEY.trim(),
    fetch: request => fetch(request, {signal: AbortSignal.timeout(20000)}),
  });
}
export function callTask(slot: Slot) {
  return `Make one English-language call to the explicitly supplied test volunteer only. This is an authorized hackathon demonstration of a fictional clinic called Clearview Clinic. At the start, identify yourself as an AI assistant and explain that this is a test, not an actual medical appointment. Ask if now is a good time. Offer a fictional ${slot.duration}-minute appointment on ${slotDate(slot)}, ${new Date(slot.startsAt).getFullYear()}, at ${slotTime(slot)} in Asia/Kolkata (India Standard Time, UTC+05:30). Ask whether the volunteer can attend that exact time. Report yes only for an explicit, unambiguous acceptance; no for a refusal; unknown for anything uncertain, no answer, or voicemail. Do not collect medical details, give medical advice, claim a booking has been made, call anyone else, or leave appointment details on voicemail. Do not schedule retries. End politely if the recipient declines the conversation. Tell an accepting volunteer that staff must review the result before confirming the fictional booking.`;
}
export async function startProviderCall(call: Call, slot: Slot): Promise<ProviderCall> {
  if (!settings().liveReady) throw new WorkflowError('Live testing is not configured. Use demo mode or connect CALL-E first.', 503);
  const schema = {type: 'object', required: ['can_attend'], properties: {can_attend: {type: 'string', enum: ['yes','no','unknown']}}};
  return client().calls.create({
    task: callTask(slot),
    recipient: {phones: [process.env.CALLE_TEST_PHONE!.trim()], region: 'IN', locale: 'en-IN'},
    resultSchema: schema,
    recipientResultSchema: schema,
    metadata: {application: 'clinic-slot-assistant', workflow_id: call.id, purpose: 'fictional-hackathon-test'},
  }, {idempotencyKey: `clinic-slot:${call.id}`});
}
export function getProviderCall(id: string) { return client().calls.get(id); }
export function applyProviderResult(call: Call, result: ProviderCall) {
  call.providerId = result.id;
  call.updatedAt = new Date().toISOString();
  if (result.status === 'queued' || result.status === 'in_progress') {
    // CALL-E's task status can remain queued after an individual attempt starts.
    const recipientActive = result.recipients.some(r => r.status === 'in_progress' || r.attempts.some(a => a.status === 'dialing' || a.status === 'in_progress'));
    call.phase = result.status === 'in_progress' || recipientActive ? 'calling' : 'queued'; return;
  }
  call.phase = 'review';
  const value = result.recipients[0]?.structuredResult?.can_attend ?? result.structuredResult?.can_attend;
  call.canAttend = value === 'yes' || value === 'no' ? value : 'unknown';
  call.taskCompleted = result.status === 'completed' && result.taskCompleted === true;
  call.confidence = typeof result.completionConfidence?.score === 'number' && result.completionConfidence.score >= 0 && result.completionConfidence.score <= 1 ? result.completionConfidence.score : null;
  const redact = (s: string) => s.replace(/\+?\d[\d ()-]{8,}\d/g, '[phone hidden]').slice(0, 3000);
  call.summary = redact(result.summary || 'No clear availability result was returned. Review and follow up manually.');
  call.evidence = (result.evidence ?? []).slice(0, 10).map(redact);
  call.transcript = result.recipients.flatMap(r => r.attempts.flatMap(a => a.transcriptTurns)).slice(0, 100).map(t => ({speaker: t.speaker === 'bot' ? 'Assistant' : t.speaker === 'user' ? 'Volunteer' : 'Unknown', text: redact(t.text)}));
}
