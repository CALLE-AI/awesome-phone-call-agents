export const CLAIM_STATUS_RESULT_SCHEMA = {
  type: 'object',
  required: [
    'reached_target', 'target_name_used', 'menu_levels', 'claim_reference',
    'claim_status', 'department_evidence', 'question_evidence',
    'answer_evidence', 'final_answer',
  ],
  properties: {
    reached_target: { type: 'string', enum: ['yes', 'no', 'unclear'] },
    target_name_used: { type: 'string' },
    menu_levels: {
      type: 'array',
      items: {
        type: 'object',
        required: ['level', 'prompt_heard', 'action_type'],
        properties: {
          level: { type: 'integer' },
          prompt_heard: { type: 'string' },
          options_offered: { type: 'array', items: { type: 'string' } },
          action_type: { type: 'string', enum: ['dtmf', 'speech', 'wait', 'none'] },
          action_value: { type: 'string' },
        },
      },
    },
    route_matched_expectation: { type: 'string', enum: ['yes', 'no', 'not_applicable'] },
    claim_reference: { type: 'string' },
    claim_status: {
      type: 'string',
      enum: ['paid', 'pending', 'denied', 'rejected', 'needs_information', 'not_found', 'unknown'],
    },
    paid_amount: { type: 'string' },
    payment_date: { type: 'string' },
    denial_code: { type: 'string' },
    next_action: { type: 'string' },
    department_evidence: { type: 'string', description: 'Exact payer words establishing the department.' },
    question_evidence: { type: 'string', description: 'Exact caller words containing the claim-specific question.' },
    answer_evidence: { type: 'string', description: 'Exact payer words supporting the outcome.' },
    final_answer: { type: 'string' },
  },
} as const;
