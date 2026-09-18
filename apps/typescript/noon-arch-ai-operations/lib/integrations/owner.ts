import { getChatGPTUser } from "../../app/chatgpt-auth";
import { NextResponse } from "next/server";

export async function getIntegrationOwnerId(): Promise<string> {
  const user = await getChatGPTUser();
  if (user?.userId) return "single-tenant-owner";
  throw new Error("AUTH_REQUIRED");
}

export async function operatorAuthResponse(): Promise<NextResponse | null> {
  try { await getIntegrationOwnerId(); return null; }
  catch { return NextResponse.json({ error: "Operator authentication is required." }, { status: 401 }); }
}
