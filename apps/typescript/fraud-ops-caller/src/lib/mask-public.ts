import { maskE164 } from "./plan-view";
import type { FraudOpsCase, FraudOpsOutcome } from "./types";

const E164_IN_TEXT = /\+[1-9][0-9]{7,14}/g;
const PLUS1_FORMATTED =
  /\+1[\s.-]*\(?[2-9]\d{2}\)?[\s.-]*[2-9]\d{2}[\s.-]*\d{4}/g;
const NATIONAL_FORMATTED =
  /(?<!\d)1[\s.-]*\(?[2-9]\d{2}\)?[\s.-]*[2-9]\d{2}[\s.-]*\d{4}(?!\d)/g;
const PARENS_NANP = /\([2-9]\d{2}\)[\s.-]*[2-9]\d{2}[\s.-]*\d{4}/g;
const SEP_NANP = /(?<!\d)[2-9]\d{2}[\s.-][2-9]\d{2}[\s.-]\d{4}(?!\d)/g;
const BARE_NANP = /(?<!\d)[2-9]\d{2}[2-9]\d{6}(?!\d)/g;
const LOCAL_NANP = /(?<!\d)[2-9]\d{2}[\s.-]\d{4}(?!\d)/g;
const TRANSCRIPT_CAP = 160;

function maskE164Safe(phone: string): string {
  try {
    return maskE164(phone);
  } catch {
    return "+********";
  }
}

function maskNanpMatch(match: string): string {
  const digits = match.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return maskE164Safe(`+${digits}`);
  }
  if (digits.length === 10) {
    return maskE164Safe(`+1${digits}`);
  }
  if (digits.length >= 4) {
    return `***${digits.slice(-4)}`;
  }
  return "****";
}

export function redactPhones(text: string): string {
  return text
    .replace(E164_IN_TEXT, maskE164Safe)
    .replace(PLUS1_FORMATTED, maskNanpMatch)
    .replace(NATIONAL_FORMATTED, maskNanpMatch)
    .replace(PARENS_NANP, maskNanpMatch)
    .replace(SEP_NANP, maskNanpMatch)
    .replace(BARE_NANP, maskNanpMatch)
    .replace(LOCAL_NANP, maskNanpMatch);
}

export function maskOutcomeForBrowser(outcome: FraudOpsOutcome): FraudOpsOutcome {
  const transcript = redactPhones(outcome.transcript_snippet);
  return {
    ...outcome,
    quotes: outcome.quotes.map(redactPhones),
    next_action: redactPhones(outcome.next_action),
    transcript_snippet:
      transcript.length > TRANSCRIPT_CAP
        ? `${transcript.slice(0, TRANSCRIPT_CAP)}…[redacted]`
        : transcript,
    fields: { ...outcome.fields },
  };
}

export function toPublicCase(fraudCase: FraudOpsCase): FraudOpsCase {
  return {
    ...fraudCase,
    contact: {
      ...fraudCase.contact,
      phone_e164: maskE164(fraudCase.contact.phone_e164),
    },
  };
}
