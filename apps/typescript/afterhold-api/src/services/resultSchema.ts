import { CANONICAL_RESULT_SCHEMA, type MissionArchetype } from '../lib/types.js';

/**
 * Build the per-archetype resultSchema. Always wraps the canonical envelope
 * and adds typed `facts` properties that match what we expect from each call.
 */
export function buildResultSchema(archetype: MissionArchetype) {
  const baseFacts: Record<string, any> = {};
  switch (archetype) {
    case 'courier':
      Object.assign(baseFacts, {
        tracking_number: { type: 'string' },
        status: { type: 'string', enum: ['Out for delivery', 'Delayed', 'Delivered', 'Not shipped', 'Unknown'] },
        expected_time: { type: 'string' },
        rider_contact: { type: 'string' },
      });
      break;
    case 'clinic':
      Object.assign(baseFacts, {
        appointment_time: { type: 'string' },
        doctor_name: { type: 'string' },
        prep_instructions: { type: 'string' },
        insurance_required: { type: 'boolean' },
      });
      break;
    case 'restaurant':
      Object.assign(baseFacts, {
        reservation_time: { type: 'string' },
        party_size: { type: 'integer' },
        wait_minutes: { type: 'integer' },
        dietary_accommodations: { type: 'string' },
      });
      break;
    case 'utility':
      Object.assign(baseFacts, {
        account_number: { type: 'string' },
        service_type: { type: 'string' },
        reference_number: { type: 'string' },
        next_action_by_user: { type: 'string' },
      });
      break;
    case 'general':
    default:
      Object.assign(baseFacts, {
        key_facts: { type: 'object' },
      });
  }

  return {
    ...CANONICAL_RESULT_SCHEMA,
    properties: {
      ...CANONICAL_RESULT_SCHEMA.properties,
      facts: {
        type: 'object',
        properties: baseFacts,
        additionalProperties: true,
      },
    },
  };
}

/** Human-readable hint of the fact fields, used when generating the task string. */
export function factsHint(archetype: MissionArchetype): string {
  switch (archetype) {
    case 'courier':
      return 'tracking_number, status, expected_time, rider_contact';
    case 'clinic':
      return 'appointment_time, doctor_name, prep_instructions, insurance_required';
    case 'restaurant':
      return 'reservation_time, party_size, wait_minutes, dietary_accommodations';
    case 'utility':
      return 'account_number, service_type, reference_number, next_action_by_user';
    case 'general':
    default:
      return 'key_facts (object)';
  }
}
