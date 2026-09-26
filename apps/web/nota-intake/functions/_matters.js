// Matter types: what the client can pick on the form, what the call asks for each, and what it must return.
// Each type adds its own questions and result fields on top of the common intake (name, summary, other parties,
// urgency, best time, email, consent). The per-language label, blurb and questions live in
// functions/locales/<lang>.js; this file holds the icon and the English result schema for each type.
import en from "./locales/en.js";
import es from "./locales/es.js";
import id from "./locales/id.js";

const LOCALES = { en, es, id };
const LANGS = Object.keys(LOCALES);

const TYPES = {
  real_estate: {
    icon: "🏠",
    fields: {
      property_address: { type: "string", description: "Street and city, as stated, or 'unknown'" },
      role: { type: "string", enum: ["buyer", "seller", "landlord", "tenant", "other", "unknown"] },
      contract_signed: { type: "string", enum: ["yes", "no", "unknown"] },
      key_date: { type: "string", description: "Closing, move-out or other deadline, verbatim, or 'none'" },
    },
  },
  will: {
    icon: "📜",
    fields: {
      for_whom: { type: "string", description: "'self' or the relationship of the person it is for" },
      existing_will: { type: "string", enum: ["yes", "no", "unknown"] },
      family: { type: "string", description: "Married/partner and children count, minors noted, as stated" },
      owns_home_or_business: { type: "string", enum: ["home", "business", "both", "neither", "unknown"] },
      executor_in_mind: { type: "string", enum: ["yes", "no", "unknown"] },
    },
  },
  trust: {
    icon: "🛡️",
    fields: {
      goal: { type: "string", description: "What they want the trust to accomplish, in their words" },
      beneficiaries: { type: "string", description: "Relationships only (e.g. 'two children, spouse')" },
      existing_plan: { type: "string", enum: ["will", "trust", "both", "none", "unknown"] },
      asset_types: { type: "string", description: "Categories only: home, savings, business, other" },
    },
  },
  lawsuit: {
    icon: "⚖️",
    fields: {
      side: { type: "string", enum: ["plaintiff", "defendant", "unknown"], description: "Suing = plaintiff; being sued = defendant" },
      incident_when: { type: "string", description: "Approximate date of what happened, verbatim, or 'unknown'" },
      court_papers_received: { type: "string", enum: ["yes", "no", "unknown"] },
      papers_deadline: { type: "string", description: "Deadline stated on the papers, verbatim, or 'none'" },
      court_or_county: { type: "string", description: "As stated, or 'unknown'" },
    },
  },
  other: { icon: "💬", fields: {} },
};

// Fold the per-language text onto each type: { label: {en,es,id}, blurb: {...}, questions: {...} }.
const perLang = (typeId, key) => Object.fromEntries(LANGS.map(l => [l, LOCALES[l].matters[typeId][key]]));
export const MATTERS = Object.fromEntries(Object.entries(TYPES).map(([typeId, t]) => [typeId, {
  icon: t.icon,
  label: perLang(typeId, "label"),
  blurb: perLang(typeId, "blurb"),
  questions: perLang(typeId, "questions"),
  fields: t.fields,
}]));

export const MATTER_IDS = Object.keys(MATTERS);
export function matter(typeId) { return MATTERS[MATTER_IDS.includes(typeId) ? typeId : "other"]; }

// Public, language-independent view for the form and the review page.
export function mattersForClient() {
  return Object.fromEntries(Object.entries(MATTERS).map(([typeId, m]) => [typeId, {
    icon: m.icon, label: m.label, blurb: m.blurb, fields: Object.keys(m.fields),
  }]));
}
