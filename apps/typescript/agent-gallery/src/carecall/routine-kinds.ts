import type { IconName } from "../components/Icon";
import type { RoutineKind } from "./types";

/**
 * How each routine kind presents and what its call is planned to cover.
 *
 * The conversation plan is derived here rather than authored per routine, so
 * the preview an operator reads always describes what the agent is actually
 * instructed to do. The parts an operator does control — the caregiver
 * instruction and the trust phrase — are the parts that reach the provider.
 */

export interface ConversationStep {
  title: string;
  detail: string;
}

export interface RoutineKindProfile {
  kind: RoutineKind;
  label: string;
  callLabel: string;
  icon: IconName;
  /** Shown in the builder so an operator can tell the kinds apart. */
  purpose: string;
  instructionLabel: string;
  instructionPlaceholder: string;
  trustPhrasePlaceholder: string;
  /** Step three differs per kind; the surrounding steps stay constant. */
  recordStep: ConversationStep;
  askStepTitle: string;
  /** Stated in the preview so an operator can see the boundary before authorizing. */
  boundary: string;
}

export const routineKindProfiles: Record<RoutineKind, RoutineKindProfile> = {
  medication: {
    kind: "medication",
    label: "Medication",
    callLabel: "Medication reminder",
    icon: "medication",
    purpose: "Repeat a caregiver-approved medication reminder and record what the senior says.",
    instructionLabel: "Caregiver-approved reminder",
    instructionPlaceholder: "Remind Mdm Lim to take the medication prepared in the morning compartment.",
    trustPhrasePlaceholder: "Joanne asked me to call about your morning routine.",
    askStepTitle: "Repeat the approved reminder",
    recordStep: {
      title: "Record only a self-report",
      detail: "Ask whether the senior reports already taking it, will do so shortly, or is unsure.",
    },
    boundary: "The agent gives no dosage, missed-dose, or repeat-dose advice, and never treats silence as a dose taken.",
  },
  meal: {
    kind: "meal",
    label: "Meal",
    callLabel: "Meal check-in",
    icon: "food",
    purpose: "Check that the senior has food available and record whether they say they have eaten.",
    instructionLabel: "Caregiver-approved check-in",
    instructionPlaceholder: "Ask whether Mdm Lim has had dinner and whether food is available.",
    trustPhrasePlaceholder: "Joanne asked me to check in about your dinner.",
    askStepTitle: "Check food access first",
    recordStep: {
      title: "Record only a self-report",
      detail: "Ask whether the senior reports eating, plans to eat shortly, or needs help accessing food.",
    },
    boundary: "The agent gives no dietary or medical advice, and never records silence as a meal eaten.",
  },
  hydration: {
    kind: "hydration",
    label: "Hydration",
    callLabel: "Hydration reminder",
    icon: "droplet",
    purpose: "Remind the senior to drink and record whether a drink is within reach.",
    instructionLabel: "Caregiver-approved reminder",
    instructionPlaceholder: "Remind Mdm Lim to drink a glass of water and check that the flask is within reach.",
    trustPhrasePlaceholder: "Joanne asked me to remind you about drinking water today.",
    askStepTitle: "Check a drink is within reach",
    recordStep: {
      title: "Record only a self-report",
      detail: "Ask whether the senior reports drinking, will drink shortly, or has nothing within reach.",
    },
    boundary: "The agent sets no fluid target and gives no medical advice about how much to drink.",
  },
  wellbeing: {
    kind: "wellbeing",
    label: "Wellbeing",
    callLabel: "Wellbeing check-in",
    icon: "heart",
    purpose: "A short, open check-in that records what the senior chooses to say and escalates concern to a human.",
    instructionLabel: "Caregiver-approved opening question",
    instructionPlaceholder: "Ask Mdm Lim how her day has been and whether she would like Joanne to call.",
    trustPhrasePlaceholder: "Joanne asked me to check how you are doing today.",
    askStepTitle: "Ask one open question",
    recordStep: {
      title: "Record only what was said",
      detail: "Record the senior's own words about how they are, or that they preferred not to say.",
    },
    boundary: "The agent does not assess mood, screen for any condition, counsel, or interpret what it hears. Anything beyond a plain \"I am well\" goes to a human.",
  },
  appointment: {
    kind: "appointment",
    label: "Appointment",
    callLabel: "Appointment reminder",
    icon: "calendar",
    purpose: "Remind the senior of an appointment a caregiver has already confirmed, and record whether they can attend.",
    instructionLabel: "Caregiver-confirmed appointment details",
    instructionPlaceholder: "Remind Mdm Lim of her polyclinic review on Thursday at 10:00 AM.",
    trustPhrasePlaceholder: "Joanne asked me to remind you about an appointment this week.",
    askStepTitle: "Repeat the confirmed details",
    recordStep: {
      title: "Record only a self-report",
      detail: "Ask whether the senior expects to attend, needs transport, or cannot make it.",
    },
    boundary: "The agent repeats only the details the caregiver supplied. It never books, moves, or cancels an appointment, and never fills in a detail it was not given.",
  },
};

export const routineKindOrder: RoutineKind[] = ["medication", "meal", "hydration", "wellbeing", "appointment"];

export function routineKindProfile(kind: RoutineKind): RoutineKindProfile {
  return routineKindProfiles[kind] ?? routineKindProfiles.medication;
}

/** The four-step plan shown before authorization, constant in shape across kinds. */
export function conversationPlanFor(kind: RoutineKind, preferredName: string, caregiver: string): ConversationStep[] {
  const profile = routineKindProfile(kind);
  return [
    { title: "Identify and reassure", detail: `Confirm that ${preferredName} is speaking, and explain why the call was authorized.` },
    { title: profile.askStepTitle, detail: "Use the caregiver-approved wording, one question at a time." },
    profile.recordStep,
    { title: "Escalate uncertainty", detail: `Offer a callback from ${caregiver}; never fill in an ambiguous answer.` },
  ];
}
