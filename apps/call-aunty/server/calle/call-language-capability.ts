import {
  CALLE_CAPABILITY,
  isSupportedCallLanguage,
  type CalleCallLanguage,
} from "./capabilities";

export type CallLanguageResolution = {
  requested: string;
  effective: CalleCallLanguage | null;
  supported: boolean;
  fallbackChain: string[];
  messageCode: "supported" | "fallback_applied" | "unsupported" | "interpreter_recommended";
  alternatives: CalleCallLanguage[];
  preservePreference: boolean;
};

const UI_TO_CALL_MAP: Record<string, string> = {
  bn: "bn",
  en: "en",
  hi: "hi",
  ur: "ur",
  ta: "ta",
  te: "te",
  es: "es",
  fr: "fr",
};

function normalizeCallLanguage(code: string): string {
  return code.trim().toLowerCase();
}

function pickSupportedFallback(requested: string, backup?: string, orgDefault?: string): CalleCallLanguage | null {
  const candidates = [backup, orgDefault, "en", ...CALLE_CAPABILITY.supportedCallLanguages].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const normalized = normalizeCallLanguage(candidate);
    if (normalized === requested) continue;
    if (isSupportedCallLanguage(normalized)) {
      return normalized as CalleCallLanguage;
    }
  }
  return isSupportedCallLanguage("en") ? "en" : null;
}

/**
 * Runtime CALL-E language capability resolver.
 * Never fabricates provider support for Bangla or other unsupported spoken languages.
 */
export function resolveCallLanguage(input: {
  requested: string;
  backup?: string;
  organizationDefault?: string;
  interpreterNeeded?: boolean;
}): CallLanguageResolution {
  const requested = normalizeCallLanguage(input.requested || UI_TO_CALL_MAP.en);
  const alternatives = [...CALLE_CAPABILITY.supportedCallLanguages];

  if (isSupportedCallLanguage(requested)) {
    return {
      requested,
      effective: requested as CalleCallLanguage,
      supported: true,
      fallbackChain: [requested],
      messageCode: input.interpreterNeeded ? "interpreter_recommended" : "supported",
      alternatives,
      preservePreference: true,
    };
  }

  const effective = pickSupportedFallback(requested, input.backup, input.organizationDefault);
  const fallbackChain = effective ? [requested, effective] : [requested];

  return {
    requested,
    effective,
    supported: false,
    fallbackChain,
    messageCode: effective ? "fallback_applied" : "unsupported",
    alternatives,
    preservePreference: true,
  };
}

export function mapUiLanguageToCallPreference(uiLanguage: string): string {
  return UI_TO_CALL_MAP[uiLanguage] ?? uiLanguage;
}
