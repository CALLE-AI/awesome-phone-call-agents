import { NextRequest, NextResponse } from "next/server";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig, writeBrainConfig } from "@/lib/brain/config";
import { applySuggestionToConfig, runBrainCopilot } from "@/lib/brain/copilot";
import { requireConsoleSession } from "@/lib/console/session-http";
import type { BrainConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    message?: string;
    suggestionId?: string;
    config?: Partial<BrainConfig>;
  } | null;

  const current = readBrainConfig(auth.session.accountId);
  const base = writeBrainConfig({
    ...current,
    ...(body?.config && typeof body.config === "object" ? body.config : {}),
    tonePersona: current.tonePersona,
    agentIdentity: current.agentIdentity,
    painCategories: current.painCategories,
    accountId: auth.session.accountId
  });

  if (typeof body?.suggestionId === "string" && body.suggestionId.trim()) {
    const suggestion = base.suggestions.find((item) => item.id === body.suggestionId);
    if (!suggestion) {
      return NextResponse.json({ success: false, message: "That suggestion is no longer open." }, { status: 404 });
    }
    const config = writeBrainConfig(applySuggestionToConfig(base, suggestion));
    return NextResponse.json({
      success: true,
      reply: `Applied “${suggestion.title}”.`,
      config,
      geminiConfigured: geminiConfigured()
    });
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ success: false, message: "message is required." }, { status: 400 });
  }

  const result = await runBrainCopilot(base, message);
  const config = writeBrainConfig({
    ...result.config,
    tonePersona: current.tonePersona,
    agentIdentity: current.agentIdentity,
    painCategories: current.painCategories,
    accountId: auth.session.accountId
  });
  return NextResponse.json({
    success: true,
    reply: result.reply,
    config,
    geminiConfigured: geminiConfigured()
  });
}
