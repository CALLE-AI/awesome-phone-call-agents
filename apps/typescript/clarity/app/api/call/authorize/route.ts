import { NextResponse } from "next/server";
import { z } from "zod";
import { operatorId, requireOperator } from "@/lib/auth";
import { authorizeDestination, callError } from "@/lib/live-call";
import { destination, maskPhone } from "@/lib/phone";
import { isReplayMode } from "@/lib/replay";

export const runtime = "nodejs";
const ConsentSchema = z.object({ sessionId: z.string().uuid(), phone: z.string(), consent: z.literal(true) }).strict();

export async function POST(request: Request) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const parsed = ConsentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Explicit consent, sessionId, and exact E.164 destination are required." }, { status: 400 });
  if (isReplayMode()) return NextResponse.json({ error: "Live calling is disabled." }, { status: 403 });
  try { destination(parsed.data.phone); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
  try {
    const session = await authorizeDestination(parsed.data.sessionId, operatorId(), parsed.data.phone);
    const consent = session.authorization!;
    return NextResponse.json({ destination: maskPhone(consent.phone), region: consent.region, locale: consent.locale, expiresAt: consent.expiresAt });
  } catch (error) {
    const { status, ...body } = callError(error);
    return NextResponse.json(body, { status });
  }
}
