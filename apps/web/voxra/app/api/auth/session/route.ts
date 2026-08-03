import { NextResponse } from "next/server";
import { getUsableCalleSession } from "@/lib/auth";

/**
 * GET /api/auth/session
 * Returns the current session (name, email, picture) or null if unauthenticated.
 * Never exposes the access_token to the client.
 */
export async function GET() {
  const session = await getUsableCalleSession();
  if (!session) {
    return NextResponse.json({ session: null });
  }
  return NextResponse.json({
    session: {
      email:   session.email   ?? null,
      name:    session.name    ?? null,
      picture: session.picture ?? null,
    },
  });
}
