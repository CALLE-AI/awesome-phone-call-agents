export type CaseState = "READY_TO_CONTACT" | "READY_FOR_NEXT_CALL" | "WAITING_EXTERNAL" | "NEEDS_HUMAN";

export type CallResult = {
  partyReached: boolean;
  caseLocated: boolean;
  blocker: "lien_release_missing" | "release_sent_not_received" | "unknown";
  responsibleParty: string | null;
  referenceNumber: string | null;
  needsHuman: boolean;
  unknownQuestions: string[];
  evidence: string;
};

export type TitleCase = {
  state: CaseState;
  blocker: CallResult["blocker"];
  nextOwner: string;
  evidence: string[];
  referenceNumber: string | null;
};

export function initialCase(): TitleCase {
  return { state: "READY_TO_CONTACT", blocker: "unknown", nextOwner: "Metro Auto Auction", evidence: [], referenceNumber: null };
}

export function applyResult(current: TitleCase, result: CallResult): TitleCase {
  if (result.needsHuman || result.unknownQuestions.length || !result.partyReached || !result.caseLocated) {
    return { ...current, state: "NEEDS_HUMAN", evidence: [...current.evidence, result.evidence] };
  }
  if (result.blocker === "lien_release_missing" && result.responsibleParty) {
    return { ...current, state: "READY_FOR_NEXT_CALL", blocker: result.blocker, nextOwner: result.responsibleParty, evidence: [...current.evidence, result.evidence] };
  }
  if (result.blocker === "release_sent_not_received") {
    return { ...current, state: "WAITING_EXTERNAL", blocker: result.blocker, nextOwner: result.responsibleParty ?? "Auction title desk", referenceNumber: result.referenceNumber, evidence: [...current.evidence, result.evidence] };
  }
  return { ...current, state: "NEEDS_HUMAN", evidence: [...current.evidence, "Result did not support a safe automatic transition."] };
}
