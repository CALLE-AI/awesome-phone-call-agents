import { NextResponse } from "next/server";
import { z } from "zod";

import { CaseQueryError } from "@/application/case-queries";
import { WorkflowPolicyError } from "@/application/closeout-workflow";
import { HumanDispositionPolicyError } from "@/application/human-disposition";
import { ProtectedWorkspacePolicyError } from "@/application/protected-workspaces";
import { parseServerEnvironment } from "@/config/environment";
import { resolvePhoneProtectionKeys } from "@/config/phone-protection-environment";

const maximumJsonBodyBytes = 32 * 1024;

export class WorkflowHttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowHttpError";
  }
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > maximumJsonBodyBytes) {
    throw new WorkflowHttpError(
      "request_too_large",
      413,
      "The request body is too large",
    );
  }

  const body = await request.text();

  if (new TextEncoder().encode(body).byteLength > maximumJsonBodyBytes) {
    throw new WorkflowHttpError(
      "request_too_large",
      413,
      "The request body is too large",
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new WorkflowHttpError(
      "invalid_json",
      400,
      "The request body must be valid JSON",
    );
  }
}

export function requirePhoneProtectionKeys() {
  try {
    const keys = resolvePhoneProtectionKeys(process.env);

    if (!keys) {
      throw new WorkflowHttpError(
        "phone_protection_not_configured",
        503,
        "Phone protection is not configured on this server",
      );
    }

    return keys;
  } catch (error) {
    if (error instanceof WorkflowHttpError) {
      throw error;
    }

    throw new WorkflowHttpError(
      "phone_protection_configuration_invalid",
      503,
      "Phone protection is not configured correctly on this server",
    );
  }
}

export function requireServerEnvironment() {
  try {
    return parseServerEnvironment(process.env);
  } catch {
    throw new WorkflowHttpError(
      "server_configuration_invalid",
      503,
      "The server configuration is invalid",
    );
  }
}

export function requireCallEConfiguration() {
  const environment = requireServerEnvironment();

  if (!environment.callE) {
    throw new WorkflowHttpError(
      "call_e_not_configured",
      503,
      "CALL-E is not configured on this server",
    );
  }

  return { environment, callE: environment.callE };
}

export function workflowErrorResponse(error: unknown) {
  if (error instanceof WorkflowHttpError) {
    return errorResponse(error.code, error.status);
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  if (error instanceof CaseQueryError) {
    return errorResponse(
      error.code,
      error.code === "case_not_found" ? 404 : 403,
    );
  }

  if (error instanceof WorkflowPolicyError) {
    return errorResponse(error.code, policyErrorStatus(error.code));
  }

  if (error instanceof HumanDispositionPolicyError) {
    return errorResponse(error.code, humanDispositionErrorStatus(error.code));
  }

  if (error instanceof ProtectedWorkspacePolicyError) {
    return errorResponse(
      error.code,
      protectedWorkspaceErrorStatus(error.code),
    );
  }

  return errorResponse("request_failed", 500);
}

export function unauthorizedResponse() {
  return errorResponse("authentication_required", 401);
}

function errorResponse(code: string, status: number) {
  return NextResponse.json({ error: { code } }, { status });
}

function policyErrorStatus(code: string) {
  if (code === "case_not_found" || code === "attempt_not_found") {
    return 404;
  }

  if (
    code === "workspace_access_denied" ||
    code === "operator_role_forbidden" ||
    code === "fake_workspace_required" ||
    code === "fake_provider_required" ||
    code === "live_approval_forbidden"
  ) {
    return 403;
  }

  return 409;
}

function protectedWorkspaceErrorStatus(code: string) {
  if (code === "protected_workspace_not_found") {
    return 404;
  }

  if (
    code === "protected_environment_required" ||
    code === "protected_workspace_admin_forbidden"
  ) {
    return 403;
  }

  if (code === "live_server_configuration_required") {
    return 503;
  }

  return 409;
}

function humanDispositionErrorStatus(code: string) {
  if (code === "case_not_found") {
    return 404;
  }

  if (
    code === "workspace_access_denied" ||
    code === "operator_role_forbidden"
  ) {
    return 403;
  }

  return 409;
}
