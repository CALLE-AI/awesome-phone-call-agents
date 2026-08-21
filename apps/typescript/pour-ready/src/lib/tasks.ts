import {
  ContactInput,
  ContactRole,
  PourPlan,
  REGION_CONFIG,
  ROLE_LABELS,
} from './domain';

export const COORDINATION_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contact_outcome',
    'commitment',
    'schedule_alignment',
    'scope_alignment',
    'reported_time',
    'blocker',
    'evidence_summary',
  ],
  properties: {
    contact_outcome: {
      type: 'string',
      enum: ['reached', 'voicemail', 'wrong_contact', 'no_answer', 'unknown'],
      description: 'Whether the intended role contact was reached.',
    },
    commitment: {
      type: 'string',
      enum: ['confirmed', 'conditional', 'declined', 'unknown'],
      description: 'The contact commitment, using unknown if it was not explicit.',
    },
    schedule_alignment: {
      type: 'string',
      enum: ['matched', 'conflict', 'unknown'],
      description: 'Whether the time reported by the contact matches the planned time.',
    },
    scope_alignment: {
      type: 'string',
      enum: ['matched', 'conflict', 'not_applicable', 'unknown'],
      description: 'Whether the role-specific scope matches the plan.',
    },
    reported_time: {
      type: 'string',
      description: 'The time stated by the contact, or an empty string if none was stated.',
    },
    blocker: {
      type: 'string',
      description: 'A concise blocker stated by the contact, or an empty string.',
    },
    evidence_summary: {
      type: 'string',
      description: 'A short factual summary of what the contact explicitly said.',
    },
  },
} as const;

const ROLE_CHECKPOINTS: Record<ContactRole, string[]> = {
  site_supervisor: [
    'Confirm the site will be ready to receive concrete at the planned time.',
    'Confirm access, crew, and placement area readiness.',
    'Ask for any blocker that could delay the pour.',
  ],
  ready_mix_dispatch: [
    'Confirm the dispatch time and planned arrival time.',
    'Confirm the volume and mix reference exactly as stated in the plan.',
    'Ask for any supply or fleet blocker.',
  ],
  pump_operator: [
    'Confirm pump arrival and setup readiness at the planned time.',
    'Confirm the placement method is compatible with the planned pour.',
    'Ask for any access, setup, or equipment blocker.',
  ],
  testing_coordinator: [
    'Confirm testing personnel will be present at the planned time.',
    'Confirm the testing scope for the pour is understood.',
    'Ask for any staffing or equipment blocker.',
  ],
};

export function buildCallTask(plan: PourPlan, contact: ContactInput): string {
  const region = REGION_CONFIG[plan.region];
  const checkpoints = ROLE_CHECKPOINTS[contact.role]
    .map((checkpoint, index) => String(index + 1) + '. ' + checkpoint)
    .join('\n');

  return [
    'You are CALL-E, an automated pre-pour coordination assistant for PourReady.',
    'Immediately disclose that you are an automated assistant calling to confirm reported facts for a concrete pour.',
    'Verify that you reached ' + contact.name + ', the ' + ROLE_LABELS[contact.role] + '.',
    'If this is the wrong person, apologize, do not request another phone number, and end the call.',
    '',
    'Project plan:',
    '- Project: ' + plan.projectName,
    '- Location: ' + plan.location,
    '- Pour date: ' + plan.scheduledDate,
    '- Planned local time: ' + plan.scheduledTime + ' (' + region.timezone + ')',
    '- Volume: ' + plan.volumeM3 + ' m³',
    '- Mix reference: ' + plan.mixReference,
    '',
    'Ask only these bounded coordination questions:',
    checkpoints,
    '',
    'Safety and authority boundaries:',
    '- Do not change an order, cancel work, approve safety, approve engineering, or make financial commitments.',
    '- Do not tell anyone to proceed or hold. A human supervisor makes that decision.',
    '- Record only explicit answers. Use unknown when the answer is unclear or missing.',
    '- Keep the call concise and professional. End after summarizing the reported facts.',
  ].join('\n');
}
