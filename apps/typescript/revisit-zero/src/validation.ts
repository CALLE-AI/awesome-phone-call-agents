import type { FailedVisitCase } from "./case.js";
import {
  ANSWERS,
  CONTACT_OUTCOMES,
  isProviderWireResultError,
  type ClosedAnswer,
  type StructuredCallResult,
} from "./result-schema.js";

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; result: StructuredCallResult; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

const TOP_LEVEL_KEYS = ["accessResolution", "contactOutcome", "optOut", "schemaVersion", "selectedVisitWindowId"];
const ACCESS_KEYS = ["dogSecured", "externalAccessPartyResolved", "gateUnlocked", "obstructionRemoved", "presenceArranged"];

export function validateStructuredResult(raw: unknown, failedVisit: FailedVisitCase): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (isProviderWireResultError(raw)) {
    return {
      valid: false,
      issues: [issue("PROVIDER_WIRE_SCHEMA_MISMATCH", "$", "The provider result did not match the approved closed wire schema.")],
    };
  }
  if (!isPlainObject(raw)) {
    return { valid: false, issues: [issue("NOT_AN_OBJECT", "$", "Result must be an object.")] };
  }

  exactKeys(raw, TOP_LEVEL_KEYS, "$", issues);
  if (raw.schemaVersion !== "1.0") issues.push(issue("INVALID_SCHEMA_VERSION", "$.schemaVersion", "schemaVersion must equal 1.0."));
  if (!CONTACT_OUTCOMES.includes(raw.contactOutcome as never)) issues.push(issue("INVALID_CONTACT_OUTCOME", "$.contactOutcome", "contactOutcome is not allowed."));
  if (typeof raw.optOut !== "boolean") issues.push(issue("INVALID_OPT_OUT", "$.optOut", "optOut must be boolean."));
  if (!(raw.selectedVisitWindowId === null || typeof raw.selectedVisitWindowId === "string")) {
    issues.push(issue("INVALID_WINDOW_ID", "$.selectedVisitWindowId", "selectedVisitWindowId must be a string or null."));
  }

  if (!isPlainObject(raw.accessResolution)) {
    issues.push(issue("INVALID_ACCESS_RESOLUTION", "$.accessResolution", "accessResolution must be an object."));
  } else {
    exactKeys(raw.accessResolution, ACCESS_KEYS, "$.accessResolution", issues);
    for (const key of ACCESS_KEYS) {
      if (!ANSWERS.includes(raw.accessResolution[key] as never)) {
        issues.push(issue("INVALID_CLOSED_ANSWER", `$.accessResolution.${key}`, `${key} must use a closed answer.`));
      }
    }
  }
  if (issues.length > 0) return { valid: false, issues };

  const result = raw as unknown as StructuredCallResult;
  const allowedWindowIds = new Set(failedVisit.visitWindows.map((window) => window.id));
  if (result.selectedVisitWindowId !== null && !allowedWindowIds.has(result.selectedVisitWindowId)) {
    issues.push(issue("UNAPPROVED_VISIT_WINDOW", "$.selectedVisitWindowId", "The selected window was not in the approved preview."));
  }

  enforceApplicability(result.accessResolution.gateUnlocked, failedVisit.sourceFailure.lockedGate, "gateUnlocked", issues);
  enforceApplicability(result.accessResolution.dogSecured, failedVisit.sourceFailure.unsecuredDog, "dogSecured", issues);
  enforceApplicability(result.accessResolution.obstructionRemoved, failedVisit.sourceFailure.obstruction, "obstructionRemoved", issues);
  enforceApplicability(result.accessResolution.presenceArranged, failedVisit.sourceFailure.presenceRequired, "presenceArranged", issues);
  enforceApplicability(result.accessResolution.externalAccessPartyResolved, failedVisit.sourceFailure.accessControl === "EXTERNAL_PARTY", "externalAccessPartyResolved", issues);

  const answers = Object.values(result.accessResolution);
  if (result.contactOutcome === "UNREACHED" && (answers.some((answer) => answer !== "UNKNOWN") || result.selectedVisitWindowId !== null || result.optOut)) {
    issues.push(issue("UNREACHED_WITH_ANSWERS", "$", "An unreached call cannot contain answers, a selected window, or opt-out."));
  }
  if (result.optOut && result.contactOutcome !== "DO_NOT_CONTACT") {
    issues.push(issue("OPT_OUT_OUTCOME_CONFLICT", "$", "optOut requires DO_NOT_CONTACT."));
  }
  if (result.contactOutcome === "DO_NOT_CONTACT" && !result.optOut) {
    issues.push(issue("DO_NOT_CONTACT_WITHOUT_OPT_OUT", "$", "DO_NOT_CONTACT requires optOut."));
  }
  if (result.contactOutcome === "DO_NOT_CONTACT" && (answers.some((answer) => answer !== "UNKNOWN") || result.selectedVisitWindowId !== null)) {
    issues.push(issue("OPT_OUT_WITH_ACCESS_ANSWERS", "$", "An opt-out result cannot also contain access answers or a selected window."));
  }

  return issues.length > 0 ? { valid: false, issues } : { valid: true, result, issues: [] };
}

function enforceApplicability(answer: ClosedAnswer, applicable: boolean, field: string, issues: ValidationIssue[]): void {
  if (applicable && answer === "NOT_APPLICABLE") {
    issues.push(issue("REQUIRED_FIELD_MARKED_NOT_APPLICABLE", `$.accessResolution.${field}`, `${field} is required for this case.`));
  }
  if (!applicable && answer !== "NOT_APPLICABLE" && answer !== "UNKNOWN") {
    issues.push(issue("ANSWER_FOR_UNDOCUMENTED_BLOCKER", `$.accessResolution.${field}`, `${field} was not an allowed question for this case.`));
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string, issues: ValidationIssue[]): void {
  const actual = Object.keys(value).sort();
  for (const missing of expected.filter((key) => !(key in value))) {
    issues.push(issue("MISSING_FIELD", `${path}.${missing}`, `${missing} is required.`));
  }
  for (const extra of actual.filter((key) => !expected.includes(key))) {
    issues.push(issue("UNKNOWN_FIELD", `${path}.${extra}`, `${extra} is not permitted by the closed schema.`));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
