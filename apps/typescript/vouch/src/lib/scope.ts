/**
 * Consent + jurisdiction → permitted field set.
 * Enforced in code: a field absent from the permitted set cannot reach the task string.
 * Source: docs/build-plan.md §6.2.
 */

export const ALL_REQUESTABLE = [
  "employment_confirmed",
  "title_stated",
  "start_date_stated",
  "end_date_stated",
  "eligible_for_rehire",
  "salary_history",
] as const;

export type RequestableField = (typeof ALL_REQUESTABLE)[number];

export function permittedFields(input: {
  requested: readonly string[];
  jurisdiction: string;
  consentFields: readonly string[];
}): { permitted: string[]; blocked: Array<{ field: string; reason: string }> } {
  const blocked: Array<{ field: string; reason: string }> = [];
  const permitted: string[] = [];

  for (const field of input.requested) {
    if (!input.consentFields.includes(field)) {
      blocked.push({ field, reason: "outside consent scope" });
      continue;
    }
    if (field === "salary_history" && input.jurisdiction === "US-CA") {
      blocked.push({ field, reason: "California SB 1162" });
      continue;
    }
    permitted.push(field);
  }

  return { permitted, blocked };
}

export function compileVouchTask(input: {
  employer: string;
  candidate: string;
  consentDate: string;
  requestingOrg: string;
  employerCode: string;
  permitted: readonly string[];
}): string {
  const permittedList = input.permitted
    .map((field) => `- ${field.replaceAll("_", " ")}`)
    .join("\n");
  return `You are calling ${input.employer} to verify employment for ${input.candidate}, who gave written
authorization dated ${input.consentDate}. Identify yourself as an automated verification assistant
acting for ${input.requestingOrg}.

If you reach a phone menu, navigate to Human Resources or employment verification.
If asked for an employer code, use ${input.employerCode}.

Confirm ONLY the following:
${permittedList}

You are NOT authorized to ask about compensation or salary history, reason for separation,
medical or disability information, or job performance.

Before recording any answer, ask for the person's name and role, and whether they are
authorized to confirm employment for the company.

If they say verification is handled only through a third-party service, record that and end
the call. Do not attempt to persuade.`;
}
