import { z } from 'zod';
import { SIDE_EFFECTS, SENSITIVITIES } from './task.js';

/**
 * Section 11. The user's standing policy. Dial reads this before every action
 * with a real-world consequence. An LLM cannot widen it: the policy is
 * evaluated in plain TypeScript, server-side, from stored user rows.
 */

export const AUTOMATION_LEVELS = ['automatic', 'ask', 'never'] as const;
export type AutomationLevel = (typeof AUTOMATION_LEVELS)[number];

export const DISCLOSURE_LEVELS = ['allow', 'ask', 'never'] as const;
export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

export const userPolicySchema = z.object({
  informationGathering: z.enum(AUTOMATION_LEVELS).default('automatic'),
  phoneInquiries: z.enum(AUTOMATION_LEVELS).default('automatic'),
  reservationsWithoutPayment: z.enum(AUTOMATION_LEVELS).default('ask'),
  appointments: z.enum(AUTOMATION_LEVELS).default('ask'),
  /** Purchases are 'ask' at minimum. 'automatic' is deliberately not accepted. */
  purchases: z.enum(['ask', 'never']).default('ask'),
  maxAuthorizedSpend: z.number().nonnegative().max(100000).default(0),
  spendCurrency: z.string().length(3).default('USD'),
  sharePhoneNumber: z.enum(DISCLOSURE_LEVELS).default('ask'),
  shareAddress: z.enum(DISCLOSURE_LEVELS).default('ask'),
  /** Medical disclosure is never 'allow' by standing policy; each task is asked. */
  shareMedicalInformation: z.enum(['ask', 'never']).default('ask'),
  leaveVoicemail: z.enum(DISCLOSURE_LEVELS).default('ask'),
});
export type UserPolicy = z.infer<typeof userPolicySchema>;

export const DEFAULT_USER_POLICY: UserPolicy = userPolicySchema.parse({});

export const AUTHORIZATION_DECISIONS = ['pending', 'approved', 'denied', 'expired'] as const;
export type AuthorizationDecisionState = (typeof AUTHORIZATION_DECISIONS)[number];

export const authorizationKindSchema = z.enum([
  'place_calls',
  'make_reservation',
  'book_appointment',
  'make_purchase',
  'share_phone_number',
  'share_address',
  'share_medical_information',
  'leave_voicemail',
  'exceed_spend_limit',
]);
export type AuthorizationKind = z.infer<typeof authorizationKindSchema>;

/** Result of evaluating the policy for one intended action. */
export interface PolicyVerdict {
  allowed: boolean;
  /** True when the user must approve before Dial may proceed. */
  requiresConfirmation: boolean;
  kind: AuthorizationKind;
  /** Plain-language reason, safe to show the user verbatim. */
  reason: string;
}

export const sideEffectSchema = z.enum(SIDE_EFFECTS);
export const sensitivitySchema = z.enum(SENSITIVITIES);
