import { NextRequest, NextResponse } from "next/server";
import { HARBOR_ACCOUNT_ID } from "@/lib/sdk/public-key";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig, writeBrainConfig } from "@/lib/brain/config";
import { syncPainCatalogFromCalls } from "@/lib/brain/pipeline";
import { getSundialsDb } from "@/lib/db";
import type { BrainConfig } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  syncPainCatalogFromCalls(getSundialsDb(), HARBOR_ACCOUNT_ID);
  return NextResponse.json({
    success: true,
    config: readBrainConfig(HARBOR_ACCOUNT_ID),
    geminiConfigured: geminiConfigured()
  });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { config?: Partial<BrainConfig> } | null;
  if (!body?.config || typeof body.config !== "object") {
    return NextResponse.json({ success: false, message: "config is required." }, { status: 400 });
  }
  const current = readBrainConfig(HARBOR_ACCOUNT_ID);
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
    accountId: HARBOR_ACCOUNT_ID
  });
  return NextResponse.json({ success: true, config, geminiConfigured: geminiConfigured() });
}
