import type { DecisionReason, Disposition, FailedVisitCase } from "./case.js";
import type { StructuredCallResult } from "./result-schema.js";
import type { ValidationResult } from "./validation.js";

export interface RebookDecision {
  disposition: Disposition;
  reasons: DecisionReason[];
  unresolvedFields: string[];
}

export function decideRebookReadiness(failedVisit: FailedVisitCase, validation: ValidationResult): RebookDecision {
  if (!validation.valid) {
    return {
      disposition: "MANUAL_REVIEW",
      reasons: validation.issues.map((validationIssue) => ({
        code: validationIssue.code,
        message: validationIssue.message,
      })),
      unresolvedFields: validation.issues.map((validationIssue) => validationIssue.path),
    };
  }
  return decideValidatedResult(failedVisit, validation.result);
}

function decideValidatedResult(failedVisit: FailedVisitCase, result: StructuredCallResult): RebookDecision {
  if (result.optOut || result.contactOutcome === "DO_NOT_CONTACT") {
    return {
      disposition: "DO_NOT_CONTACT",
      reasons: [{ code: "RECIPIENT_OPTED_OUT", message: "The authorized recipient opted out of automated contact." }],
      unresolvedFields: [],
    };
  }
  if (result.contactOutcome === "UNREACHED") {
    return {
      disposition: "UNREACHED",
      reasons: [{ code: "RECIPIENT_UNREACHED", message: "No structured access answers were obtained." }],
      unresolvedFields: requiredFieldPaths(failedVisit),
    };
  }

  const required = requiredAnswers(failedVisit, result);
  const negative = required.filter((entry) => entry.answer === "NO");
  if (negative.length > 0) {
    return {
      disposition: "NOT_READY",
      reasons: negative.map((entry) => ({ code: `${entry.code}_NOT_RESOLVED`, message: `${entry.label} is not resolved.` })),
      unresolvedFields: negative.map((entry) => entry.path),
    };
  }

  const unknown = required.filter((entry) => entry.answer === "UNKNOWN");
  if (unknown.length > 0 || result.selectedVisitWindowId === null) {
    return {
      disposition: "MANUAL_REVIEW",
      reasons: [
        ...unknown.map((entry) => ({ code: `${entry.code}_UNKNOWN`, message: `${entry.label} remains unknown.` })),
        ...(result.selectedVisitWindowId === null ? [{ code: "VISIT_WINDOW_UNRESOLVED", message: "No approved visit window was selected." }] : []),
      ],
      unresolvedFields: [
        ...unknown.map((entry) => entry.path),
        ...(result.selectedVisitWindowId === null ? ["$.selectedVisitWindowId"] : []),
      ],
    };
  }

  return {
    disposition: "READY_FOR_REBOOK_REVIEW",
    reasons: [{ code: "ALL_BLOCKERS_RESOLVED", message: "All documented access blockers are resolved and one approved visit window was selected." }],
    unresolvedFields: [],
  };
}

function requiredAnswers(failedVisit: FailedVisitCase, result: StructuredCallResult) {
  return [
    ...(failedVisit.sourceFailure.lockedGate ? [{ answer: result.accessResolution.gateUnlocked, code: "GATE", label: "Gate access", path: "$.accessResolution.gateUnlocked" }] : []),
    ...(failedVisit.sourceFailure.unsecuredDog ? [{ answer: result.accessResolution.dogSecured, code: "DOG", label: "Dog containment", path: "$.accessResolution.dogSecured" }] : []),
    ...(failedVisit.sourceFailure.obstruction ? [{ answer: result.accessResolution.obstructionRemoved, code: "OBSTRUCTION", label: "Meter obstruction", path: "$.accessResolution.obstructionRemoved" }] : []),
    ...(failedVisit.sourceFailure.presenceRequired ? [{ answer: result.accessResolution.presenceArranged, code: "PRESENCE", label: "Adult presence", path: "$.accessResolution.presenceArranged" }] : []),
    ...(failedVisit.sourceFailure.accessControl === "EXTERNAL_PARTY" ? [{ answer: result.accessResolution.externalAccessPartyResolved, code: "EXTERNAL_ACCESS", label: "External-party access", path: "$.accessResolution.externalAccessPartyResolved" }] : []),
  ];
}

function requiredFieldPaths(failedVisit: FailedVisitCase): string[] {
  return requiredAnswers(failedVisit, {
    schemaVersion: "1.0",
    contactOutcome: "UNREACHED",
    accessResolution: {
      gateUnlocked: "UNKNOWN",
      dogSecured: "UNKNOWN",
      obstructionRemoved: "UNKNOWN",
      presenceArranged: "UNKNOWN",
      externalAccessPartyResolved: "UNKNOWN",
    },
    selectedVisitWindowId: null,
    optOut: false,
  }).map((entry) => entry.path);
}
