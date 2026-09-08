import { NextRequest, NextResponse } from "next/server";
import { readWorkspaceSettings, writeWorkspaceSettings } from "@/lib/console/workspace-settings";
import type { DataSource } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ success: true, settings: readWorkspaceSettings() });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { dataSource?: string } | null;
  const dataSource: DataSource = body?.dataSource === "mock" ? "mock" : "live";
  const settings = writeWorkspaceSettings({ dataSource });
  return NextResponse.json({ success: true, settings });
}
