/** Approved product glossary — AI translation must not rewrite these silently. */
export const PROTECTED_GLOSSARY = {
  emergency: {
    en: "Emergency",
    bn: "জরুরি",
    hi: "आपातकाल",
    ur: "ہنگامی",
    ta: "அவசரம்",
    te: "అత్యవసర",
  },
  urgent: {
    en: "Urgent",
    bn: "জরুরি",
    hi: "तत्काल",
    ur: "فوری",
    ta: "அவசர",
    te: "అత్యవసర",
  },
  consent: {
    en: "Consent",
    bn: "সম্মতি",
    hi: "सहमति",
    ur: "رضامندی",
    ta: "ஒப்புதல்",
    te: "ఒప్పందం",
  },
  medication: {
    en: "Medication",
    bn: "ওষুধ",
    hi: "दवा",
    ur: "دوا",
    ta: "மருந்து",
    te: "మందు",
  },
} as const;

export type GlossaryTerm = keyof typeof PROTECTED_GLOSSARY;

export function getGlossaryTerm(term: GlossaryTerm, language: keyof (typeof PROTECTED_GLOSSARY)["emergency"]): string {
  return PROTECTED_GLOSSARY[term][language] ?? PROTECTED_GLOSSARY[term].en;
}
