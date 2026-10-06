export type ActivityTone = "active" | "success" | "warning" | "neutral";

export interface DispatchActivityInput {
  phase: "prepare" | "preview" | "review";
  readiness: "checking" | "ready" | "configuration_required" | "unavailable";
  vendorCount: number;
  safetySafe: boolean;
  confirmed: boolean;
  isCalling: boolean;
  responseStatus: DispatchAggregateStatus | null;
}

export interface DispatchActivityItem {
  label: string;
  value: string;
  tone: ActivityTone;
}

export function buildDispatchActivity(input: DispatchActivityInput): DispatchActivityItem[] {
  const readinessValue =
    input.readiness === "ready"
      ? "Configured"
      : input.readiness === "checking"
        ? "Checking connection"
        : input.readiness === "configuration_required"
          ? "Setup required"
          : "Unavailable";

  const readinessTone: ActivityTone =
    input.readiness === "ready"
      ? "success"
      : input.readiness === "checking"
        ? "neutral"
        : "warning";

  if (input.phase === "prepare") {
    return [
      { label: "Workspace", value: "Drafting request", tone: "active" },
      { label: "CALL-E", value: readinessValue, tone: readinessTone },
      {
        label: "Safety",
        value: input.safetySafe ? "Non-emergency screen active" : "Request blocked",
        tone: input.safetySafe ? "success" : "warning",
      },
      {
        label: "Roster",
        value: `${input.vendorCount} vendor${input.vendorCount === 1 ? "" : "s"} selected`,
        tone: "neutral",
      },
    ];
  }

  if (input.phase === "preview") {
    return [
      { label: "Workspace", value: "Authorization review", tone: "active" },
      { label: "CALL-E", value: readinessValue, tone: readinessTone },
      {
        label: "Approval",
        value: input.isCalling
          ? "Call in progress"
          : input.readiness !== "ready"
            ? "Waiting for CALL-E setup"
          : input.confirmed
            ? "Ready for final action"
            : "Waiting for operator",
        tone:
          input.isCalling
            ? "active"
            : input.confirmed && input.readiness === "ready"
              ? "success"
              : "warning",
      },
      { label: "Authority", value: "Information only", tone: "neutral" },
    ];
  }

  return [
    { label: "Workspace", value: "Evidence review", tone: "active" },
    { label: "CALL-E", value: readinessValue, tone: readinessTone },
    {
      label: "Outcome",
      value: input.responseStatus || "Awaiting evidence",
      tone: input.responseStatus === "completed" ? "success" : "warning",
    },
    { label: "Booking", value: "No booking made", tone: "neutral" },
  ];
}
import type { DispatchAggregateStatus } from "./types";
