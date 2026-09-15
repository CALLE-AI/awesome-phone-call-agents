import { containsSensitiveData } from "./redact";

const SAFE_CASE_CODE = /^CL-[0-9A-F]{6}$/;

export interface CallTaskInput {
  vendorDisplayName: string;
  buyerOrgName: string;
  safeCaseCode: string;
}

function guardField(name: string, value: string): void {
  if (!value || value.length > 120 || /[\n\r]/.test(value)) {
    throw new Error(`invalid ${name}`);
  }
  if (containsSensitiveData(value)) {
    throw new Error(`${name} carries prohibited content`);
  }
}

export function buildCallTask(input: CallTaskInput): string {
  guardField("vendorDisplayName", input.vendorDisplayName);
  guardField("buyerOrgName", input.buyerOrgName);
  if (!SAFE_CASE_CODE.test(input.safeCaseCode)) {
    throw new Error("invalid safeCaseCode");
  }
  const code = input.safeCaseCode;
  const vendor = input.vendorDisplayName;
  const buyer = input.buyerOrgName;

  return [
    `You are an automated verification assistant placing a disclosed automated call on behalf of ${buyer}. State at the start of the call that this is an automated call from ${buyer}.`,
    `This call concerns payment-instruction change request ${code} for vendor ${vendor}.`,
    `Ask whether you are speaking with someone at ${vendor} who can confirm whether the vendor organization initiated that request. If you are not, politely end the call.`,
    `Ask exactly one question: "Did your organization initiate a request associated with case code ${code} to change where future payments are sent?"`,
    `Accept only yes, no, unable to verify, or a refusal. Do not pressure the recipient.`,
    `If the recipient begins stating bank account numbers, routing numbers, card numbers, credentials, one-time codes, or other financial details, politely interrupt, ask them not to share those details, and end the call.`,
    `Do not state, request, or confirm any bank account number, routing number, IBAN, SWIFT or BIC code, card number, credential, one-time code, tax identifier, or payment link.`,
    `Tell the recipient that this call does not approve or apply any change, and that the buyer's accounts payable team will review the result.`,
    `If the recipient refuses automated verification or asks you to stop, end the call politely.`,
    `Keep the call under 60 seconds.`,
  ].join("\n");
}
