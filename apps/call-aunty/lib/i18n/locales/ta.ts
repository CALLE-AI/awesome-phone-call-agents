import type { TranslationTree } from "../types";
import { en } from "./en";

/** Tamil — V8 namespace keys; falls back to English for missing keys at runtime. */
export const ta: TranslationTree = {
  ...en,
  common: {
    ...((en.common as TranslationTree) ?? {}),
    back: "பின்செல்",
    retry: "மீண்டும்",
    search: "மொழி தேடு",
  },
  settings: {
    ...((en.settings as TranslationTree) ?? {}),
    language: "மொழி",
    chooseLanguage: "உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்",
    firstLaunchTitle: "வரவேற்கிறோம் — மொழியைத் தேர்வு செய்யவும்",
  },
};
