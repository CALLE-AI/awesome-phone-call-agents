// The phone interview: task text per language and matter type, plus the structured result CALL-E must return.
// All spoken text lives in functions/locales/<lang>.js (data only); this file assembles it.
import { matter } from "./_matters.js";
import en from "./locales/en.js";
import es from "./locales/es.js";
import id from "./locales/id.js";

const L = { en, es, id };
const fill = (s, vars) => String(s).replace(/{(\w+)}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

// Fields every intake returns, whatever the matter type.
const BASE_FIELDS = {
  full_name: { type: "string" },
  email: { type: "string", description: "Email address as the caller spelled it, or 'none'" },
  preferred_language: { type: "string" },
  matter_summary: { type: "string", description: "2-3 sentence summary in English" },
  other_parties: { type: "string", description: "Other people or companies involved, for the conflict check, or 'none'" },
  urgency: { type: "string", enum: ["low", "normal", "high"] },
  deadline_or_court_date: { type: "string", description: "Any date mentioned, verbatim, or 'none'" },
  best_time_to_call: { type: "string" },
  consent_to_contact: { type: "string", enum: ["yes", "no", "unknown"] },
};
export const BASE_FIELD_NAMES = Object.keys(BASE_FIELDS);

export function resultSchema(matterType) {
  const m = matter(matterType);
  return {
    type: "object",
    required: ["full_name", "matter_summary", "urgency", "consent_to_contact"],
    properties: { ...BASE_FIELDS, ...m.fields },
  };
}
// Kept for callers that predate matter types.
export const RESULT_SCHEMA = resultSchema("other");

// The brand "Nota.Lawyer" is pronounced "Not a Lawyer". TTS would read it as "Nota dot Lawyer",
// so the script always speaks the firm name in its pronounceable form.
const SPOKEN_NAMES = { "nota.lawyer": "Not a Lawyer" };
const spoken = (firm) => {
  const f = String(firm || "the firm").trim();
  return SPOKEN_NAMES[f.toLowerCase()] || f.replace(/\./g, " ").replace(/\s+/g, " ").trim();
};

// Interview script language from a CALL-E locale code (en-US, es, id, ...).
export function scriptLang(locale) {
  const base = String(locale || "en").toLowerCase().split("-")[0];
  return L[base] ? base : "en";
}

export function intakeTask({ lang, firm, name, matterType, matterHint, email }) {
  const l = L[lang] ? lang : "en";
  const T = L[l];
  const m = matter(matterType);
  const hint = matterHint ? fill(T.hint, { m: matterHint }) : "";
  const emailKnown = email ? fill(T.emailKnown, { email }) : "";
  const typeQ = m.questions[l] ? " " + m.questions[l] : "";
  return fill(T.preamble, { firm: spoken(firm), name, matter: m.label[l].toLowerCase() })
       + hint + " " + fill(T.common, { emailKnown }) + typeQ + " " + T.rules;
}

export function reminderTask({ lang, firm, name, when }) {
  const T = L[L[lang] ? lang : "en"];
  return fill(T.reminder, { firm: spoken(firm), name, when });
}

export const REMINDER_SCHEMA = {
  type: "object",
  required: ["confirmed"],
  properties: {
    confirmed: { type: "string", enum: ["yes", "no", "unknown"] },
    reschedule_request: { type: "string" },
  },
};
