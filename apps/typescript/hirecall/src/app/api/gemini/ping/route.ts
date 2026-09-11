import { NextResponse } from "next/server";

import { pingGemini } from "@/lib/generate-call-prompt";

export const runtime = "nodejs";

export async function POST() {
  try {
    const result = await pingGemini();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gemini did not respond.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
