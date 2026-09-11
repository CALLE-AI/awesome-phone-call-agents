import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { missionSchema } from "@/lib/validate";
import { buildPlan } from "@/lib/planner";
import { listMissions, nextMissionNumber, saveMission } from "@/lib/store";
import { calleConfigured } from "@/services/calle/calleClient";
import type { CallEvent, Mission } from "@/types";

export const dynamic = "force-dynamic";

function ev(missionId: string, kind: string, message: string, meta?: Record<string, unknown>): CallEvent {
  return { id: randomUUID(), missionId, ts: new Date().toISOString(), kind, message, meta };
}

export async function GET() {
  return NextResponse.json({ missions: await listMissions(), calleConfigured: calleConfigured() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = missionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  const p = parsed.data;
  const id = randomUUID();
  const number = await nextMissionNumber();
  const plan = buildPlan(p);
  const now = new Date().toISOString();
  const mission: Mission = {
    ...p,
    id, number, status: "planned", createdAt: now, updatedAt: now,
    plan, callId: null, calleRunId: null, events: [], result: null,
    elapsedSeconds: 0, provider: p.demoMode || !calleConfigured() ? "calle-mock" : "calle-live", error: null,
  };
  mission.events = [
    ev(id, "init", "Task initialized"),
    ev(id, "plan", "Agent plan generated", { objective: plan.objective, questions: plan.questions.length }),
  ];
  await saveMission(mission);
  return NextResponse.json({ mission });
}
