import type { CallWorkflow } from "./types";

export type AuthContext = {
  userId: number;
  role: "user" | "admin";
};

export function assertWorkflowOwner(workflow: CallWorkflow | undefined, ctx: AuthContext): boolean {
  if (!workflow) return false;
  return workflow.initiatorUserId === ctx.userId;
}

export function assertPrepareToken(workflow: CallWorkflow, token: string): boolean {
  return workflow.prepareToken === token;
}

/** CHW actions require authenticated user; admin may access any workflow they initiated. */
export function canAccessWorkflow(workflow: CallWorkflow | undefined, ctx: AuthContext): boolean {
  return assertWorkflowOwner(workflow, ctx);
}
