import { createHash } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import type { FieldCloseDatabase } from "@/persistence/database";
import {
  workspaceMemberships,
  workspaces,
} from "@/persistence/schema";

type AuthenticatedUser = {
  id: string;
  name: string;
};

export async function ensurePersonalDemoWorkspace(
  db: FieldCloseDatabase,
  user: AuthenticatedUser,
) {
  const slug = createDemoWorkspaceSlug(user.id);

  return db.transaction(async (transaction) => {
    await transaction
      .insert(workspaces)
      .values({
        slug,
        displayName: createDemoWorkspaceName(user.name),
        kind: "demo",
        provider: "fake",
        liveCallsAllowed: false,
        ownerUserId: user.id,
      })
      .onConflictDoNothing({ target: workspaces.slug });

    const [workspace] = await transaction
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        displayName: workspaces.displayName,
        kind: workspaces.kind,
        provider: workspaces.provider,
        liveCallsAllowed: workspaces.liveCallsAllowed,
        ownerUserId: workspaces.ownerUserId,
      })
      .from(workspaces)
      .where(eq(workspaces.slug, slug))
      .limit(1);

    if (!workspace || workspace.ownerUserId !== user.id) {
      throw new Error("Unable to establish an isolated demo workspace");
    }

    await transaction
      .insert(workspaceMemberships)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        role: "owner",
      })
      .onConflictDoUpdate({
        target: [
          workspaceMemberships.workspaceId,
          workspaceMemberships.userId,
        ],
        set: { role: "owner" },
      });

    return { ...workspace, role: "owner" as const };
  });
}

export async function listUserWorkspaces(
  db: FieldCloseDatabase,
  userId: string,
) {
  return db
    .select({
      id: workspaces.id,
      slug: workspaces.slug,
      displayName: workspaces.displayName,
      kind: workspaces.kind,
      provider: workspaces.provider,
      liveCallsAllowed: workspaces.liveCallsAllowed,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(asc(workspaces.createdAt));
}

export async function findWorkspaceAccess(
  db: FieldCloseDatabase,
  userId: string,
  workspaceId: string,
) {
  const [access] = await db
    .select({
      id: workspaces.id,
      kind: workspaces.kind,
      provider: workspaces.provider,
      liveCallsAllowed: workspaces.liveCallsAllowed,
      role: workspaceMemberships.role,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return access ?? null;
}

function createDemoWorkspaceSlug(userId: string) {
  const digest = createHash("sha256").update(userId).digest("hex").slice(0, 20);
  return `demo-${digest}`;
}

function createDemoWorkspaceName(name: string) {
  const normalizedName = name.trim().slice(0, 90) || "FieldClose";
  return `${normalizedName} demo`;
}
