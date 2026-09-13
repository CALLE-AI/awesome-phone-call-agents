import type { FamilyStructuredResult, TrustedContact } from "./types.js";
export type FamilyOutcome =
  | { kind: "confirmed" }
  | { kind: "declined"; nextContactId: string }
  | { kind: "no_answer"; nextContactId: string }
  | { kind: "declined_no_contacts_remaining" }
  | { kind: "no_answer_no_contacts_remaining" };

// Implements the cascade-failure behaviour of the full application.
// remainingContacts must already exclude the contact this result is for.
export function handleFamilyResult(
  result: FamilyStructuredResult,
  remainingContacts: TrustedContact[]
): FamilyOutcome {
  // Only an explicit "yes" stops the cascade (decision record DEC-005). "unknown" means the
  // contact was vague or non-committal, and KinCall must never record a
  // hesitant answer as a confirmed intervention (a safety rule of the full application) — it keeps looking for
  // someone who will actually commit.
  if (result.can_intervene === "yes") {
    return { kind: "confirmed" };
  }

  const nextContact = remainingContacts[0];

  if (result.answered === "yes") {
    if (!nextContact) return { kind: "declined_no_contacts_remaining" };
    return { kind: "declined", nextContactId: nextContact.id };
  }

  if (!nextContact) return { kind: "no_answer_no_contacts_remaining" };
  return { kind: "no_answer", nextContactId: nextContact.id };
}

// Who may be called at all, in the order they will be tried.
//
// Consent is absolute and checked here rather than at dialling time, so an
// unconsented contact is never reached even by a caller that forgot to ask.
// A disabled contact is skipped the same way. Nobody is excluded for being
// outside a preferred time window — availability only ever REORDERS an
// eligible circle, so a quiet hour can never leave a person with nobody.
export function eligibleContacts(contacts: TrustedContact[]): TrustedContact[] {
  return contacts
    .filter((contact) => contact.consentStatus === "confirmed" && contact.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority);
}

// Why a contact was skipped, for the event timeline. Returns null when the
// contact is callable.
export function contactBlockedReason(contact: TrustedContact): string | null {
  if (contact.consentStatus !== "confirmed") {
    return `${contact.firstName} has not confirmed consent to be called`;
  }
  if (!contact.enabled) {
    return `${contact.firstName} is currently switched off`;
  }
  return null;
}
