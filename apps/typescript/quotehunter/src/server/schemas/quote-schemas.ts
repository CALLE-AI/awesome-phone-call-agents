import { ServiceCategory } from '../types.js';

export function getRecipientResultSchema(_category?: ServiceCategory) {
  return {
    type: 'object',
    required: ['quote_provided', 'price_estimate', 'price_numeric', 'availability', 'evidence'],
    properties: {
      quote_provided: {
        type: 'string',
        enum: ['yes', 'no', 'unknown'],
        description:
          'Whether the service provider provided a concrete or estimated price quote for the job. Use "no" if they declined, were busy, unreachable, or refused without giving any price. Use "unknown" if ambiguous.',
      },
      price_estimate: {
        type: 'string',
        description:
          'The exact final total price after adding work, labor, and materials (and applying any discounts). For example, if work is $300, labor is $300, and materials are $300, the total price is "$900". Always compute the correct arithmetic sum of all components. Never add calendar dates (like 28th of August) into the price. If no price was stated, return "not_provided".',
      },
      price_numeric: {
        type: 'number',
        description:
          'The exact final total numerical sum of all itemized quotes (e.g., 900 for $900 total). Compute: base_work + labor + materials - discounts. Use 0 if not provided or unknown.',
      },
      availability: {
        type: 'string',
        description:
          'When the provider stated they can start or complete the work (e.g., "tomorrow morning", "within 2-3 days", "August 28", "immediately"). Return "not_discussed" if not mentioned.',
      },
      additional_conditions: {
        type: 'string',
        description:
          'Any extra terms, material charges, travel fees, warranty, discounts, or minimum charges mentioned by the vendor. Return "none_mentioned" if standard.',
      },
      provider_notes: {
        type: 'string',
        description:
          'Brief notable context and itemized price breakdown (e.g., "$300 work + $300 labor + $300 materials ($100 discount applied) = $900 total, 2-year warranty").',
      },
      evidence: {
        type: 'string',
        description:
          'Direct verbatim spoken quotes in quotation marks supporting the price, breakdown, and availability.',
      },
    },
    additionalProperties: false,
  };
}

export function getJobOverallResultSchema() {
  return {
    type: 'object',
    required: ['total_providers_called', 'quotes_received'],
    properties: {
      total_providers_called: {
        type: 'integer',
        description: 'Total count of vendors called.',
      },
      quotes_received: {
        type: 'integer',
        description: 'Count of vendors who successfully gave a price quote.',
      },
      best_value_vendor_summary: {
        type: 'string',
        description: 'Short summary of the vendor offering the best deal or lowest quote.',
      },
    },
    additionalProperties: false,
  };
}
