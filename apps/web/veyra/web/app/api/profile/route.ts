import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { profiles } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import {
  detectProfileImageMime,
  MAX_PROFILE_IMAGE_BYTES,
  parseProfileDetails,
  PROFILE_IMAGE_BUCKET,
  ProfileInputError,
} from "@/lib/profile";
import { requireUser } from "@/lib/supabase/auth";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = MAX_PROFILE_IMAGE_BYTES + 64 * 1024;

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Profile image must be 2 MB or smaller" }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const unknownFields = Array.from(form.keys()).filter(
      (key) => !["fullName", "companyName", "avatar", "removeAvatar"].includes(key),
    );
    if (unknownFields.length) {
      return Response.json(
        { error: `Unknown profile field(s): ${unknownFields.join(", ")}` },
        { status: 400 },
      );
    }

    const details = parseProfileDetails(form.get("fullName"), form.get("companyName"));
    const removeAvatar = form.get("removeAvatar") === "true";
    const avatarValue = form.get("avatar");
    const avatar = avatarValue instanceof File && avatarValue.size > 0 ? avatarValue : null;
    if (avatar && removeAvatar) {
      return Response.json(
        { error: "Choose a new image or remove the current one, not both" },
        { status: 400 },
      );
    }
    if (avatar && avatar.size > MAX_PROFILE_IMAGE_BYTES) {
      return Response.json({ error: "Profile image must be 2 MB or smaller" }, { status: 413 });
    }

    const [existing] = await withRLS(auth.user.id, (tx) =>
      tx
        .select({ avatarPath: profiles.avatarPath })
        .from(profiles)
        .where(eq(profiles.id, auth.user.id))
        .limit(1),
    );
    if (!existing) return Response.json({ error: "Profile not found" }, { status: 404 });

    let avatarPath = existing.avatarPath;
    let uploadedPath: string | null = null;
    if (avatar) {
      const bytes = new Uint8Array(await avatar.arrayBuffer());
      const contentType = detectProfileImageMime(bytes);
      if (!contentType) {
        return Response.json(
          { error: "Profile image must be a valid PNG, JPEG, or WebP file" },
          { status: 400 },
        );
      }
      uploadedPath = `${auth.user.id}/avatar-${randomUUID()}`;
      const { error } = await auth.supabase.storage
        .from(PROFILE_IMAGE_BUCKET)
        .upload(uploadedPath, bytes, { contentType, upsert: false });
      if (error) {
        return Response.json({ error: "Profile image could not be uploaded" }, { status: 502 });
      }
      avatarPath = uploadedPath;
    } else if (removeAvatar) {
      avatarPath = null;
    }

    const [updated] = await withRLS(auth.user.id, (tx) =>
      tx
        .update(profiles)
        .set({
          fullName: details.fullName,
          companyName: details.companyName,
          avatarPath,
        })
        .where(eq(profiles.id, auth.user.id))
        .returning({ id: profiles.id }),
    );
    if (!updated) {
      if (uploadedPath) {
        await auth.supabase.storage.from(PROFILE_IMAGE_BUCKET).remove([uploadedPath]);
      }
      return Response.json({ error: "Profile not found" }, { status: 404 });
    }

    if (existing.avatarPath && existing.avatarPath !== avatarPath) {
      await auth.supabase.storage.from(PROFILE_IMAGE_BUCKET).remove([existing.avatarPath]);
    }

    return Response.json({
      fullName: details.fullName,
      companyName: details.companyName,
      avatarUrl: avatarPath ? "/api/profile/image" : null,
    });
  } catch (error) {
    if (error instanceof ProfileInputError) {
      return Response.json({ error: error.message, issues: error.issues }, { status: 400 });
    }
    return Response.json({ error: "Profile could not be updated" }, { status: 500 });
  }
}
