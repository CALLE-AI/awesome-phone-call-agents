import type { FraudOpsCase } from "./types";

const AUTOMATABLE_PACKS = new Set([
  "needs_kyc",
  "needs_evidence",
  "past_due",
  "merchant_review",
]);

function parseQuietWindow(window: string): { start: number; end: number } {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(window);
  if (!match) {
    throw new Error(`Invalid quiet_hours_local: ${window}`);
  }
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return { start, end };
}

export function inQuietHours(
  quietHoursLocal: string,
  now: Date = new Date(),
  timeZone = "Asia/Hong_Kong"
): boolean {
  const { start, end } = parseQuietWindow(quietHoursLocal);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error("Could not resolve local time for quiet-hours check");
  }
  const mins = hour * 60 + minute;
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

export type GateDecision = {
  automate: boolean;
  reasons: string[];
  handoffIf: string[];
};

export function evaluateGate(
  fraudCase: FraudOpsCase,
  now: Date = new Date()
): GateDecision {
  const reasons: string[] = [];
  if (!AUTOMATABLE_PACKS.has(fraudCase.pack_fired)) {
    reasons.push(`pack ${fraudCase.pack_fired} is not automatable`);
  }
  if (fraudCase.policy.attempt_n >= fraudCase.policy.max_attempts) {
    reasons.push("attempt cap reached");
  }
  if (inQuietHours(fraudCase.policy.quiet_hours_local, now)) {
    reasons.push(`inside quiet hours ${fraudCase.policy.quiet_hours_local} HKT`);
  }
  reasons.push("consent assumed on file (demo)");

  const blocked = reasons.some((reason) => reason !== "consent assumed on file (demo)");

  return {
    automate: !blocked,
    reasons: blocked
      ? reasons.filter((reason) => reason !== "consent assumed on file (demo)")
      : ["pack matches", "attempts remaining", "outside quiet hours", "consent ok"],
    handoffIf:
      fraudCase.intent === "evidence_collection"
        ? [
            "ongoing danger → unsafe_escalate / human immediately",
            "identity fail → HOLD",
            "asks investigator / legal",
            "would need passwords / PAN as “evidence”",
            "max attempts reached",
          ]
        : [
            "identity fail → HOLD",
            "asks investigator / legal",
            "hardship",
            "merchant disputes the review",
            "would need PAN / CVV / full national ID",
            "max attempts reached",
          ],
  };
}
