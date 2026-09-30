export function maskPhone(phone = "") {
  const s = String(phone);
  return s.length >= 4 ? `***${s.slice(-4)}` : "***";
}

export function validateE164(phone = "") {
  return /^\+[1-9]\d{7,14}$/.test(String(phone));
}

export function classifyCallRequest({
  phone,
  consent = false,
  blocked = false,
  domain = "general",
  purpose = ""
} = {}) {
  if (!validateE164(phone)) return { decision:"DENY", reasons:["invalid_e164"] };
  if (blocked) return { decision:"DENY", reasons:["blocked_recipient"] };
  if (/password|seed phrase|private key|api key|secret/i.test(purpose)) {
    return { decision:"DENY", reasons:["secret_collection"] };
  }
  if (["medical","legal","financial","employment","collections"].includes(domain)) {
    return { decision:"REQUIRE_HUMAN", reasons:["sensitive_domain"] };
  }
  if (!consent) return { decision:"REQUIRE_HUMAN", reasons:["consent_not_confirmed"] };
  return { decision:"ALLOW", reasons:[] };
}

export function classifyFollowup(result = {}) {
  const action = result.requested_action ?? "record_only";
  if (["payment","purchase","contract","cancel_service","schedule_medical"].includes(action)) {
    return { decision:"REQUIRE_HUMAN", action, reasons:["consequential_action"] };
  }
  return { decision:"ALLOW", action, reasons:[] };
}
