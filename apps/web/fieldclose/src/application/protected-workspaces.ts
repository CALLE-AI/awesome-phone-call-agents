import { and, eq } from "drizzle-orm";

import type { AuthenticatedActor } from "@/application/authentication";
import type { ServerEnvironment } from "@/config/environment";
import type { FieldCloseDatabase } from "@/persistence/database";
import {
  workspaceAdministrativeEvents,
  workspaceMemberships,
  workspaces,
} from "@/persistence/schema";

export const PROVISION_PROTECTED_WORKSPACE_CONFIRMATION =
  "PROVISION_PROTECTED_WORKSPACE";
export const ENABLE_LIVE_CALLS_CONFIRMATION = "ENABLE_LIVE_CALLS";
export const PAUSE_LIVE_CALLS_CONFIRMATION = "PAUSE_LIVE_CALLS";

export class ProtectedWorkspacePolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProtectedWorkspacePolicyError";
  }
}

export type ProtectedWorkspaceInput = {
  slug: string;
  displayName: string;
  confirmation: typeof PROVISION_PROTECTED_WORKSPACE_CONFIRMATION;
};

export type ProtectedWorkspaceLiveSettingInput = {
  enabled: boolean;
  confirmation:
    | typeof ENABLE_LIVE_CALLS_CONFIRMATION
    | typeof PAUSE_LIVE_CALLS_CONFIRMATION;
};

export async function provisionProtectedWorkspace(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  actor: AuthenticatedActor,
  input: ProtectedWorkspaceInput,
) {
  requireProtectedWorkspaceAdministrator(environment, actor);

  if (input.confirmation !== PROVISION_PROTECTED_WORKSPACE_CONFIRMATION) {
    throw new ProtectedWorkspacePolicyError(
      "protected_workspace_confirmation_required",
    );
  }

  return db.transaction(async (transaction) => {
    const [createdWorkspace] = await transaction
      .insert(workspaces)
      .values({
        slug: input.slug,
        displayName: input.displayName,
        kind: "protected",
        provider: "call_e",
        liveCallsAllowed: false,
        ownerUserId: actor.userId,
      })
      .onConflictDoNothing({ target: workspaces.slug })
      .returning({
        id: workspaces.id,
        slug: workspaces.slug,
        displayName: workspaces.displayName,
        kind: workspaces.kind,
        provider: workspaces.provider,
        liveCallsAllowed: workspaces.liveCallsAllowed,
        ownerUserId: workspaces.ownerUserId,
      });

    const workspace =
      createdWorkspace ??
      (
        await transaction
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
          .where(eq(workspaces.slug, input.slug))
          .limit(1)
      )[0];

    if (
      !workspace ||
      workspace.ownerUserId !== actor.userId ||
      workspace.displayName !== input.displayName ||
      workspace.kind !== "protected" ||
      workspace.provider !== "call_e"
    ) {
      throw new ProtectedWorkspacePolicyError("workspace_slug_unavailable");
    }

    await transaction
      .insert(workspaceMemberships)
      .values({
        workspaceId: workspace.id,
        userId: actor.userId,
        role: "owner",
      })
      .onConflictDoUpdate({
        target: [
          workspaceMemberships.workspaceId,
          workspaceMemberships.userId,
        ],
        set: { role: "owner" },
      });

    if (createdWorkspace) {
      await transaction.insert(workspaceAdministrativeEvents).values({
        workspaceId: workspace.id,
        actorUserId: actor.userId,
        eventType: "protected_workspace.provisioned",
        metadata: {
          liveCallsAllowed: false,
          provider: "call_e",
          source: "protected_workspace_admin_api",
        },
      });
    }

    return {
      "workspace": publicWorkspaceView(workspace),
      created: Boolean(createdWorkspace),
    };
  });
}

export async function setProtectedWorkspaceLiveCalls(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  actor: AuthenticatedActor,
  workspaceId: string,
  input: ProtectedWorkspaceLiveSettingInput,
) {
  requireProtectedWorkspaceAdministrator(environment, actor);
  requireLiveSettingConfirmation(input);

  if (
    input.enabled &&
    (!environment.liveCallsFlagEnabled ||
      !environment.callECredentialsConfigured)
  ) {
    throw new ProtectedWorkspacePolicyError(
      "live_server_configuration_required",
    );
  }

  return db.transaction(async (transaction) => {
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
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.ownerUserId, actor.userId),
        ),
      )
      .limit(1)
      .for("update");

    if (!workspace) {
      throw new ProtectedWorkspacePolicyError(
        "protected_workspace_not_found",
      );
    }

    if (workspace.kind !== "protected" || workspace.provider !== "call_e") {
      throw new ProtectedWorkspacePolicyError(
        "protected_call_e_workspace_required",
      );
    }

    if (workspace.liveCallsAllowed === input.enabled) {
      return {
        "workspace": publicWorkspaceView(workspace),
        changed: false,
      };
    }

    const [updatedWorkspace] = await transaction
      .update(workspaces)
      .set({
        liveCallsAllowed: input.enabled,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspace.id))
      .returning({
        id: workspaces.id,
        slug: workspaces.slug,
        displayName: workspaces.displayName,
        kind: workspaces.kind,
        provider: workspaces.provider,
        liveCallsAllowed: workspaces.liveCallsAllowed,
        ownerUserId: workspaces.ownerUserId,
      });

    if (!updatedWorkspace) {
      throw new ProtectedWorkspacePolicyError(
        "protected_workspace_update_failed",
      );
    }

    await transaction.insert(workspaceAdministrativeEvents).values({
      workspaceId: updatedWorkspace.id,
      actorUserId: actor.userId,
      eventType: input.enabled
        ? "protected_workspace.live_calls_enabled"
        : "protected_workspace.live_calls_paused",
      metadata: {
        liveCallsAllowed: input.enabled,
        source: "protected_workspace_admin_api",
      },
    });

    return {
      "workspace": publicWorkspaceView(updatedWorkspace),
      changed: true,
    };
  });
}

function requireProtectedWorkspaceAdministrator(
  environment: ServerEnvironment,
  actor: AuthenticatedActor,
) {
  if (environment.demoMode) {
    throw new ProtectedWorkspacePolicyError(
      "protected_environment_required",
    );
  }

  const normalizedEmail = actor.email.trim().toLowerCase();

  if (!environment.protectedOperatorEmails.includes(normalizedEmail)) {
    throw new ProtectedWorkspacePolicyError(
      "protected_workspace_admin_forbidden",
    );
  }
}

function requireLiveSettingConfirmation(
  input: ProtectedWorkspaceLiveSettingInput,
) {
  const expectedConfirmation = input.enabled
    ? ENABLE_LIVE_CALLS_CONFIRMATION
    : PAUSE_LIVE_CALLS_CONFIRMATION;

  if (input.confirmation !== expectedConfirmation) {
    throw new ProtectedWorkspacePolicyError(
      "live_setting_confirmation_required",
    );
  }
}

function publicWorkspaceView(workspaceValue: {
  id: string;
  slug: string;
  displayName: string;
  kind: "demo" | "protected";
  provider: "fake" | "call_e";
  liveCallsAllowed: boolean;
}) {
  return {
    id: workspaceValue.id,
    slug: workspaceValue.slug,
    displayName: workspaceValue.displayName,
    kind: workspaceValue.kind,
    provider: workspaceValue.provider,
    liveCallsAllowed: workspaceValue.liveCallsAllowed,
  };
}
