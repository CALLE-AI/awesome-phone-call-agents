import { REQUIRED_DIALOGUE_FIELDS, restrictiveAuthority, validatePlaybookBinding, compileBoundCall } from './bound-call-runtime.mjs';

// Entirely synthetic policy example. No destination, customer dataset or live transport.
export const playbook = {
  playbook_id: 'DEMO_REVIEW', version: 1, active: true,
  name: 'Fictional veterinary follow-up', workflow_call_code: 'CUSTOMER_OUTREACH',
  objective: 'Ask whether the recipient wants staff to follow up. This is a test, not a real visit.',
  opening_guidance: 'Identify yourself as an AI calling in a test. Ask permission to continue. No real appointment or obligation exists.',
  tone: 'Friendly and concise',
  authority: restrictiveAuthority({ collect_preferences: true, record_outcome: true }),
  allowed_actions: ['Record interest or a request to stop.'],
  guardrails: ['Do not diagnose, give medical/legal/financial advice, handle emergencies, book visits, quote prices, or invent facts.'],
  stop_conditions: ['Stop on refusal, uncertainty, or clinical questions. Refer to qualified staff; emergencies require appropriate emergency services.'],
  allowed_outcomes: ['INTERESTED', 'NO_ANSWER'],
  outcome_state_transitions: { INTERESTED: 'FOLLOW_UP_REVIEW', NO_ANSWER: 'UNREACHED' }
};
export const notification = {
  playbook_id: playbook.playbook_id, playbook_version: 1,
  call_code: 'CUSTOMER_OUTREACH', service_code: 'TEST_UAT',
  appointment: { starts_at: '2030-01-15T15:00:00Z', timezone: 'America/New_York', technician_name: 'No real appointment' }
};
export const dialogue = Object.fromEntries(REQUIRED_DIALOGUE_FIELDS.map((field: string) => [field,
  'Use only supplied test context. Disclose this is a test; stop if declined. Do not promise a transaction or clinical advice.'
]));
export const states = [{ state: 'FOLLOW_UP_REVIEW' }, { state: 'UNREACHED' }];
export function preview() {
  const binding = validatePlaybookBinding({ notification, playbooks: [playbook], dialogueDefaults: dialogue });
  const compiled = compileBoundCall({ notification, ...binding,
    customer: { name: '<DEMO_CUSTOMER>', customer_id: '<MASKED>' }, businessName: 'Fictional Veterinary Clinic' });
  return { mode: 'NO_CALL', engine_enabled: false, playbook, timezone: notification.appointment.timezone,
    scheduled_at: notification.appointment.starts_at, ...compiled };
}
