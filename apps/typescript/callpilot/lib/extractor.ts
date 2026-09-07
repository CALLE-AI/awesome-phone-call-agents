import type { Mission, StructuredResult } from "@/types";
import type { CalleCallResult } from "@/services/calle/calleClient";

export function extractResult(mission: Mission, calle: CalleCallResult): StructuredResult {
  const s = (calle.structured ?? {}) as Record<string, unknown>;
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const availRaw = Array.isArray(s["availability"]) ? (s["availability"] as unknown[]) : [];
  const availability = availRaw.slice(0, 10).map((a) => {
    if (typeof a === "object" && a !== null) {
      const o = a as Record<string, unknown>;
      return { date: String(o["date"] ?? "Example Date"), time: String(o["time"] ?? "Example Time") };
    }
    return { date: "Example Date", time: String(a) };
  });
  const planQs = mission.plan?.questions ?? [];
  const notesJoined = [...arr(s["notes"]), ...calle.evidence].join(" ").toLowerCase();
  const answered = planQs.filter((q) => {
    const keys = q.toLowerCase().split(/\W+/).filter((w) => w.length > 4).slice(0, 4);
    return keys.some((k) => notesJoined.includes(k));
  });
  const unanswered = planQs.filter((q) => !answered.includes(q));
  const summaryBits: string[] = [];
  summaryBits.push(calle.provider === "calle-mock" ? "Demo run (mocked, no real call)." : `Live CALL-E call ${calle.callId} ended with status ${calle.status}.`);
  if (typeof s["summary"] === "string" && s["summary"]) summaryBits.push(String(s["summary"]));
  else if (answered.length) summaryBits.push(`Covered ${answered.length}/${planQs.length} planned questions.`);
  else summaryBits.push((arr(s["notes"])[0] ?? calle.evidence[0] ?? "Conversation completed; see transcript excerpt.").slice(0, 300));
  const objectiveAchieved = bool(s["objective_achieved"], calle.taskCompleted ?? calle.status === "completed");
  return {
    status: calle.status,
    objective_achieved: objectiveAchieved,
    availability,
    price: typeof s["price"] === "string" ? (s["price"] as string) : null,
    requirements: arr(s["requirements"]),
    notes: arr(s["notes"]).length ? arr(s["notes"]) : calle.evidence.slice(0, 8),
    next_action: typeof s["next_action"] === "string" && s["next_action"] ? String(s["next_action"]) : mission.safetyMode === "info_only" ? "Review info — no commitments made" : "User approval required before confirming",
    confidence: typeof calle.confidence === "number" ? calle.confidence : 0.75,
    questionsAnswered: answered,
    questionsUnanswered: unanswered,
    entities: mission.plan ? [mission.plan.target, mission.phoneE164] : [mission.phoneE164],
    constraintsSatisfied: mission.plan?.constraints ?? [],
    transcriptExcerpt: calle.transcript.slice(0, 12),
    summary: summaryBits.join(" "),
    recommendedNextStep: objectiveAchieved ? (mission.safetyMode === "info_only" ? "Review the options and tell CallPilot which one to pursue." : "Approve the preferred option in the mission view to proceed.") : "Retry with a refined goal or a different time window.",
  };
}
