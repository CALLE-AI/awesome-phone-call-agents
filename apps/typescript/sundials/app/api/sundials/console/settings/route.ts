import { NextRequest, NextResponse } from "next/server";
import { requireConsoleSession } from "@/lib/console/session-http";
import { readWorkspaceSettings, writeWorkspaceSettings } from "@/lib/console/workspace-settings";
import type { DataSource } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, settings: readWorkspaceSettings() });
}

export async function PUT(req: NextRequest) {
  const auth = requireConsoleSession(req);
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as { dataSource?: string } | null;
  const dataSource: DataSource = body?.dataSource === "mock" ? "mock" : "live";
  const settings = writeWorkspaceSettings({ dataSource });
  return NextResponse.json({ success: true, settings });
}
