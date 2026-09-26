export type FollowUpStatus = "draft" | "saved" | "completed";

export type FollowUpDraft = {
  womanId: string;
  contactMethod: "visit" | "phone" | "sms";
  outcome: "reached" | "no_answer" | "needs_clinician";
  note: string;
  nextAction: "call_again" | "clinic_visit" | "urgent_review" | "none";
  status: FollowUpStatus;
};

export function validateFollowUp(draft: FollowUpDraft): string | null {
  if (!draft.womanId.trim()) return "A woman record is required.";
  if (!draft.note.trim() && draft.outcome !== "no_answer") return "Add a short note about the contact.";
  if (draft.outcome === "needs_clinician" && draft.nextAction !== "urgent_review") return "Clinical review must be selected for escalation.";
  return null;
}

export function completeFollowUp(draft: FollowUpDraft): FollowUpDraft {
  const error = validateFollowUp(draft);
  if (error) throw new Error(error);
  return { ...draft, status: "completed" };
}
