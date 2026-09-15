import { eq } from "drizzle-orm";

import { profiles } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { PROFILE_IMAGE_BUCKET } from "@/lib/profile";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const [profile] = await withRLS(auth.user.id, (tx) =>
    tx
      .select({ avatarPath: profiles.avatarPath })
      .from(profiles)
      .where(eq(profiles.id, auth.user.id))
      .limit(1),
  );
  if (!profile?.avatarPath || !profile.avatarPath.startsWith(`${auth.user.id}/`)) {
    return Response.json({ error: "Profile image not found" }, { status: 404 });
  }

  const { data, error } = await auth.supabase.storage
    .from(PROFILE_IMAGE_BUCKET)
    .download(profile.avatarPath, {}, { cache: "no-store" });
  if (error || !data) {
    return Response.json({ error: "Profile image not found" }, { status: 404 });
  }

  return new Response(await data.arrayBuffer(), {
    headers: {
      "cache-control": "private, no-store",
      "content-type": data.type || "application/octet-stream",
      "x-content-type-options": "nosniff",
    },
  });
}
