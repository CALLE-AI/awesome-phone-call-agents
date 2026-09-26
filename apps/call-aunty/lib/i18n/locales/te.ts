import type { TranslationTree } from "../types";
import { en } from "./en";

/** Telugu — V8 namespace keys; falls back to English for missing keys at runtime. */
export const te: TranslationTree = {
  ...en,
  common: {
    ...((en.common as TranslationTree) ?? {}),
    back: "వెనక్కి",
    retry: "మళ్లీ",
    search: "భాషలు శోధించండి",
  },
  settings: {
    ...((en.settings as TranslationTree) ?? {}),
    language: "భాష",
    chooseLanguage: "మీ భాషను ఎంచుకోండి",
    firstLaunchTitle: "స్వాగతం — భాష ఎంచుకోండి",
  },
};
