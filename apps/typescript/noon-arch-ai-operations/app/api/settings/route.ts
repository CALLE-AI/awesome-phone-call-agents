import { NextResponse } from "next/server";
import { loadAppSettings, saveAppSettings } from "../../../lib/app-settings";
import { getIntegrationOwnerId } from "../../../lib/integrations/owner";

export async function GET() {
  try {
    const ownerId = await getIntegrationOwnerId();
    return NextResponse.json({ settings: await loadAppSettings(ownerId) });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "AUTH_REQUIRED";
    return NextResponse.json({ error: unauthorized ? "Operator authentication is required." : "Settings could not be loaded." }, { status: unauthorized ? 401 : 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const ownerId = await getIntegrationOwnerId();
    const body = await request.json() as Parameters<typeof saveAppSettings>[1];
    return NextResponse.json({ settings: await saveAppSettings(ownerId, body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "AUTH_REQUIRED" ? 401 : message === "INVALID_SETTINGS" ? 400 : 500;
    return NextResponse.json({ error: status === 401 ? "Operator authentication is required." : status === 400 ? "Check the region and locale values." : "Settings could not be saved." }, { status });
  }
}
