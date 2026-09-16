import { maskPhoneNumber, redactPhoneNumbers } from "../safety/phone";

export interface FamilyMembership {
  readonly canManageContacts: boolean;
  readonly canManageReminders: boolean;
  readonly canViewCallContent: boolean;
  readonly role: "owner" | "family" | "carer";
  readonly seniorId: string;
}

export interface FamilySenior {
  readonly approximateLocation?: string;
  readonly displayName: string;
  readonly id: string;
  readonly interests: readonly string[];
  readonly timezone: string;
}

export interface FamilyContact {
  readonly destination: string;
  readonly displayName: string;
  readonly id: string;
  readonly relationship?: string;
  readonly seniorId: string;
}

export interface FamilyCall {
  readonly endedAt?: string;
  readonly id: string;
  readonly startedAt?: string;
  readonly status: string;
  readonly summary?: string;
  readonly seniorId: string;
}

export interface FamilyAction {
  readonly action: string;
  readonly destination: string;
  readonly id: string;
  readonly purpose: string;
  readonly state: string;
  readonly seniorId: string;
}

export interface FamilyReminder {
  readonly channel: string;
  readonly destination: string;
  readonly id: string;
  readonly message: string;
  readonly scheduledFor: string;
  readonly seniorId: string;
  readonly status: string;
  readonly timezone: string;
}

export interface FamilySms {
  readonly id: string;
  readonly purpose: string;
  readonly seniorId: string;
  readonly status: string;
}

export interface FamilyPreference {
  readonly retentionDays: number;
  readonly seniorId: string;
  readonly storeSummaries: boolean;
  readonly storeTranscripts: boolean;
}

export interface FamilyWorkspace {
  readonly actions: readonly FamilyAction[];
  readonly calls: readonly FamilyCall[];
  readonly contacts: readonly FamilyContact[];
  readonly memberships: readonly FamilyMembership[];
  readonly preferences: readonly FamilyPreference[];
  readonly reminders: readonly FamilyReminder[];
  readonly seniors: readonly FamilySenior[];
  readonly sms: readonly FamilySms[];
}

export function safeDashboardText(value: unknown, maximum = 500): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return redactPhoneNumbers(text).replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, maximum);
}

export function maskedDestination(value: unknown): string {
  return typeof value === "string" && value.replace(/[^0-9]/g, "").length >= 4
    ? maskPhoneNumber(value)
    : "Not available";
}

export function lastCompletedCall(calls: readonly FamilyCall[], seniorId: string): FamilyCall | undefined {
  return calls
    .filter((call) => call.seniorId === seniorId && call.status === "completed" && call.endedAt)
    .sort((left, right) => Date.parse(right.endedAt ?? "") - Date.parse(left.endedAt ?? ""))[0];
}
