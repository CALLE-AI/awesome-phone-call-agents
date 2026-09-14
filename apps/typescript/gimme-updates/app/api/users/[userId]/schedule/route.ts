import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";

// Accepts "HH:mm" (24-hour), e.g. "13:05" or "09:30".
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  const body = await request.json().catch(() => null);
  const callTime = typeof body?.callTime === "string" ? body.callTime.trim() : "";

  if (!TIME_PATTERN.test(callTime)) {
    return NextResponse.json(
      { error: "`callTime` must be in 24-hour \"HH:mm\" format, e.g. \"13:05\"." },
      { status: 400 }
    );
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!existing) {
    return NextResponse.json(
      { error: `No user found with id "${userId}".` },
      { status: 404 }
    );
  }

  const [updated] = await db
    .update(users)
    .set({ callTime })
    .where(eq(users.id, userId))
    .returning();

  return NextResponse.json(updated);
}
