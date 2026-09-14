import { runVerifiedBatch } from "@/src/core/batch";
import { FakeCalle } from "@/src/core/fakecalle";
import { maskPhone } from "@/src/core/phone";
import { maskBatchOutcome } from "@/src/core/mask-output";
import { findBatchPreset } from "@/src/goals";
import { batchScenarios } from "@/src/scenarios";
import type { CreateCallInput } from "@/src/core/types";

// Batch "compare across N places": FAKE-ONLY, like the single-call route. Its recipients are canned
// reserved-fictional 555 presets, so it always runs the FakeCalle stub and never dials, regardless of
// environment flags. Real calling lives only in the server-side opt-in path with authorized recipients.
export async function POST(req: Request) {
  let body: { presetId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.presetId) return Response.json({ error: "presetId is required" }, { status: 400 });
  const preset = findBatchPreset(body.presetId);
  if (!preset) return Response.json({ error: "unknown batch goal" }, { status: 404 });

  const byPhone = new Map(preset.recipients.map((r) => [r.phone, batchScenarios[r.scenarioId]]));
  const fake = new FakeCalle((input: CreateCallInput) => {
    const scenario = byPhone.get(input.phone);
    if (!scenario) throw new Error(`no mock scenario for ${maskPhone(input.phone)}`);
    return scenario;
  });
  const raw = await runVerifiedBatch(fake, {
    task: preset.task,
    recipients: preset.recipients.map(({ id, label, phone }) => ({ id, label, phone })),
    resultSchema: preset.resultSchema,
    requestedKeys: preset.requestedKeys,
    rank: preset.rank,
  });

  // Mask phone-bearing transcript/evidence/result text, then the recipient numbers themselves.
  const outcome = maskBatchOutcome(raw);
  outcome.items = outcome.items.map((it) => ({
    ...it,
    recipient: { ...it.recipient, phone: maskPhone(it.recipient.phone) },
  }));

  return Response.json({ outcome, presetLabel: preset.label, mocked: true });
}
