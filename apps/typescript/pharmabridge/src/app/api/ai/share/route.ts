import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProvider, chatJson } from "@/lib/ai";

const LANGUAGES = { ta: "Tamil (தமிழ்)", hi: "Hindi (हिन्दी)" } as const;

export async function POST(request: Request) {
  if (!aiProvider()) return NextResponse.json({ error: { code: "ai_disabled", message: "No AI provider key is configured." } }, { status: 404 });
  const body = z
    .object({ text: z.string().trim().min(10).max(1500), language: z.enum(["ta", "hi"]) })
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: { code: "invalid_request", message: "Nothing to translate." } }, { status: 400 });

  const system = `You translate a factual status update for a patient's family into ${LANGUAGES[body.data.language]}.
Keep every fact, number, name, address, reference code, phone number, and URL exactly as given; do not translate URLs or phone numbers.
Do not add advice, reassurance, or any fact that is not in the text. Keep it short and clear.
Return only a JSON object: {"message": string}.`;

  try {
    const { data, provider } = await chatJson(system, body.data.text);
    const message = z.object({ message: z.string().min(1).max(3000) }).parse(data).message;
    return NextResponse.json({ message, provider });
  } catch (error) {
    return NextResponse.json({ error: { code: "ai_failed", message: error instanceof Error ? error.message : "Translation failed." } }, { status: 502 });
  }
}
