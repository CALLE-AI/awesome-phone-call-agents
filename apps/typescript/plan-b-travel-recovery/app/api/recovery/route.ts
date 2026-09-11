import { CalleClient } from "@call-e/calle";
import { isCompletedRecoveryOption, resolveRecipientConfiguration } from "@/lib/recovery-rules";

export const runtime = "nodejs";
export const maxDuration = 300;

const CALL_RESULT_TIMEOUT_MS = 110_000;

type ProviderResult = {
  viable?: boolean;
  provider_name?: string;
  arrival_time?: string;
  extra_cost?: number;
  decision_reason?: string;
  confirmation_reference?: string;
};

type CallLog = {
  provider: string;
  durationMs: number;
  decision: "accepted" | "rejected" | "unreachable";
  callId: string;
  returnedJson: ProviderResult | null;
};

const resultSchema = {
  type: "object" as const,
  required: ["viable", "provider_name", "arrival_time", "extra_cost", "decision_reason", "confirmation_reference"],
  properties: {
    viable: { type: "boolean" as const },
    provider_name: { type: "string" as const },
    arrival_time: { type: "string" as const },
    extra_cost: { type: "number" as const },
    decision_reason: { type: "string" as const },
    confirmation_reference: { type: "string" as const },
  },
};

function liveModeEnabled() {
  return process.env.ENABLE_LIVE_CALLS === "true"
    && Boolean(process.env.CALLE_API_KEY)
    && Boolean(process.env.LIVE_DEMO_ACCESS_CODE);
}

export async function GET() {
  return Response.json({ liveAvailable: liveModeEnabled() });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      mode?: string;
      phones?: string[];
      accessCode?: string;
      runId?: string;
    };

    if (body.mode !== "live") return Response.json({ error: "Use the client-side Safe Demo for demo runs." }, { status: 400 });
    if (!liveModeEnabled()) return Response.json({ error: "Live CALL-E Mode is disabled on this deployment." }, { status: 404 });
    if (body.accessCode !== process.env.LIVE_DEMO_ACCESS_CODE) return Response.json({ error: "Invalid team access code." }, { status: 403 });
    if (!body.runId || !/^[a-zA-Z0-9-]{8,80}$/.test(body.runId)) return Response.json({ error: "A valid recovery run ID is required." }, { status: 400 });

    const phones = (body.phones || [])
      .map((phone) => phone.replace(/[\s()-]/g, ""))
      .filter((phone) => /^\+[1-9]\d{7,14}$/.test(phone))
      .slice(0, 2);
    if (phones.length !== 2) return Response.json({ error: "Two valid E.164 test phone numbers are required." }, { status: 400 });

    const recipientConfigurations = phones.map(resolveRecipientConfiguration);
    if (recipientConfigurations.some((configuration) => !configuration)) {
      return Response.json({
        error: "One or more recipient countries are not currently supported by CALL-E. Use consented test numbers from a supported region.",
      }, { status: 400 });
    }

    const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY! });
    const steps: Array<{ id: number; label: string; detail: string; status: string; time: string }> = [];
    const logs: CallLog[] = [];
    let winner: ProviderResult | null = null;

    for (let index = 0; index < phones.length; index += 1) {
      const fallbackName = index === 0 ? "Skyline Air" : "Northstar Airlines";
      const startedAt = Date.now();
      let callId = "not-created";
      let call: Awaited<ReturnType<typeof client.calls.get>>;
      try {
        const createdCall = await client.calls.create({
          task: `You are PLAN B, an autonomous travel recovery agent. Clearly disclose that you are an AI calling for a hackathon demonstration. Ask this test travel provider for an alternative from San Francisco to London that arrives before 09:00. The maximum additional cost is $400. Do not purchase anything. If a viable option exists, ask the provider to hold it and provide a confirmation reference. Return provider_name, viable, arrival_time, extra_cost, decision_reason, and confirmation_reference. For a rejected option, use an empty confirmation_reference.`,
          recipients: [{ phones: [phones[index]], ...recipientConfigurations[index]! }],
          recipientResultSchema: resultSchema,
          metadata: { workflow: "plan-b-recovery", provider_index: String(index + 1), run_id: body.runId },
        }, { idempotencyKey: `${body.runId}:provider:${index + 1}` });
        callId = createdCall.id;
        call = await client.calls.waitForResult(createdCall.id, {
          intervalMs: 2_000,
          timeoutMs: CALL_RESULT_TIMEOUT_MS,
        });
      } catch (callError) {
        const durationMs = Date.now() - startedAt;
        const reason = callError instanceof Error && /timed out/i.test(callError.message)
          ? "Provider did not return a result within the live demo window"
          : "Provider could not be reached";
        const log: CallLog = {
          provider: fallbackName,
          durationMs,
          decision: "unreachable",
          callId,
          returnedJson: null,
        };
        logs.push(log);
        console.info("PLAN_B_CALL_LOG", JSON.stringify({ runId: body.runId, ...log }));
        steps.push({
          id: index + 1,
          label: `Provider ${index === 0 ? "A" : "B"} - ${fallbackName}`,
          detail: reason,
          status: "failed",
          time: `${Math.max(1, Math.round(durationMs / 1000))}s`,
        });
        continue;
      }

      const result = call.recipients[0]?.structuredResult as ProviderResult | null;
      const viable = isCompletedRecoveryOption(result, 400, 9 * 60);
      const durationMs = Date.now() - startedAt;
      const provider = result?.provider_name?.trim() || fallbackName;
      const decision: CallLog["decision"] = viable ? "accepted" : result ? "rejected" : "unreachable";
      const log: CallLog = { provider, durationMs, decision, callId, returnedJson: result };
      logs.push(log);
      console.info("PLAN_B_CALL_LOG", JSON.stringify({ runId: body.runId, ...log }));

      steps.push({
        id: index + 1,
        label: `Provider ${index === 0 ? "A" : "B"} - ${provider}`,
        detail: result?.decision_reason || (call.taskCompleted ? "Call completed without structured data" : "Provider could not be reached"),
        status: viable ? "success" : "failed",
        time: `${Math.max(1, Math.round(durationMs / 1000))}s`,
      });

      if (viable) {
        winner = result;
        break;
      }
    }

    while (steps.length < 2) steps.push({ id: steps.length + 1, label: "Fallback provider", detail: "Not called after a valid route was confirmed", status: "waiting", time: "-" });
    steps.push({ id: 3, label: "Hotel negotiation", detail: "Not attempted in Live Mode - no claim made", status: "waiting", time: "-" });

    if (!winner) return Response.json({ outcome: "no_viable_plan", result: null, steps, logs });

    return Response.json({
      outcome: "recovered",
      result: {
        provider: winner.provider_name,
        arrival: winner.arrival_time,
        additionalCost: Number(winner.extra_cost),
        confirmation: winner.confirmation_reference,
        hotelPenalty: "Not attempted (Demo Mode only)",
      },
      steps,
      logs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CALL-E recovery failed safely.";
    console.error("PLAN_B_RECOVERY_ERROR", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
