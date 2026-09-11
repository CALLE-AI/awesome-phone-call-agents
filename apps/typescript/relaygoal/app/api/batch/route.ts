import { runVerifiedBatch } from "@/src/core/batch";
import { FakeCalle } from "@/src/core/fakecalle";
import { selectCalleClient } from "@/src/core/livecalle";
import { maskPhone } from "@/src/core/phone";
import { findBatchPreset } from "@/src/goals";
import { batchScenarios } from "@/src/scenarios";
import type { CreateCallInput } from "@/src/core/types";

// Batch "compare across N places": one canned scenario per recipient phone (dry-run default),
// run through the real runVerifiedBatch reconciler. When RELAYGOAL_LIVE=1 + CALLE_API_KEY is set,
// selectCalleClient returns the live adapter and the same reconciler places real calls per place.
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
  const { client, live } = await selectCalleClient(fake);

  const outcome = await runVerifiedBatch(client, {
    task: preset.task,
    recipients: preset.recipients.map(({ id, label, phone }) => ({ id, label, phone })),
    resultSchema: preset.resultSchema,
    requestedKeys: preset.requestedKeys,
    rank: preset.rank,
  });

  // Mask every recipient number before it leaves the server.
  outcome.items = outcome.items.map((it) => ({
    ...it,
    recipient: { ...it.recipient, phone: maskPhone(it.recipient.phone) },
  }));

  return Response.json({ outcome, presetLabel: preset.label, mocked: !live });
}
