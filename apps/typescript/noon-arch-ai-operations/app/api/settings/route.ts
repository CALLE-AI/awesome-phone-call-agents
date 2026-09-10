import { NextResponse } from "next/server";
import { loadAppSettings, saveAppSettings } from "../../../lib/app-settings";
import { getIntegrationOwnerId } from "../../../lib/integrations/owner";

export async function GET() {
  try {
    const ownerId = await getIntegrationOwnerId();
    return NextResponse.json({ settings: await loadAppSettings(ownerId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.message === "AUTH_REQUIRED" ? "يلزم تسجيل الدخول." : "تعذر تحميل الإعدادات." }, { status: 401 });
  }
}

export async function PUT(request: Request) {
  try {
    const ownerId = await getIntegrationOwnerId();
    const body = await request.json() as Parameters<typeof saveAppSettings>[1];
    return NextResponse.json({ settings: await saveAppSettings(ownerId, body) });
  } catch (error) {
    const status = error instanceof Error && error.message === "INVALID_SETTINGS" ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? "تحقق من رمز المنطقة واللغة." : "تعذر حفظ الإعدادات." }, { status });
  }
}
