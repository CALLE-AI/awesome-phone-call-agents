import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { ingestEmailsForUser } from "@/lib/emailIngestion";
import { isOperatorAuthorized } from "@/lib/operatorAuth";
import { redactContextText } from "@/lib/privacy";

export async function GET(request: NextRequest) {
  if (!isOperatorAuthorized(request)) {
    return NextResponse.json(
      { error: "Operator authorization is required." },
      { status: 401 }
    );
  }
  // For now there's a single seeded demo user (see scripts/seedUser.ts).
  // Public signups get their mock inbox seeded directly in
  // app/api/users/create/route.ts via the same shared helper.
  const user = await db.query.users.findFirst();

  if (!user) {
    return NextResponse.json(
      {
        error:
          "No user found. Run `npm run db:seed` to create the demo user first.",
      },
      { status: 404 }
    );
  }

  const records = await ingestEmailsForUser(user.id);

  return NextResponse.json(
    records.map((record) => ({
      ...record,
      subject: redactContextText(record.subject) ?? "",
      summary: redactContextText(record.summary),
      decisionDetail: redactContextText(record.decisionDetail),
    }))
  );
}
