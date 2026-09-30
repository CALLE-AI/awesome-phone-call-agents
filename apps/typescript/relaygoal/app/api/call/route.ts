import { runVerifiedGoal } from "@/src/core/runGoal";
import { FakeCalle } from "@/src/core/fakecalle";
import { maskPhone } from "@/src/core/phone";
import { maskVerifiedOutcome } from "@/src/core/mask-output";
import { findPreset } from "@/src/goals";
import { scenarios } from "@/src/scenarios";

// The browser demo route is FAKE-ONLY: its destinations are canned presets (reserved-fictional
// 555 numbers), so it always runs the credential-free FakeCalle stub and never dials — regardless
// of any environment flags. Real calling is a separate, server-side opt-in path (see
// src/core/livecalle.ts + test/live-smoke.test.ts) that requires an explicitly authorized
// recipient; it is intentionally not reachable from this public, unauthenticated route.
export async function POST(req: Request) {
  let body: { verticalId?: string; presetId?: string; goal?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { verticalId, presetId, goal } = body;
  if (!verticalId || !presetId) {
    return Response.json({ error: "verticalId and presetId are required" }, { status: 400 });
  }

  const found = findPreset(verticalId, presetId);
  if (!found) {
    return Response.json({ error: "unknown goal" }, { status: 404 });
  }
  const { vertical, preset } = found;
  const scenario = scenarios[preset.scenarioId];
  if (!scenario) {
    return Response.json({ error: "no mock scenario for this goal" }, { status: 500 });
  }

  const client = new FakeCalle(scenario);
  const goalText = (goal && goal.trim()) || preset.goalText;

  const outcome = await runVerifiedGoal(client, {
    task: vertical.taskTemplate(goalText),
    phone: preset.phone,
    resultSchema: preset.resultSchema,
    requestedKeys: preset.requestedKeys,
    idempotencyKey: `demo-${verticalId}-${presetId}`,
  });

  return Response.json({
    outcome: maskVerifiedOutcome(outcome),
    goalText,
    presetLabel: preset.label,
    phoneMasked: maskPhone(preset.phone),
    mocked: true,
  });
}
