// KinCall — the decision layer of a consent-first phone check-in workflow.
//
// Everything exported here is a PURE function of already-validated facts. No
// module in this app opens a socket, reads a clock, touches a database or
// places a call: given the same structured result, each returns the same
// answer, on a first run and on a replay after a crash.
//
// That is the whole point of the pattern. A voice agent interprets a
// conversation; these functions decide what happens next. Swapping the agent,
// the provider or the model cannot change who gets called.
//
// The full application — Next.js interface, CALL-E integration, Postgres
// persistence, crash recovery, dashboard and event timeline — lives at
// https://github.com/JuriSOK/kincall

export type {
  AttentionReason,
  Confidence,
  FamilyStructuredResult,
  NormalizedCompanionResult,
  OrchestrationDecision,
  TrustedContact,
  YesNoUnknown,
} from "./types.js";
export { ATTENTION_REASONS } from "./types.js";

// Step 1 — should anyone be contacted at all?
export {
  decideCompanionAction,
  MAX_COMPANION_ATTEMPTS,
  type CompanionDecisionContext,
  type CompanionDecisionResult,
} from "./decision-tree.js";

// Step 2 — what the trusted contact is told, in the person's own words.
export {
  buildFamilyContextBrief,
  type FamilyContextBrief,
} from "./context-brief.js";

// Step 3 — who is called next, and when the cascade stops.
export {
  contactBlockedReason,
  eligibleContacts,
  handleFamilyResult,
  type FamilyOutcome,
} from "./cascade.js";

// Step 4 — what the monitored person hears at the end.
export {
  buildPersonNotificationBrief,
  type ConfirmedNotificationFacts,
  type NotificationFacts,
  type PersonNotificationBrief,
  type UnresolvedNotificationFacts,
} from "./outcome-message.js";
