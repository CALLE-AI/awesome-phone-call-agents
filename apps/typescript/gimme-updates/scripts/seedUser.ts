import { randomUUID } from "crypto";

import { eq } from "drizzle-orm";

import { db, users } from "../db";

const DEMO_USER_EMAIL = "demo@example.com";

async function seedUser() {
  const existing = await db.query.users.findFirst({
    where: eq(users.email, DEMO_USER_EMAIL),
  });

  if (existing) {
    console.log(`Demo user already exists (id: ${existing.id}). Skipping.`);
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email: DEMO_USER_EMAIL,
      name: "Demo User",
      // TODO: fill in a real test number later.
      phoneNumber: "",
      callTime: "13:00",
      // Gmail OAuth is out of scope for this demo; see lib/mockInbox.ts.
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiry: null,
    })
    .returning();

  console.log(`Created demo user (id: ${user.id}, email: ${user.email}).`);
}

seedUser()
  .catch((error) => {
    console.error("Failed to seed demo user:", error);
    process.exitCode = 1;
  });
