import type {
  answerConfidenceValues,
  answerValueValues,
} from "@/domain/enums";

export type AnswerValue = {
  value: (typeof answerValueValues)[number];
  confidence: (typeof answerConfidenceValues)[number];
  evidenceRefs: string[];
  note?: string;
};

export type VisitContext = {
  serviceDate: string;
  equipmentLabel: string;
  technicianCompletionNote: string;
  allowedReferenceText: string;
};

export type CallingWindow = {
  timezone: string;
  startLocal: string;
  endLocal: string;
  evaluatedAt: string;
};

export type PreferredWindow = {
  startLocal: string;
  endLocal: string;
  timezone: string;
  status: "reported_preference_not_confirmed";
};

export type AdministrativeResults = Record<string, string | boolean | null>;
export type RedactedAuditMetadata = Record<
  string,
  string | number | boolean | null
>;
