import "server-only";

import { eq } from "drizzle-orm";

import {
  assertLiveOperatorRole,
  assertResultsOperatorRole,
} from "@/lib/auth/live-policy";
import type { CallMode } from "@/lib/calle/safety";
import { profiles } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";

/**
 * Database-backed live entitlement. New signups receive `business_user`; only an
 * administrator using the database owner role can assign `live_operator` because the
 * authenticated role cannot insert profiles or update profiles.role.
 */
async function roleForUser(userId: string): Promise<string | null> {
  const [profile] = await withRLS(userId, (tx) =>
    tx
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
  );
  return profile?.role ?? null;
}

export async function assertLiveOperatorUser(
  userId: string,
  mode: CallMode,
): Promise<void> {
  if (mode === "fake") return;
  assertLiveOperatorRole(await roleForUser(userId), mode);
}

export async function assertResultsOperatorUser(userId: string): Promise<void> {
  assertResultsOperatorRole(await roleForUser(userId));
}
