import {
  DiningPreferencesSchema,
  missingPreferenceFields,
  normalizeDiningPreferencesResult,
  type DiningPreferences,
  type RequiredPreferenceField,
} from "../domain/dining-preferences.js";
import type { ProviderCallResult } from "../providers/calle/types.js";

export interface VerifiedPreferenceOutcome {
  preferences: DiningPreferences | null;
  usableForSearch: boolean;
  missingFields: readonly RequiredPreferenceField[];
  providerCallId: string | null;
  confidence: number;
  summary: string;
  evidence: readonly string[];
  needsUserInput: boolean;
}

export function verifyPreferenceOutcome(
  raw: ProviderCallResult,
): VerifiedPreferenceOutcome {
  const parsed = DiningPreferencesSchema.safeParse(
    normalizeDiningPreferencesResult(raw.structuredResult),
  );
  const confidence = raw.completionConfidence?.score ?? 0;
  const evidence = raw.evidence.filter((item) => item.trim().length > 0);

  if (
    raw.status !== "completed" ||
    raw.taskCompleted !== true ||
    !parsed.success ||
    evidence.length === 0 ||
    confidence < 0.6
  ) {
    return {
      preferences: parsed.success ? parsed.data : null,
      usableForSearch: false,
      missingFields: parsed.success
        ? missingPreferenceFields(parsed.data)
        : [...missingPreferenceFields(emptyPreferences())],
      providerCallId: raw.providerCallId || null,
      confidence,
      summary:
        "DineLine could not verify a complete dinner request. Please fill in the missing details on screen.",
      evidence,
      needsUserInput: true,
    };
  }

  const missingFields = missingPreferenceFields(parsed.data);
  return {
    preferences: parsed.data,
    usableForSearch: missingFields.length === 0,
    missingFields,
    providerCallId: raw.providerCallId,
    confidence,
    summary:
      missingFields.length === 0
        ? raw.summary ?? "Dinner preferences captured and confirmed."
        : `DineLine captured the request, but still needs: ${missingFields.join(
            ", ",
          )}.`,
    evidence,
    needsUserInput: missingFields.length > 0,
  };
}

function emptyPreferences(): DiningPreferences {
  return {
    location: null,
    cuisine: null,
    date: null,
    time: null,
    timeZone: null,
    partySize: null,
    budget: "unknown",
    atmosphere: null,
    dietaryNeeds: [],
    notes: null,
  };
}
