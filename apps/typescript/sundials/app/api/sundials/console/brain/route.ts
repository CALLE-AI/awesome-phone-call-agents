import { NextRequest, NextResponse } from "next/server";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig, writeBrainConfig } from "@/lib/brain/config";
import { syncPainCatalogFromCalls } from "@/lib/brain/pipeline";
import { requireConsoleSession } from "@/lib/console/session-http";
import { getSundialsDb } from "@/lib/db";
import type { BrainConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  syncPainCatalogFromCalls(getSundialsDb(), auth.session.accountId);
  return NextResponse.json({
    success: true,
    config: readBrainConfig(auth.session.accountId),
    geminiConfigured: geminiConfigured()
  });
}

export async function PUT(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { config?: Partial<BrainConfig> } | null;
  if (!body?.config || typeof body.config !== "object") {
    return NextResponse.json({ success: false, message: "config is required." }, { status: 400 });
  }
  const current = readBrainConfig(auth.session.accountId);
  const incoming = { ...body.config };
  delete incoming.painCategories;
  delete incoming.tonePersona;
  delete incoming.agentIdentity;
  const config = writeBrainConfig({
    ...current,
    ...incoming,
    tonePersona: current.tonePersona,
    agentIdentity: current.agentIdentity,
    painCategories: current.painCategories,
    accountId: auth.session.accountId
  });
  return NextResponse.json({ success: true, config, geminiConfigured: geminiConfigured() });
}
