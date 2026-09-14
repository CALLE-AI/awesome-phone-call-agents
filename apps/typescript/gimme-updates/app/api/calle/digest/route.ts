import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db, users } from "@/db";
import { runDigestForUser } from "@/lib/digest";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const userId =
    body && typeof body.userId === "string" && body.userId.trim()
      ? body.userId.trim()
      : undefined;

  // Backward compatible fallback: if no userId is provided, use the first
  // user in the table (the original single-demo-user behavior).
  const user = userId
    ? await db.query.users.findFirst({ where: eq(users.id, userId) })
    : await db.query.users.findFirst();

  if (!user) {
    return NextResponse.json(
      {
        error: userId
          ? `No user found with id "${userId}".`
          : "No user found. Run `npm run db:seed` to create the demo user first.",
      },
      { status: 404 }
    );
  }

  const result = await runDigestForUser(user);

  if ("skipped" in result) {
    if (result.reason === "rate_limited") {
      return NextResponse.json(
        {
          error:
            "This user already has a completed real call on record. Only one real call per user is allowed for this demo (dry runs are unaffected).",
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "No pending emails to call about." },
      { status: 400 }
    );
  }

  return NextResponse.json(result);
}
