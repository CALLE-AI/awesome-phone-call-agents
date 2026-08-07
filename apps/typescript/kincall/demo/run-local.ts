// A complete check-in, decided end to end, with no network and no credentials.
//
//   node --import tsx demo/run-local.ts
//
// Nothing here can place a call: this app contains no HTTP client at all. It
// prints the decisions a real deployment would then hand to CALL-E.

import {
  buildFamilyContextBrief,
  buildPersonNotificationBrief,
  decideCompanionAction,
  eligibleContacts,
  handleFamilyResult,
  type FamilyStructuredResult,
  type NormalizedCompanionResult,
  type TrustedContact,
} from "../src/index.js";

const PERSON = "Alice";

// What the voice agent reported after the check-in call. Note that the agent
// itself judged attentionRequired "no" — nothing sounded alarming.
const checkIn: NormalizedCompanionResult = {
  neutralSummary: "they would like help completing an administrative document",
  personReached: "yes",
  explicitHelpRequested: "yes",
  fallMentioned: "no",
  mobilityDifficulty: "no",
  painOrInjuryMentioned: "no",
  unusualConfusion: "no",
  distressExpressed: "no",
  conversationEndedNormally: "yes",
  doesNotWantToDisturbFamily: "yes",
  otherAttentionSignal: "no",
  attentionRequired: "no",
  attentionReasons: ["explicit_help_request"],
  confidence: "high",
};

const circle: TrustedContact[] = [
  { id: "contact_bob", firstName: "Bob", priority: 1, consentStatus: "confirmed", enabled: true },
  { id: "contact_chloe", firstName: "Chloé", priority: 2, consentStatus: "confirmed", enabled: true },
  { id: "contact_eve", firstName: "Eve", priority: 3, consentStatus: "pending", enabled: true },
];

function declined(contactId: string): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "no",
    intervention_type: "other",
    estimated_time: "",
    contact_next_person: "yes",
    summary: "Cannot help today.",
  };
}

function confirmed(contactId: string): FamilyStructuredResult {
  return {
    contact_id: contactId,
    answered: "yes",
    situation_understood: "yes",
    can_intervene: "yes",
    intervention_type: "visit",
    estimated_time: "this afternoon",
    contact_next_person: "no",
    summary: "Confirmed a visit this afternoon.",
  };
}

console.log("KinCall — local decision walkthrough (no calls, no credentials)\n");

const decision = decideCompanionAction(checkIn, { attemptNumber: 1 });
console.log("1. Check-in decided");
console.log(`   agent judged attention required: ${checkIn.attentionRequired}`);
console.log(`   decision: ${decision.decision}`);
console.log(`   because:  ${decision.reason}\n`);

if (decision.decision !== "CONTACT_TRUSTED_PERSON") {
  console.log("Nothing further to do.");
  process.exit(0);
}

const brief = buildFamilyContextBrief(checkIn, PERSON);
console.log("2. What every trusted contact is told");
console.log(`   "${brief.sentence}"\n`);

const eligible = eligibleContacts(circle);
console.log("3. Cascade, one contact at a time");
console.log(
  `   eligible, in order: ${eligible.map((c) => c.firstName).join(" → ")}` +
    `   (skipped: ${circle
      .filter((c) => !eligible.includes(c))
      .map((c) => `${c.firstName} — consent not confirmed`)
      .join(", ") || "none"})`
);

let acceptedBy: TrustedContact | null = null;
for (const [index, current] of eligible.entries()) {
  const remaining = eligible.slice(index + 1);
  const result = index === 0 ? declined(current.id) : confirmed(current.id);
  const outcome = handleFamilyResult(result, remaining);
  console.log(`   called ${current.firstName} → ${outcome.kind}`);
  if (outcome.kind === "confirmed") {
    acceptedBy = current;
    break;
  }
}
console.log();

console.log("4. What Alice hears at the end");
const outcomeMessage = acceptedBy
  ? buildPersonNotificationBrief({
      kind: "confirmed",
      personName: PERSON,
      contactName: acceptedBy.firstName,
      estimatedTime: "this afternoon",
      interventionType: "visit",
      contactSummary: "",
    })
  : buildPersonNotificationBrief({ kind: "unresolved", personName: PERSON });
console.log(`   "${outcomeMessage.message}"`);
