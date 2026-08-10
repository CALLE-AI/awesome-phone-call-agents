import { eq } from "drizzle-orm";

import { findWorkspaceAccess } from "@/application/workspaces";
import type { ServerEnvironment } from "@/config/environment";
import type { WorkspaceKind, WorkspaceRole } from "@/domain/enums";
import type { FieldCloseDatabase } from "@/persistence/database";
import { systemSettings } from "@/persistence/schema";

export const liveCallBlockReasonValues = [
  "workspace_access_denied",
  "demo_mode",
  "environment_flag_disabled",
  "workspace_not_protected",
  "workspace_provider_not_call_e",
  "workspace_live_calls_disabled",
  "global_kill_switch_paused",
  "call_e_credentials_missing",
  "operator_role_forbidden",
] as const;

export type LiveCallBlockReason = (typeof liveCallBlockReasonValues)[number];

type WorkspaceLiveCallContext = {
  kind: WorkspaceKind;
  provider: "fake" | "call_e";
  liveCallsAllowed: boolean;
  role: WorkspaceRole;
  globalKillSwitchPaused: boolean;
};

export type LiveCallGateDecision =
  | { allowed: true }
  | { allowed: false; reason: LiveCallBlockReason };

export function evaluateLiveCallGate(
  environment: ServerEnvironment,
  context: WorkspaceLiveCallContext,
): LiveCallGateDecision {
  if (environment.demoMode) {
    return { allowed: false, reason: "demo_mode" };
  }

  if (!environment.liveCallsFlagEnabled) {
    return { allowed: false, reason: "environment_flag_disabled" };
  }

  if (context.kind !== "protected") {
    return { allowed: false, reason: "workspace_not_protected" };
  }

  if (context.provider !== "call_e") {
    return { allowed: false, reason: "workspace_provider_not_call_e" };
  }

  if (!context.liveCallsAllowed) {
    return { allowed: false, reason: "workspace_live_calls_disabled" };
  }

  if (context.globalKillSwitchPaused) {
    return { allowed: false, reason: "global_kill_switch_paused" };
  }

  if (!environment.callECredentialsConfigured) {
    return { allowed: false, reason: "call_e_credentials_missing" };
  }

  if (context.role === "auditor") {
    return { allowed: false, reason: "operator_role_forbidden" };
  }

  return { allowed: true };
}

export async function authorizeLiveCall(
  db: FieldCloseDatabase,
  environment: ServerEnvironment,
  userId: string,
  workspaceId: string,
): Promise<LiveCallGateDecision> {
  const access = await findWorkspaceAccess(db, userId, workspaceId);

  if (!access) {
    return { allowed: false, reason: "workspace_access_denied" };
  }

  const [killSwitch] = await db
    .select({ paused: systemSettings.booleanValue })
    .from(systemSettings)
    .where(eq(systemSettings.key, "live_calls_paused"))
    .limit(1);

  return evaluateLiveCallGate(environment, {
    ...access,
    globalKillSwitchPaused: killSwitch?.paused ?? true,
  });
}
