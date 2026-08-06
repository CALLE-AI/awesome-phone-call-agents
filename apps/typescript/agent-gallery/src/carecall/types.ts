export type NavigationId = "today" | "calls" | "seniors" | "routines" | "attention" | "settings";

export type RoutineKind = "medication" | "meal";

export type RoutineStatus = "active" | "paused";

export type TimelineStatus =
  | "self-reported-taken"
  | "self-reported-ate"
  | "due"
  | "upcoming"
  | "needs-caregiver"
  | "no-answer";

export type SeniorStatus = "active" | "withdrawn";

export interface Senior {
  id: string;
  name: string;
  preferredName: string;
  initials: string;
  language: string;
  callWindow: string;
  caregiver: string;
  caregiverRelationship: string;
  phoneMasked: string;
  lastContact: string;
  nextReminder: string;
  nextReminderLabel: string;
  attentionCount: number;
  avatar: "blue" | "lilac" | "mint" | "sand";
  status: SeniorStatus;
  withdrawnOn?: string;
}

/**
 * The fields an operator may change directly. The phone number is deliberately
 * absent: the record stores only a masked number, and the E.164 number is
 * supplied at authorization time, so there is nothing here to edit.
 */
export interface SeniorEdit {
  name: string;
  preferredName: string;
  language: string;
  /** 24-hour `HH:MM`, composed into the stored display window on save. */
  callWindowFrom: string;
  callWindowTo: string;
  caregiver: string;
  caregiverRelationship: string;
}

export interface CareRoutine {
  id: string;
  seniorId: string;
  kind: RoutineKind;
  title: string;
  caregiverInstruction: string;
  schedule: string;
  nextRun: string;
  status: RoutineStatus;
  trustPhrase: string;
}

export interface TimelineItem {
  id: string;
  seniorId: string;
  routineId: string;
  time: string;
  title: string;
  kind: RoutineKind;
  status: TimelineStatus;
  statusLabel: string;
  detail: string;
}

export interface AttentionCase {
  id: string;
  seniorId: string;
  routineId: string;
  priority: "contact-now" | "today" | "review";
  priorityLabel: string;
  title: string;
  createdAt: string;
  context: string;
  nextAction: string;
}
