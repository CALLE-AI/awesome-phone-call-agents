import { createHash } from "node:crypto";
import { URL } from "node:url";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export const ALLOWED_QUESTIONS = new Set([
  "payout_currency", "payout_rail", "minimum_payout", "payout_timing",
  "geographic_availability", "identity_or_tax_steps", "written_terms_location"
]);

function fail(message) { throw new Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => JSON.stringify(k)+":"+canonical(value[k])).join(",")}}`;
  return JSON.stringify(value);
}
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function httpsUrl(value, label) {
  let url; try { url = new URL(value); } catch { fail(`${label} must be a valid URL`); }
  if (url.protocol !== "https:") fail(`${label} must use HTTPS`);
  return url;
}
export function maskPhone(phone) { return `${phone.slice(0,3)}****${phone.slice(-4)}`; }

export function validatePacket(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("packet must be an object");
  const p = structuredClone(raw);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/.test(p.opportunity_id || "")) fail("opportunity_id is invalid");
  if (!/^\+[1-9][0-9]{7,14}$/.test(p.official_phone || "")) fail("official_phone must be strict E.164 with a leading plus sign");
  if (!/^[A-Z]{2}$/.test(p.region || "")) fail("region must be an ISO 3166-1 alpha-2 code");
  const phone = parsePhoneNumberFromString(p.official_phone);
  if (!phone?.isValid() || phone.country !== p.region) fail("official_phone must be valid for region");
  if (p.authorization !== "official_business_contact_publicly_listed") fail("authorization must attest a publicly listed official business contact");
  const opportunity = httpsUrl(p.opportunity_url, "opportunity_url");
  const contact = httpsUrl(p.contact_source_url, "contact_source_url");
  if (!p.target_name || p.target_name.length > 120) fail("target_name is required and must be <=120 characters");
  if (!Array.isArray(p.questions) || p.questions.length < 1 || p.questions.length > 5) fail("questions must contain 1-5 items");
  if (new Set(p.questions).size !== p.questions.length) fail("questions must be unique");
  for (const q of p.questions) if (!ALLOWED_QUESTIONS.has(q)) fail(`question not allowed: ${q}`);
  if (p.account_context || p.personal_data || p.credentials || p.payment_details) fail("account, personal, credential and payment-detail fields are prohibited");
  if (p.max_calls !== 1) fail("max_calls must equal 1");
  if (!/^20\d\d-\d\d-\d\dT/.test(p.expires_at || "") || Number.isNaN(Date.parse(p.expires_at))) fail("expires_at must be an ISO timestamp");
  if (Date.parse(p.expires_at) <= Date.now()) fail("packet has expired");
  return {...p, opportunity_host: opportunity.hostname, contact_host: contact.hostname};
}

const LABELS = {
  payout_currency: "Which currency or currencies are cash rewards paid in?",
  payout_rail: "Which payout rail or provider is used?",
  minimum_payout: "Is there a minimum balance before payout?",
  payout_timing: "What is the normal payout timing after eligibility is confirmed?",
  geographic_availability: "Which countries or regions can receive the payout?",
  identity_or_tax_steps: "What identity or tax steps are required before payout? Please describe categories only; do not request or receive personal information on this call.",
  written_terms_location: "Where are the current written payout terms published?"
};

export function compilePlan(raw) {
  const p = validatePacket(raw);
  const packetHash = sha256(canonical({...raw, official_phone: maskPhone(raw.official_phone)}));
  const goal = [
    `You are calling the publicly listed business contact for ${p.target_name}.`,
    "At the beginning, disclose that you are an AI calling for TenK to verify public payout logistics for a published opportunity.",
    "Ask whether this is an appropriate contact for public payout-policy questions. If not, request only a public URL or general business contact and end.",
    ...p.questions.map((q,i) => `${i+1}. ${LABELS[q]}`),
    "Do not provide or request account identifiers, passwords, one-time codes, bank/card details, government IDs, dates of birth, addresses, tax identifiers, or confidential information.",
    "Do not accept terms, make a purchase, open an account, negotiate an award, represent eligibility as confirmed, or ask for a different answer after refusal.",
    "Honor any opt-out immediately. Make no follow-up call. Treat verbal answers as unverified statements and ask for a public written source when available."
  ].join("\n");
  const approvalId = `approve-${packetHash.slice(0,16)}`;
  return {
    schema: "payoutproof.plan.v1", opportunity_id:p.opportunity_id,
    target_name:p.target_name, masked_phone:maskPhone(p.official_phone),
    opportunity_url:p.opportunity_url, contact_source_url:p.contact_source_url,
    questions:p.questions, packet_hash:packetHash,
    idempotency_key:`payoutproof-${packetHash.slice(0,24)}`,
    approval_id:approvalId, expires_at:p.expires_at, max_calls:1,
    calle_args:{to_phone:p.official_phone, goal, language:p.language || undefined, region:p.region || undefined},
    safety:{public_policy_only:true, sensitive_data_prohibited:true, terms_acceptance_prohibited:true, recurrence:false, verbal_answers_are_not_contract:true}
  };
}

export function normalizeResult(plan, raw) {
  const allowed=new Set(["QUEUED","RINGING","IN_PROGRESS","COMPLETED","FAILED","NO_ANSWER","DECLINED","CANCELED","CANCELLED","VOICEMAIL","BUSY","EXPIRED","UNKNOWN"]);
  const candidate=String(raw?.status || "UNKNOWN").toUpperCase();
  const status=allowed.has(candidate)?candidate:"UNKNOWN";
  const terminal=new Set(["COMPLETED","FAILED","NO_ANSWER","DECLINED","CANCELED","CANCELLED","VOICEMAIL","BUSY","EXPIRED"]);
  return {schema:"payoutproof.result.v1",opportunity_id:plan.opportunity_id,packet_hash:plan.packet_hash,masked_phone:plan.masked_phone,status,terminal:terminal.has(status),written_source_required:true,contractual_verification:false};
}
