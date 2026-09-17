import { NextResponse } from "next/server";

import { db } from "@/db";
import { ingestEmailsForUser } from "@/lib/emailIngestion";

export async function GET() {
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

  return NextResponse.json(records);
}
