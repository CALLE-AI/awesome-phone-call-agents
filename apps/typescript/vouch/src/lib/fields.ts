export const FIELD_LABELS: Record<string, string> = {
  employment_confirmed: "Employment",
  title_stated: "Title",
  start_date_stated: "Start date",
  end_date_stated: "End date",
  eligible_for_rehire: "Eligible for rehire",
  salary_history: "Salary history",
  verifier_name: "Verifier",
  verifier_role: "Role",
  verifier_authority: "Authority to confirm",
  refusal_reason: "Refusal",
};

export const RESULT_ORDER = [
  "employment_confirmed",
  "title_stated",
  "start_date_stated",
  "end_date_stated",
  "eligible_for_rehire",
  "verifier_name",
  "verifier_role",
  "verifier_authority",
  "refusal_reason",
] as const;

export function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field.replaceAll("_", " ");
}

export function prettyValue(value: unknown) {
  if (value == null || value === "") return "—";
  return String(value).replaceAll("_", " ");
}

export function fieldSetHash(fields: readonly string[]) {
  return [...fields].sort().join(",") || "none";
}