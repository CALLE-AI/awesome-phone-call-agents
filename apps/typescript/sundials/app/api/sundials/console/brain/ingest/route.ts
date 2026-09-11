import { NextRequest, NextResponse } from "next/server";
import { geminiConfigured } from "@/lib/brain/gemini";
import { readBrainConfig, writeBrainConfig } from "@/lib/brain/config";
import { applyIngestDraft, draftFromText, enrichDraftWithGemini, MAX_INGEST_FILE_BYTES, resolveIngestText } from "@/lib/brain/ingest";
import { requireConsoleSession } from "@/lib/console/session-http";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    url?: string;
    fileName?: string;
    text?: string;
  } | null;
  const kind = body?.kind === "file" ? "file" : body?.kind === "url" ? "url" : null;
  if (!kind) {
    return NextResponse.json({ success: false, message: "kind must be url or file." }, { status: 400 });
  }
  if (kind === "file" && typeof body?.text === "string" && Buffer.byteLength(body.text, "utf8") > MAX_INGEST_FILE_BYTES) {
    return NextResponse.json({ success: false, message: "File is too large (400 KB max)." }, { status: 400 });
  }

  try {
    const { source, text } = await resolveIngestText(kind, {
      url: typeof body?.url === "string" ? body.url : undefined,
      fileName: typeof body?.fileName === "string" ? body.fileName : undefined,
      text: typeof body?.text === "string" ? body.text : undefined
    });
    const current = readBrainConfig(auth.session.accountId);
    const heuristic = draftFromText(current, text);
    const draft = await enrichDraftWithGemini(current, text, heuristic);
    const config = writeBrainConfig(applyIngestDraft(current, source, draft));
    return NextResponse.json({
      success: true,
      config,
      geminiConfigured: geminiConfigured(),
      source
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not ingest that source.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
