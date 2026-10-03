import { NextResponse } from "next/server";
import { CalleApiError, testCalleApiKey } from "../../../../lib/integrations/calle";
import { getIntegrationOwnerId } from "../../../../lib/integrations/owner";
import { deleteCalleConnection, getCalleApiKey, markCalleConnectionTested, saveCalleConnection } from "../../../../lib/integrations/store";

function validApiKey(value: string) {
  return value.length >= 24 && value.length <= 512 && !/\s/.test(value);
}

export async function POST(request: Request) {
  let ownerId = "";
  try {
    ownerId = await getIntegrationOwnerId();
    const body = await request.json() as { action?: string; apiKey?: string; confirmed?: boolean };
    if (body.action === "connect") {
      const apiKey = String(body.apiKey || "").trim();
      if (!validApiKey(apiKey)) return NextResponse.json({ error: "Enter the full CALL-E API key from the dashboard." }, { status: 400 });
      const test = await testCalleApiKey(apiKey);
      await saveCalleConnection(ownerId, apiKey);
      return NextResponse.json({ ...test, source: "saved" });
    }
    if (body.action === "test") {
      const current = await getCalleApiKey(ownerId);
      try {
        const test = await testCalleApiKey(current.apiKey);
        if (current.connection) await markCalleConnectionTested(ownerId, "connected");
        return NextResponse.json({ ...test, source: current.source });
      } catch (error) {
        if (current.connection) await markCalleConnectionTested(ownerId, "error");
        throw error;
      }
    }
    if (body.action === "disconnect") {
      if (body.confirmed !== true) return NextResponse.json({ error: "Confirm before deleting the saved CALL-E key." }, { status: 400 });
      await deleteCalleConnection(ownerId);
      return NextResponse.json({ disconnected: true, fallbackConfigured: Boolean(String(process.env.CALLE_API_KEY || "").trim()) });
    }
    return NextResponse.json({ error: "Unknown CALL-E action." }, { status: 400 });
  } catch (error) {
    if (error instanceof CalleApiError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    const message = error instanceof Error ? error.message : "";
    if (message === "AUTH_REQUIRED") return NextResponse.json({ error: "Operator authentication is required." }, { status: 401 });
    if (message === "ENCRYPTION_NOT_CONFIGURED") return NextResponse.json({ error: "Server-side credential encryption is not configured." }, { status: 503 });
    if (message === "CALLE_NOT_CONNECTED") return NextResponse.json({ error: "Connect CALL-E first; no credit was used." }, { status: 409 });
    return NextResponse.json({ error: "CALL-E setup could not be completed." }, { status: 500 });
  }
}
