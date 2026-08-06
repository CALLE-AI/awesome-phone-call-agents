export type NavigationId = "today" | "seniors" | "routines" | "attention" | "settings";

export type RoutineKind = "medication" | "meal";

export type RoutineStatus = "active" | "paused";

export type TimelineStatus =
  | "self-reported-taken"
  | "self-reported-ate"
  | "due"
  | "upcoming"
  | "needs-caregiver"
  | "no-answer";

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
