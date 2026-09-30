export const TOOL_PERMISSIONS = {
  search_web: "read-only",
  send_sms: "side-effect",
  create_reminder: "side-effect",
  contact_trusted_person: "side-effect",
  place_outbound_call: "side-effect",
} as const;

export type ToolName = keyof typeof TOOL_PERMISSIONS;

export function mayRunAutomatically(toolName: ToolName): boolean {
  return TOOL_PERMISSIONS[toolName] === "read-only";
}

export type ConversationBoundary =
  | "general-information"
  | "medical-diagnosis"
  | "medication-change"
  | "high-risk-legal"
  | "high-risk-financial"
  | "emergency"
  | "impersonation";

export interface ConversationDecision {
  readonly allowed: boolean;
  readonly direction: string;
}

export function assessConversationBoundary(
  boundary: ConversationBoundary,
): ConversationDecision {
  switch (boundary) {
    case "general-information":
      return { allowed: true, direction: "Give concise general information and name uncertainty." };
    case "emergency":
      return {
        allowed: false,
        direction: "Encourage contacting local emergency services or a trusted person now.",
      };
    case "medical-diagnosis":
    case "medication-change":
      return {
        allowed: false,
        direction: "Do not diagnose or change medication; encourage an appropriate clinician.",
      };
    case "high-risk-legal":
    case "high-risk-financial":
      return {
        allowed: false,
        direction: "Give no personalized high-risk advice; encourage a qualified human adviser.",
      };
    case "impersonation":
      return {
        allowed: false,
        direction: "Identify as AI and do not impersonate a person or professional.",
      };
  }
}
