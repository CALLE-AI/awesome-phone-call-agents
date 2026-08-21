import {
  CallSnapshot,
  ContactRole,
  CoordinationResult,
  PourPlan,
  ROLE_LABELS,
  ROLES,
} from './domain';

function result(
  overrides: Partial<CoordinationResult> = {},
): CoordinationResult {
  return {
    contact_outcome: 'reached',
    commitment: 'confirmed',
    schedule_alignment: 'matched',
    scope_alignment: 'matched',
    reported_time: '06:30',
    blocker: '',
    evidence_summary: 'Explicitly confirmed the planned time and role-specific scope.',
    ...overrides,
  };
}

function completedCall(
  role: ContactRole,
  coordinationResult: CoordinationResult,
  evidence: string[],
): CallSnapshot {
  return {
    role,
    callId: 'demo-' + role,
    maskedPhone: 'DEMO LINE',
    status: 'completed',
    result: coordinationResult,
    taskCompleted: true,
    completionConfidence: { score: 0.96, label: 'high' },
    evidence,
    transcriptTurns: [
      {
        offsetSeconds: 4,
        speaker: 'bot',
        text:
          'I am an automated coordination assistant confirming readiness for the planned concrete pour.',
      },
      {
        offsetSeconds: 19,
        speaker: 'user',
        text: coordinationResult.evidence_summary,
      },
    ],
  };
}

export function queuedDemoCalls(): CallSnapshot[] {
  return ROLES.map((role) => ({
    role,
    callId: 'demo-' + role,
    maskedPhone: 'DEMO LINE',
    status: 'queued',
    result: null,
    taskCompleted: null,
    completionConfidence: null,
    evidence: [],
    transcriptTurns: [],
  }));
}

export function completedDemoCalls(plan: PourPlan): CallSnapshot[] {
  const plannedTime = plan.scheduledTime || '06:30';

  return [
    completedCall(
      'site_supervisor',
      result({
        reported_time: plannedTime,
        evidence_summary:
          'Site, access, crew, and placement area confirmed ready for ' + plannedTime + '.',
      }),
      ['Site supervisor explicitly confirmed readiness at ' + plannedTime + '.'],
    ),
    completedCall(
      'ready_mix_dispatch',
      result({
        reported_time: plannedTime,
        evidence_summary:
          'Dispatch confirmed ' +
          plan.volumeM3 +
          ' m³ of ' +
          plan.mixReference +
          ' for ' +
          plannedTime +
          '.',
      }),
      [
        'Ready-mix dispatch confirmed time, volume, and mix reference.',
        plan.volumeM3 + ' m³ · ' + plan.mixReference,
      ],
    ),
    completedCall(
      'pump_operator',
      result({
        commitment: 'conditional',
        schedule_alignment: 'conflict',
        reported_time: '08:00',
        blocker: 'Pump is committed to an earlier job and cannot arrive before 08:00.',
        evidence_summary:
          'Pump operator reported an 08:00 arrival, not the planned ' +
          plannedTime +
          ', due to an earlier job.',
      }),
      [
        'Pump operator explicitly reported 08:00 arrival.',
        'Planned time is ' + plannedTime + '; reported pump arrival is 08:00.',
      ],
    ),
    completedCall(
      'testing_coordinator',
      result({
        reported_time: plannedTime,
        evidence_summary:
          'Testing coordinator confirmed personnel and sampling equipment for ' +
          plannedTime +
          '.',
      }),
      ['Testing attendance and equipment explicitly confirmed.'],
    ),
  ];
}

export function previewQuestions(role: ContactRole): string[] {
  const common = 'Verify the correct ' + ROLE_LABELS[role].toLowerCase() + ' contact';
  const questions: Record<ContactRole, string[]> = {
    site_supervisor: [
      common,
      'Confirm site, access, crew, and placement readiness',
      'Report any delay blocker',
    ],
    ready_mix_dispatch: [
      common,
      'Confirm dispatch time, volume, and mix reference',
      'Report any supply or fleet blocker',
    ],
    pump_operator: [
      common,
      'Confirm pump arrival, setup, and placement method',
      'Report any access or equipment blocker',
    ],
    testing_coordinator: [
      common,
      'Confirm personnel and testing scope',
      'Report any staffing or equipment blocker',
    ],
  };
  return questions[role];
}
