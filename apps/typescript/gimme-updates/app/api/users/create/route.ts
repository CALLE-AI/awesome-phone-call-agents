import { randomUUID } from "crypto";

import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";
import { ingestEmailsForUser } from "@/lib/emailIngestion";

// Loose E.164 check: a leading "+", then 8-15 digits total, first digit 1-9.
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phoneNumber =
    typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";

  if (!name) {
    return NextResponse.json(
      { error: "`name` is required." },
      { status: 400 }
    );
  }

  if (!E164_PATTERN.test(phoneNumber)) {
    return NextResponse.json(
      {
        error:
          "`phoneNumber` must be in E.164 format, e.g. +14155550100.",
      },
      { status: 400 }
    );
  }

  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      name,
      phoneNumber,
      // Left unset until the user picks a time via the schedule endpoint.
      callTime: null,
    })
    .returning();

  // Seed this user's mock inbox (5 sample emails, classified via
  // OpenRouter) so there's something to call about right away.
  await ingestEmailsForUser(user.id);

  return NextResponse.json({
    id: user.id,
    name: user.name,
    phoneNumber: user.phoneNumber,
  });
}
