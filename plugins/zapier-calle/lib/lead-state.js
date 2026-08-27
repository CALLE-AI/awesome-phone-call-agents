// Collapses the ten dispositions into the three states a no-code workflow
// actually branches on.
//
// The dispositions exist because "why did this call not produce an answer"
// matters when you are debugging or auditing. But a Zapier Path builder
// choosing between ten string values is a wall of configuration, and every
// person building one has to re-derive which values are safe to act on. That
// derivation is this integration's job, not theirs. `lead_state` is the
// coarse answer; `disposition` and `disposition_reason` remain on the output
// for anyone who needs the detail.
//
// Nothing is lost: this is a projection, not a replacement.
export const LEAD_STATES = Object.freeze(['qualified', 'needs_human', 'blocked_compliance']);

// A refusal that happened before or instead of a conversation - the call was
// not placed, or must not lead to further contact. These are policy outcomes,
// not call outcomes, and a CRM should treat them differently: there is no
// result to review, there is a rule to record.
const BLOCKED_COMPLIANCE = new Set([
  'outside_calling_window',
  'suppressed',
  'retry_policy_blocked',
]);

export function toLeadState(disposition, { optOutRequested = false } = {}) {
  // A revocation outranks whatever the business result was. Even a call that
  // produced a perfectly good answer must not advance an outreach sequence
  // once the person has asked not to be contacted again.
  if (optOutRequested) return 'blocked_compliance';
  if (BLOCKED_COMPLIANCE.has(disposition)) return 'blocked_compliance';
  if (disposition === 'confirmed') return 'qualified';
  return 'needs_human';
}
