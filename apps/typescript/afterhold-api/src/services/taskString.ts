import { REFUSAL_BLOCK } from '../lib/types.js';
import type { MissionArchetype } from '../lib/types.js';

export interface RenderTaskInput {
  e164: string;
  goal: string;
  language: string;
  archetype: MissionArchetype;
  userName: string;
  displayName: string;
  extractSchemaFactsHint?: string;
}

/**
 * Build the task string sent to CALL-E. This is the exact text the
 * surrogate reads; it must include identity, IVR guidance, refusals,
 * voicemail behavior, and the goal.
 *
 * Format is intentionally simple so it's easy to inspect in transcripts.
 */
export function renderTaskString(input: RenderTaskInput): string {
  const ivrGuidance =
    'On IVR: navigate to a human agent. If the menu asks for an account/order number, say you do not have one and ask to be transferred to a representative.';
  const voicemailBehavior =
    'If the call reaches voicemail, leave a brief message stating who you are and that the user will call back, then end the call.';
  const identityLine = `You are calling on behalf of ${input.userName} (${input.displayName}).`;

  const archetypeNote: Record<MissionArchetype, string> = {
    courier:
      'You are a logistics assistant: confirm package or delivery status, ask for the rider contact if delayed, and capture the expected delivery time.',
    clinic:
      'You are a patient advocate: confirm or reschedule an appointment, ask for any prep instructions, and never share medical details.',
    restaurant:
      'You are a reservation assistant: confirm a table booking, ask about wait time, and capture any dietary accommodations the restaurant can hold.',
    utility:
      'You are a service assistant: confirm an account or service request, ask for a reference number, and capture the next action the user needs to take.',
    general:
      'You are a phone-line surrogate: complete the user goal by talking to a human, capture the answer, and never share the user credentials.',
  };

  return [
    `Phone: ${input.e164}`,
    `Language: ${input.language}`,
    `Identity: ${identityLine}`,
    '',
    `Goal: ${input.goal}`,
    '',
    `Archetype context: ${archetypeNote[input.archetype]}`,
    '',
    `Guidance: ${ivrGuidance}`,
    `Voicemail: ${voicemailBehavior}`,
    '',
    `Hard refusals: ${REFUSAL_BLOCK}`,
    input.extractSchemaFactsHint ? `\nFacts to capture (typed JSON, not prose): ${input.extractSchemaFactsHint}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
