interface EmergencyPattern {
  label: string;
  pattern: RegExp;
}

const emergencyPatterns: EmergencyPattern[] = [
  { label: "gas leak or odor", pattern: /\b(gas (?:leak|odor|smell)|smell(?:s)? of gas)\b/i },
  { label: "fire or smoke", pattern: /\b(fire|flames?|smoke|burning smell)\b/i },
  { label: "medical emergency", pattern: /\b(medical emergency|unconscious|not breathing|severe bleeding)\b/i },
  { label: "active crime", pattern: /\b(active crime|break[- ]?in|intruder|assault|weapon)\b/i },
  { label: "trapped person", pattern: /\b(trapped|entrap(?:ped|ment)|cannot get out)\b/i },
  { label: "live electrical danger", pattern: /\b(exposed live wir(?:e|es|ing)|sparking|electrical fire)\b/i },
  { label: "structural collapse", pattern: /\b(structural collapse|collapsing|cave[- ]?in)\b/i },
];

export interface SafetyScreenResult {
  safe: boolean;
  matches: string[];
  message: string | null;
}

export function screenForEmergency(issue: string): SafetyScreenResult {
  const matches = emergencyPatterns
    .filter(({ pattern }) => pattern.test(issue))
    .map(({ label }) => label);

  if (matches.length === 0) {
    return { safe: true, matches: [], message: null };
  }

  return {
    safe: false,
    matches,
    message:
      "This may be an emergency. Do not use Bellwrench—follow the property's emergency process and contact the appropriate local emergency service.",
  };
}

