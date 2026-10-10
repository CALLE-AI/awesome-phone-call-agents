import type { AwsSnapshot } from "../types.js";

export const resultSchema = {
  type: "object",
  required: ["reached_human", "decision", "confirmation_ok", "notes"],
  properties: {
    reached_human: { type: "boolean" },
    voicemail: { type: "boolean" },
    decision: {
      type: "string",
      enum: ["rollback", "scale", "ack", "escalate", "unknown"]
    },
    scale_to: { type: "integer" },
    confirmation_ok: { type: "boolean" },
    escalate_to: { type: "string" },
    notes: { type: "string" }
  }
};

export function confirmationCode(): string {
  return "GO";
}

export function buildBriefing(options: {
  snapshot: AwsSnapshot;
  confirmationCode: string;
  triggerReason: string;
  source: string;
  recommended?: string | null;
  sayOnPhone?: string | null;
  fixCommand?: string | null;
}): string {
  const { snapshot, confirmationCode, triggerReason, source, recommended, sayOnPhone, fixCommand } =
    options;
  const sg = snapshot.securityGroup
    ? `Security group ${snapshot.securityGroup.id} ingress: ${snapshot.securityGroup.ingress.join("; ") || "none"}.`
    : "No security group ID configured.";
  const logs = snapshot.recentLogs.length
    ? `Most recent log lines: ${snapshot.recentLogs.slice(-5).join(" | ")}`
    : "No log group configured or no recent events.";
  const previous = snapshot.previousTaskDefinition
    ? `Previous healthy-looking revision is ${snapshot.previousRevision} (${snapshot.previousTaskDefinition}).`
    : "There is no previous task definition revision available, so rollback is not possible.";

  return [
    `Call the on-call engineer. You are the 3 AM Incident Commander for this AWS account.`,
    `This is a real production page. Source: ${source}. Trigger: ${triggerReason}.`,
    `Wake them. Speak calmly and slowly. Do not invent AWS facts. Only use the telemetry below.`,
    `Live snapshot taken at ${snapshot.gatheredAt} in ${snapshot.region}, account ${snapshot.accountId}.`,
    `ECS cluster ${snapshot.cluster}, service ${snapshot.service}, status ${snapshot.serviceStatus}.`,
    `Running ${snapshot.runningCount}, desired ${snapshot.desiredCount}, pending ${snapshot.pendingCount}.`,
    `Current task definition revision ${snapshot.currentRevision}: ${snapshot.currentTaskDefinition}.`,
    previous,
    snapshot.alarm.name
      ? `CloudWatch alarm ${snapshot.alarm.name} is ${snapshot.alarm.state}. Reason: ${snapshot.alarm.reason ?? "n/a"}.`
      : "No CloudWatch alarm name was provided.",
    snapshot.cpuPercent !== null ? `Average CPU last 15 minutes: ${snapshot.cpuPercent}%.` : "",
    snapshot.target5xx !== null ? `ALB target 5xx count last 15 minutes: ${snapshot.target5xx}.` : "",
    snapshot.unhealthyTargets !== null ? `Unhealthy target count: ${snapshot.unhealthyTargets}.` : "",
    `Recent ECS events: ${snapshot.events.slice(0, 3).join(" || ") || "none"}.`,
    sg,
    logs,
    recommended
      ? `Recommended action is ${recommended}.`
      : "",
    `Keep the briefing short. Then ask them what to do.`,
    sayOnPhone
      ? `A short line they can say is: ${sayOnPhone.replace("{code}", confirmationCode)}`
      : `Easy example: Scale four. Confirm go.`,
    `Accept heavy accents and imperfect English. Accept close matches: scale / scale it / scale to 4 / scale four / roll back / rollback / ack / yes.`,
    `The confirmation word is GO. Accept go, G O, goal if they meant go, okay go, confirm go.`,
    `Set confirmation_ok true if they clearly chose an action, even if they did not repeat the sentence word for word.`,
    `Do not ask them to repeat a long sentence. Do not invent extra security questions.`,
    `If you reach voicemail, set reached_human false.`,
    `When you have their action, read it back in a few words, then end the call.`
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildResultBriefing(options: {
  snapshot: AwsSnapshot;
  post: AwsSnapshot;
  executionSummary: string;
}): string {
  const { snapshot, post, executionSummary } = options;
  return [
    `Call the on-call engineer with an incident follow-up. Do not ask them to decide anything.`,
    `Tell them the action result: ${executionSummary}.`,
    `Before: revision ${snapshot.currentRevision}, running ${snapshot.runningCount}, desired ${snapshot.desiredCount}.`,
    `After: revision ${post.currentRevision}, running ${post.runningCount}, desired ${post.desiredCount}, pending ${post.pendingCount}.`,
    post.alarm.name ? `Alarm ${post.alarm.name} is now ${post.alarm.state}.` : "",
    `Keep the call under 45 seconds. Confirm they heard the result, then hang up.`
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildEscalateBriefing(options: {
  snapshot: AwsSnapshot;
  triggerReason: string;
  notes: string;
}): string {
  const { snapshot, triggerReason, notes } = options;
  return [
    `Call the secondary on-call. The primary engineer asked to escalate this incident.`,
    `Trigger: ${triggerReason}.`,
    `Service ${snapshot.service} in ${snapshot.cluster}, revision ${snapshot.currentRevision}, running ${snapshot.runningCount}/${snapshot.desiredCount}.`,
    `Primary notes: ${notes || "none"}.`,
    `Brief them. Ask them to stay on the line only to confirm they are taking the incident. Do not execute AWS from this call.`
  ].join(" ");
}
