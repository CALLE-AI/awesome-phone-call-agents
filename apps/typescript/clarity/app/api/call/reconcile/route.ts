import { NextResponse } from "next/server";
import { z } from "zod";
import { operatorId, requireOperator } from "@/lib/auth";
import { callError, reconcileCall } from "@/lib/live-call";

export const runtime = "nodejs";
const Schema = z.object({ sessionId: z.string().uuid(), callId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict();

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const parsed = Schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid sessionId and callId are required." }, { status: 400 });
  try { return NextResponse.json(await reconcileCall(parsed.data.sessionId, operatorId(), parsed.data.callId)); }
  catch (error) {
    const { status, ...body } = callError(error);
    return NextResponse.json(body, { status });
  }
}
