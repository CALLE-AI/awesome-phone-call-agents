import type {
  CallType,
  Claim,
  ClaimContact,
  ContactRole,
} from "../domain/types.js";
import { maskPhone } from "../domain/phone.js";
import { languageFromLocale } from "../domain/language.js";
import {
  FNOL_SCHEMA_VERSION,
  fnolTransmitSchema,
} from "../schemas/fnol.js";
import {
  STATUS_CHASE_SCHEMA_VERSION,
  statusChaseTransmitSchema,
} from "../schemas/status-chase.js";
import {
  MEDICAL_REPORT_SCHEMA_VERSION,
  medicalReportTransmitSchema,
} from "../schemas/medical.js";
import {
  BILL_VERIFICATION_SCHEMA_VERSION,
  billVerificationTransmitSchema,
} from "../schemas/bill.js";

export interface TaskOptions {
  insurerName: string;
}

export interface CallPlan {
  callType: CallType;
  task: string;
  resultSchema: Record<string, unknown>;
  schemaVersion: string;
  recipient: { phone: string; region: string; locale: string };
}

/** Operator-facing, PII-minimized preview. Never contains the full number. */
export interface CallPreview {
  callType: CallType;
  claimReference: string;
  policyholderName: string;
  incidentType: string;
  maskedDestination: string;
  region: string;
  locale: string;
  schemaVersion: string;
  task: string;
  resultSchema: Record<string, unknown>;
}

const DISCLOSURE =
  "Begin by clearly stating you are an AI assistant calling on behalf of {insurer}, that the call is recorded, and ask for consent to continue. If the person declines, does not consent, or asks you to stop, thank them politely and end the call without collecting details.";

/**
 * Prepend an explicit language instruction so CALL-E conducts the call in the
 * recipient's language. The locale already routes the spoken language; this
 * makes it unambiguous and covers greetings/closings too.
 */
function withLanguage(plan: CallPlan): CallPlan {
  const lang = languageFromLocale(plan.recipient.locale);
  if (lang.code === "en") return plan;
  const instruction = `Conduct this entire call in ${lang.name}. Speak naturally in ${lang.name} for the greeting, questions, and closing.`;
  return { ...plan, task: `${instruction}\n${plan.task}` };
}

export function planFnolCall(claim: Claim, options: TaskOptions): CallPlan {
  const disclosure = DISCLOSURE.replace("{insurer}", options.insurerName);
  const task = [
    `Call ${claim.policyholderName} to take a first notice of loss for insurance claim ${claim.reference}.`,
    disclosure,
    "Then, in a calm and empathetic tone, gather these facts about the incident:",
    "- the type of incident (auto collision, auto theft, property water damage, property fire, property theft, injury, or other);",
    "- when it happened (date and rough time);",
    "- where it happened;",
    "- a short description in the person's own words;",
    "- whether anyone was injured (yes/no/unknown);",
    "- which items or vehicle parts are damaged;",
    "- whether another party was involved (yes/no/unknown);",
    "- whether a police report was filed (yes/no/unknown);",
    "- a preferred window for a human adjuster to call back.",
    "Do not offer any opinion on coverage, fault, settlement, or payment, and do not promise anything. You are only collecting information for a human claims handler.",
    "Set consent_recorded to true only if the person explicitly agreed to continue after the recording disclosure.",
  ].join("\n");

  return {
    callType: "fnol_intake",
    task,
    resultSchema: fnolTransmitSchema,
    schemaVersion: FNOL_SCHEMA_VERSION,
    recipient: {
      phone: claim.claimantPhone,
      region: claim.region,
      locale: claim.locale,
    },
  };
}

export function planStatusChaseCall(claim: Claim, options: TaskOptions): CallPlan {
  if (!claim.providerName || !claim.providerPhone) {
    throw new Error(
      `claim ${claim.reference} has no provider name/phone for a status-chase call`,
    );
  }
  const disclosure = DISCLOSURE.replace("{insurer}", options.insurerName);
  const task = [
    `Call ${claim.providerName} to check the repair or service status for insurance claim ${claim.reference}.`,
    disclosure,
    "If you reach a phone menu, navigate to the service or repair desk.",
    "Once connected to a person, gather:",
    "- the current work status (not started, in progress, completed, or unknown);",
    "- the estimated completion date, if any;",
    "- the estimated cost and its currency, if quoted;",
    "- any blockers holding up the work;",
    "- the name of the person you spoke with.",
    "Do not authorize any work, approve any cost, or make any commitment. You are only collecting a status update for a human claims handler.",
  ].join("\n");

  return {
    callType: "status_chase",
    task,
    resultSchema: statusChaseTransmitSchema,
    schemaVersion: STATUS_CHASE_SCHEMA_VERSION,
    recipient: {
      phone: claim.providerPhone,
      region: claim.region,
      locale: claim.locale,
    },
  };
}

export function planFor(
  claim: Claim,
  callType: CallType,
  options: TaskOptions,
): CallPlan {
  const plan =
    callType === "status_chase"
      ? planStatusChaseCall(claim, options)
      : planFnolCall(claim, options);
  return withLanguage(plan);
}

/** Default call type for a contact's role. */
export function roleToCallType(role: ContactRole): CallType {
  switch (role) {
    case "treating_doctor":
      return "medical_report";
    case "hospital_billing":
      return "bill_verification";
    case "repair_shop":
      return "status_chase";
    case "claimant":
    case "witness":
    case "other":
    default:
      return "fnol_intake";
  }
}

function planMedicalReport(
  claim: Claim,
  contact: ClaimContact,
  options: TaskOptions,
): CallPlan {
  const disclosure = DISCLOSURE.replace("{insurer}", options.insurerName);
  const task = [
    `Call ${contact.name} (treating doctor / clinic) about the patient ${claim.policyholderName} for insurance claim ${claim.reference}.`,
    disclosure,
    "If you reach a phone menu, navigate to the relevant medical or records desk.",
    "With appropriate professional courtesy, gather:",
    "- a short summary of the injuries observed;",
    "- the treatment provided;",
    "- whether the injuries are consistent with the reported accident (yes/no/unknown);",
    "- whether treatment is still ongoing (yes/no/unknown);",
    "- the expected recovery outlook;",
    "- the name of the person you spoke with.",
    "Do not request or record any information beyond what is needed for this claim, and do not offer any opinion on coverage or payment. You are only collecting a medical summary for a human claims handler.",
  ].join("\n");
  return {
    callType: "medical_report",
    task,
    resultSchema: medicalReportTransmitSchema,
    schemaVersion: MEDICAL_REPORT_SCHEMA_VERSION,
    recipient: {
      phone: contact.phone,
      region: contactRegion(claim, contact),
      locale: contactLocale(claim, contact),
    },
  };
}

function planBillVerification(
  claim: Claim,
  contact: ClaimContact,
  options: TaskOptions,
): CallPlan {
  const disclosure = DISCLOSURE.replace("{insurer}", options.insurerName);
  const task = [
    `Call ${contact.name} (billing) to confirm the bill for patient ${claim.policyholderName}, insurance claim ${claim.reference}.`,
    disclosure,
    "If you reach a phone menu, navigate to the billing or accounts desk.",
    "Gather:",
    "- the total amount billed, as a number;",
    "- the currency;",
    "- the service start and end dates, if available;",
    "- whether an itemized bill is available;",
    "- the name of the person you spoke with.",
    "Do not authorize, dispute, or promise payment of any amount. You are only collecting the billed amount for a human claims handler to verify.",
  ].join("\n");
  return {
    callType: "bill_verification",
    task,
    resultSchema: billVerificationTransmitSchema,
    schemaVersion: BILL_VERIFICATION_SCHEMA_VERSION,
    recipient: {
      phone: contact.phone,
      region: contactRegion(claim, contact),
      locale: contactLocale(claim, contact),
    },
  };
}

/**
 * Build a plan to call a specific contact. The call type comes from the
 * contact's role unless overridden; the destination is always the contact's
 * own number (not the claim's claimant/provider fields).
 */
export function planForContact(
  claim: Claim,
  contact: ClaimContact,
  options: TaskOptions,
  callTypeOverride?: CallType,
): CallPlan {
  const callType = callTypeOverride ?? roleToCallType(contact.role);
  const base = ((): CallPlan => {
    switch (callType) {
      case "medical_report":
        return planMedicalReport(claim, contact, options);
      case "bill_verification":
        return planBillVerification(claim, contact, options);
      case "status_chase":
        return planStatusChaseForContact(claim, contact, options);
      case "fnol_intake":
      default:
        return planFnolForContact(claim, contact, options);
    }
  })();
  return withLanguage(base);
}

/** A contact may override the claim's region/locale (e.g. call this party in Hindi). */
function contactRegion(claim: Claim, contact: ClaimContact): string {
  return contact.region ?? claim.region;
}
function contactLocale(claim: Claim, contact: ClaimContact): string {
  return contact.locale ?? claim.locale;
}

function planFnolForContact(
  claim: Claim,
  contact: ClaimContact,
  options: TaskOptions,
): CallPlan {
  const plan = planFnolCall(claim, options);
  return {
    ...plan,
    recipient: {
      phone: contact.phone,
      region: contactRegion(claim, contact),
      locale: contactLocale(claim, contact),
    },
  };
}

function planStatusChaseForContact(
  claim: Claim,
  contact: ClaimContact,
  options: TaskOptions,
): CallPlan {
  const disclosure = DISCLOSURE.replace("{insurer}", options.insurerName);
  const task = [
    `Call ${contact.name} to check the repair or service status for insurance claim ${claim.reference}.`,
    disclosure,
    "If you reach a phone menu, navigate to the service or repair desk.",
    "Once connected to a person, gather:",
    "- the current work status (not started, in progress, completed, or unknown);",
    "- the estimated completion date, if any;",
    "- the estimated cost and its currency, if quoted;",
    "- any blockers holding up the work;",
    "- the name of the person you spoke with.",
    "Do not authorize any work, approve any cost, or make any commitment. You are only collecting a status update for a human claims handler.",
  ].join("\n");
  return {
    callType: "status_chase",
    task,
    resultSchema: statusChaseTransmitSchema,
    schemaVersion: STATUS_CHASE_SCHEMA_VERSION,
    recipient: {
      phone: contact.phone,
      region: contactRegion(claim, contact),
      locale: contactLocale(claim, contact),
    },
  };
}

export function toContactPreview(
  claim: Claim,
  contact: ClaimContact,
  plan: CallPlan,
): CallPreview {
  return {
    ...toPreview(claim, plan),
    // Preview uses the contact's masked number as the destination.
    maskedDestination: maskPhone(contact.phone),
  };
}

export function toPreview(claim: Claim, plan: CallPlan): CallPreview {
  return {
    callType: plan.callType,
    claimReference: claim.reference,
    policyholderName: claim.policyholderName,
    incidentType: claim.incidentType,
    maskedDestination: maskPhone(plan.recipient.phone),
    region: plan.recipient.region,
    locale: plan.recipient.locale,
    schemaVersion: plan.schemaVersion,
    task: plan.task,
    resultSchema: plan.resultSchema,
  };
}
