export type PreCallDecision =
  | "ELIGIBLE_FOR_CALL"
  | "MANUAL_REVIEW_REQUIRED"
  | "AUTOMATION_BLOCKED"
  | "CALL_WINDOW_CLOSED";

export type Disposition =
  | "READY_FOR_REBOOK_REVIEW"
  | "NOT_READY"
  | "MANUAL_REVIEW"
  | "DO_NOT_CONTACT"
  | "UNREACHED"
  | "AUTOMATION_BLOCKED";

export type AccessControl = "CUSTOMER_CONTROLLED" | "EXTERNAL_PARTY";

export interface VisitWindow {
  id: string;
  label: string;
  start: string;
  end: string;
}

export interface FailedVisitCase {
  id: string;
  serviceType: "SMART_METER_REPLACEMENT";
  sourceFailure: {
    summary: string;
    lockedGate: boolean;
    unsecuredDog: boolean;
    obstruction: boolean;
    presenceRequired: boolean;
    accessControl: AccessControl;
  };
  riskFlags: {
    technicalOrSafetyDefect: boolean;
    hazardousMaterialSuspected: boolean;
    lifeSupportOrVulnerability: boolean;
    emergencyOrOutage: boolean;
    billingOrDisconnectionDispute: boolean;
  };
  recipient: {
    role: "AUTHORIZED_SERVICE_CONTACT";
    phoneE164: string;
    authorized: boolean;
  };
  callWindow: {
    start: string;
    end: string;
  };
  visitWindows: VisitWindow[];
}

export interface DecisionReason {
  code: string;
  message: string;
}

export interface PreCallAssessment {
  decision: PreCallDecision;
  reasons: DecisionReason[];
  evaluatedAt: string;
}

export function maskPhone(phone: string): string {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return "INVALID_NUMBER";
  return `${phone.slice(0, 3)}${"•".repeat(Math.max(4, phone.length - 6))}${phone.slice(-3)}`;
}
