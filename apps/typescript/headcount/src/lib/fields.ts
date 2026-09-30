export const FIELD_LABELS: Record<string, string> = {
  safety_status: "Safety",
  evacuation: "Evacuation",
  has_power: "Power",
  has_water: "Water",
  medication: "Medication",
  household: "Household",
  needs_human: "Needs human",
};

export const FIELD_ORDER = [
  "safety_status",
  "evacuation",
  "has_power",
  "has_water",
  "medication",
  "household",
  "needs_human",
] as const;

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

export function prettyValue(value: unknown): string {
  return String(value).replaceAll("_", " ");
}
