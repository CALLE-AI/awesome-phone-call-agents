export const taskResultSchema = {
  type: 'object' as const,
  required: ['outcome_summary'],
  properties: {
    outcome_summary: { type: 'string' as const },
  },
};

export const recipientResultSchema = {
  type: 'object' as const,
  required: ['available', 'quoted_rate', 'pickup_confirmed', 'evidence'],
  properties: {
    available: {
      type: 'string' as const,
      enum: ['yes', 'no', 'unknown'] as const,
    },
    quoted_rate: { type: 'number' as const },
    pickup_confirmed: {
      type: 'string' as const,
      enum: ['yes', 'no', 'unknown'] as const,
    },
    evidence: {
      type: 'string' as const,
      description: 'Direct quote or close paraphrase from the call supporting the rate and availability given.',
    },
  },
  additionalProperties: false,
};
