import type { AppLanguage } from "@/lib/language";

export type { AppLanguage };

/** BCP-47-ish locale tag for Intl formatters. */
export type LocaleTag = string;

export type WritingDirection = "ltr" | "rtl";

export type TranslationStatus = "complete" | "partial" | "draft" | "missing";

export type LanguageDefinition = {
  code: AppLanguage;
  displayName: string;
  nativeDisplayName: string;
  locale: LocaleTag;
  direction: WritingDirection;
  pluralRules: Intl.PluralRules;
  translationStatus: TranslationStatus;
  voiceCapable: boolean;
  calleSpokenCapable: boolean;
  offlinePackAvailable: boolean;
};

export type LanguagePreferenceKind = "ui" | "call" | "ai" | "notification" | "report";

export type LanguagePreferences = {
  ui: AppLanguage;
  call: string;
  ai: AppLanguage;
  notification: AppLanguage;
  report: AppLanguage;
};

export type Namespace =
  | "common"
  | "errors"
  | "billing"
  | "calls"
  | "settings"
  | "onboarding";

export type TranslationTree = {
  [key: string]: string | TranslationTree;
};

export type InterpolationValues = Record<string, string | number>;
