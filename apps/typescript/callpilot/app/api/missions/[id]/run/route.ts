import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getMission, saveMission } from "@/lib/store";
import { buildCalleTask, calleConfigured, getCalleProvider, isTerminalStatus } from "@/services/calle/calleClient";
import { extractResult } from "@/lib/extractor";
import type { CallEvent, Mission } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function ev(missionId: string, kind: string, message: string, meta?: Record<string, unknown>): CallEvent {
  return { id: randomUUID(), missionId, ts: new Date().toISOString(), kind, message, meta };
}

async function refresh(id: string): Promise<Mission | null> {
  return getMission(id);
}

/** Map a raw CALL-E status string onto our timeline stage (best-effort, honest). */
function stageForLiveStatus(status: string): "dialing" | "connected" | "understanding" | "confirming" | null {
  const s = status.toLowerCase();
  if (/queued|created|scheduled|dial|ring/.test(s)) return "dialing";
  if (/connect|answered|progress|ongoing|active|talk/.test(s)) return "connected";
  if (/analyz|understand|transcrib|process/.test(s)) return "understanding";
  if (/complet|final|wrap|done/.test(s)) return "confirming";
  return null;
}

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const mission = await getMission(params.id);
  if (!mission) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!mission.plan) return NextResponse.json({ error: "No plan" }, { status: 400 });
  if (!/^\+[1-9]\d{6,14}$/.test(mission.phoneE164)) return NextResponse.json({ error: "Invalid phone number (E.164 required)" }, { status: 400 });

  const started = Date.now();
  const live = !mission.demoMode && calleConfigured();
  const providerName = live ? "calle-live" : "calle-mock";
  mission.provider = providerName;
  mission.status = "dialing";
  mission.error = null;
  mission.updatedAt = new Date().toISOString();
  mission.events.push(ev(mission.id, "calle", live ? "CALL-E session starting (live SDK at runtime)" : "Demo session created (MOCKED — no real call will be placed)", { provider: providerName }));
  await saveMission(mission);

  const push = async (kind: string, message: string, meta?: Record<string, unknown>) => {
    const m = await refresh(mission.id);
    if (!m) return;
    m.events.push(ev(m.id, kind, message, meta));
    m.elapsedSeconds = Math.round((Date.now() - started) / 1000);
    m.updatedAt = new Date().toISOString();
    if (kind === "connected") m.status = "connected";
    if (kind === "understanding") m.status = "understanding";
    if (kind === "negotiating") m.status = "negotiating";
    if (kind === "confirming") m.status = "confirming";
    await saveMission(m);
  };

  const finalize = async (result: Parameters<typeof extractResult>[1], noteKind: "result" | "mock") => {
    const m = (await refresh(mission.id))!;
    m.callId = result.callId;
    m.calleRunId = result.runId;
    m.events.push(ev(m.id, "objective", result.taskCompleted ? "Objective achieved" : "Call ended — review output", { status: result.status }));
    const structured = extractResult(m, result);
    m.result = structured;
    m.status = result.status === "completed" || structured.objective_achieved ? "completed" : "needs_review";
    m.events.push(
      noteKind === "mock"
        ? ev(m.id, "mock", "Structured result generated (MOCKED data — no real call placed)")
        : ev(m.id, "result", "Structured result generated from live CALL-E output", { confidence: result.confidence })
    );
    m.elapsedSeconds = Math.round((Date.now() - started) / 1000);
    m.updatedAt = new Date().toISOString();
    await saveMission(m);
    return m;
  };

  const fail = async (message: string) => {
    const m = (await refresh(mission.id))!;
    m.status = "failed";
    m.error = message;
    m.events.push(ev(m.id, "error", `Call failed: ${message}`));
    m.elapsedSeconds = Math.round((Date.now() - started) / 1000);
    m.updatedAt = new Date().toISOString();
    await saveMission(m);
    return m;
  };

  try {
    const provider = getCalleProvider({ demoMode: mission.demoMode });
    const task = buildCalleTask(mission, mission.plan);
    const callReq = {
      task,
      phoneE164: mission.phoneE164,
      targetName: mission.targetName,
      instructions: mission.plan.agentInstructions,
      resultSchema: mission.plan.resultSchema as Record<string, unknown>,
    };

    // ---------------- LIVE PATH: real ids, honest status-only events ----------------
    if (live && provider.beginCall && provider.fetchCall) {
      await push("preparing", "Agent instructions composed — invoking CALL-E SDK at runtime", { sdk: "@call-e/calle", baseUrl: process.env.CALLE_BASE_URL || "https://api.heycall-e.com" });
      const begun = await provider.beginCall(callReq);
      await push("dialing", `CALL-E accepted the call (callId ${begun.callId}) — dialing ${mission.targetName}`, { callId: begun.callId, runId: begun.runId });
      // Persist real ids immediately so a restart/webhook can reconcile.
      const m0 = (await refresh(mission.id))!;
      m0.callId = begun.callId;
      m0.calleRunId = begun.runId;
      await saveMission(m0);

      let lastStage = "dialing";
      let polls = 0;
      const maxPolls = 60;
      for (;;) {
        await new Promise((r) => setTimeout(r, 5000));
        polls++;
        const snap = await provider.fetchCall!(begun.callId).catch(() => null);
        if (!snap) {
          await push("heartbeat", `Waiting for CALL-E status… (poll ${polls}, no snapshot yet)`, { poll: polls });
        } else {
          const stage = stageForLiveStatus(snap.status);
          // Emit ONLY genuine status transitions observed from CALL-E — never invented conversation facts.
          if (stage && stage !== lastStage) {
            lastStage = stage;
            await push(stage === "dialing" ? "dialing" : stage, `CALL-E status: ${snap.status}`, { status: snap.status });
          } else if (polls % 6 === 0) {
            await push("heartbeat", `Still on call — CALL-E status: ${snap.status} (poll ${polls})`, { status: snap.status });
          }
          const raw = snap.raw as Record<string, unknown>;
          if (isTerminalStatus(snap.status, raw)) {
            const done = await finalize(snap, "result");
            return NextResponse.json({ mission: done });
          }
        }
        if (polls >= maxPolls) {
          const last = await provider.fetchCall!(begun.callId).catch(() => null);
          if (last) {
            const done = await finalize(last, "result");
            return NextResponse.json({ mission: done, warning: "Poll window elapsed; result reflects the last CALL-E snapshot. Re-open to refresh or wait for webhook." });
          }
          const f = await fail("CALL-E status unavailable after 5 minutes of polling");
          return NextResponse.json({ mission: f, error: f.error }, { status: 502 });
        }
      }
    }

    // ---------------- MOCK PATH: fully simulated, explicitly labeled ----------------
    await push("preparing", "Demo: composing simulated agent run (no SDK call — MOCKED)", { mocked: true });
    const script: [string, string][] = [
      ["dialing", "Simulated: dialing target (demo — no real call)"],
      ["connected", "Simulated: call connected, agent introduced itself (demo)"],
      ["understanding", "Simulated: availability question answered (demo)"],
      ["negotiating", "Simulated: follow-up on constraint detected (demo)"],
      ["confirming", "Simulated: objective achieved, wrapping up (demo)"],
    ];
    for (const [kind, message] of script) {
      await new Promise((r) => setTimeout(r, 700));
      await push(kind, message, { mocked: true });
    }
    const result = await provider.createCall(callReq);
    const done = await finalize(result, "mock");
    return NextResponse.json({ mission: done });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Call failed";
    console.error("[mission-run] failed:", message, e instanceof Error ? e.stack : e);
    const f = await fail(message);
    return NextResponse.json({ mission: f, error: f.error }, { status: 502 });
  }
}
