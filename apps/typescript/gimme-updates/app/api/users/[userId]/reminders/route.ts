import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db, emails, reminders } from "@/db";
import { isOperatorAuthorized } from "@/lib/operatorAuth";
import { redactContextText } from "@/lib/privacy";

/**
 * Returns this user's non-fired reminders, joined with their email's
 * subject/summary/sender. Used by app/page.tsx's "Upcoming reminders"
 * section — schema.ts doesn't define drizzle `relations()`, so this is a
 * plain manual join rather than `db.query.reminders.findMany({ with: ... })`.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;

  if (!isOperatorAuthorized(_request)) {
    return NextResponse.json(
      { error: "Operator authorization is required." },
      { status: 401 }
    );
  }

  const rows = await db
    .select({
      id: reminders.id,
      remindAt: reminders.remindAt,
      emailId: emails.id,
      subject: emails.subject,
      summary: emails.summary,
      sender: emails.sender,
    })
    .from(reminders)
    .innerJoin(emails, eq(reminders.emailId, emails.id))
    .where(
      and(
        eq(reminders.userId, userId),
        eq(reminders.fired, false),
        eq(reminders.status, "pending")
      )
    )
    .orderBy(reminders.remindAt);

  const result = rows.map((row) => ({
    id: row.id,
    remindAt: row.remindAt.toISOString(),
    email: {
      id: row.emailId,
      subject: redactContextText(row.subject) ?? "",
      summary: redactContextText(row.summary),
      sender: row.sender,
    },
  }));

  return NextResponse.json(result);
}
