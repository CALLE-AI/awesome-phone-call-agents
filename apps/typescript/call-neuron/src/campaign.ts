export type RecipientStatus = "eligible" | "blocked";
export type ProviderSignal = string;
export type Disposition =
  | "unreviewed"
  | "interested"
  | "needs_information"
  | "not_interested"
  | "opted_out"
  | "unreachable";

export type Recipient = {
  id: string;
  studentName: string;
  studentCode: string;
  recipientName: string;
  phone: string;
  recipientType: "guardian" | "adult_student";
  employeeCode: string;
  consentSource: string;
  consentTimestamp: string;
  status: RecipientStatus;
  blocker?: string;
};

export type CampaignResult = {
  recipientId: string;
  providerSignal: ProviderSignal;
  summary: string;
  transcript: string;
  attemptedAt: string;
};

export function maskPhone(phone: string) {
  return `${phone.slice(0, 2)}${"•".repeat(Math.max(0, phone.length - 6))}${phone.slice(-4)}`;
}

const resolvedDispositions = new Set<Disposition>([
  "interested",
  "needs_information",
  "not_interested",
  "opted_out",
]);

export function campaignMetrics(results: CampaignResult[], dispositions: Record<string, Disposition>) {
  const resolved = results.filter((result) => resolvedDispositions.has(dispositions[result.recipientId] || "unreviewed")).length;
  const followUp = results.filter((result) => {
    const disposition = dispositions[result.recipientId] || "unreviewed";
    return result.providerSignal === "voicemail" || disposition === "unreviewed" || disposition === "needs_information" || disposition === "unreachable";
  }).length;
  return {
    attempted: results.length,
    resolved,
    followUp,
    resolutionRate: results.length ? Math.round((resolved / results.length) * 100) : 0,
  };
}

export function safeCsvCell(value: string | number) {
  const text = String(value);
  const neutralized = /^[=+\-@]/u.test(text) ? `'${text}` : text;
  return /[",\r\n]/u.test(neutralized) ? `"${neutralized.replaceAll('"', '""')}"` : neutralized;
}

type ExportableResult = Pick<CampaignResult, "recipientId" | "attemptedAt"> & { providerSignal: string };

export function buildCampaignCsv(results: ExportableResult[], dispositions: Record<string, Disposition>, recipients: Recipient[]) {
  const header = [
    "student_code",
    "employee_code",
    "provider_signal",
    "operator_disposition",
    "needs_follow_up",
    "attempts",
    "attempted_at",
  ];
  const rows = results.map((result) => {
    const recipient = recipients.find((item) => item.id === result.recipientId);
    const disposition = dispositions[result.recipientId] || "unreviewed";
    const needsFollowUp = result.providerSignal === "voicemail" || disposition === "unreviewed" || disposition === "needs_information" || disposition === "unreachable";
    return [
      recipient?.studentCode || "unknown",
      recipient?.employeeCode || "unknown",
      result.providerSignal,
      disposition,
      needsFollowUp ? "yes" : "no",
      1,
      result.attemptedAt,
    ];
  });
  return [header, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n");
}
