import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  readBoundedJson,
  requirePhoneProtectionKeys,
  workflowErrorResponse,
  WorkflowHttpError,
} from "@/app/api/workflow-http";
import { WorkflowPolicyError } from "@/application/closeout-workflow";
import { HumanDispositionPolicyError } from "@/application/human-disposition";
import { ProtectedWorkspacePolicyError } from "@/application/protected-workspaces";

describe("workflow HTTP boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a bounded JSON object", async () => {
    const request = new Request("http://localhost/api/cases", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-test" }),
    });

    await expect(readBoundedJson(request)).resolves.toEqual({
      workspaceId: "workspace-test",
    });
  });

  it("rejects invalid or oversized JSON before application services", async () => {
    await expect(
      readBoundedJson(
        new Request("http://localhost/api/cases", {
          method: "POST",
          body: "{broken",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_json", status: 400 });

    await expect(
      readBoundedJson(
        new Request("http://localhost/api/cases", {
          method: "POST",
          body: "x".repeat(32 * 1024 + 1),
        }),
      ),
    ).rejects.toMatchObject({ code: "request_too_large", status: 413 });
  });

  it("maps policy errors without returning their internal message", async () => {
    const response = workflowErrorResponse(
      new WorkflowPolicyError(
        "contact_do_not_call",
        "The contact contains private context",
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "contact_do_not_call" },
    });
  });

  it("returns bounded field paths for invalid workflow input", async () => {
    const response = workflowErrorResponse(
      z.object({
        contact: z.object({
          phoneE164: z.string().regex(/^\+/u, "Enter an E.164 number."),
        }),
      }).safeParse({ contact: { phoneE164: "123" } }).error,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        issues: [
          {
            path: "contact.phoneE164",
            message: "Enter an E.164 number.",
          },
        ],
      },
    });
  });

  it("maps human-disposition authorization and conflict failures", async () => {
    const forbidden = workflowErrorResponse(
      new HumanDispositionPolicyError(
        "operator_role_forbidden",
        "Private role context",
      ),
    );
    const conflict = workflowErrorResponse(
      new HumanDispositionPolicyError(
        "human_disposition_conflict",
        "Private disposition context",
      ),
    );

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: { code: "operator_role_forbidden" },
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: { code: "human_disposition_conflict" },
    });
  });

  it("maps protected-workspace administration failures to bounded responses", async () => {
    const forbidden = workflowErrorResponse(
      new ProtectedWorkspacePolicyError(
        "protected_workspace_admin_forbidden",
      ),
    );
    const unavailable = workflowErrorResponse(
      new ProtectedWorkspacePolicyError(
        "live_server_configuration_required",
      ),
    );

    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: { code: "protected_workspace_admin_forbidden" },
    });
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: { code: "live_server_configuration_required" },
    });
  });

  it("fails closed when phone protection is not configured", () => {
    vi.stubEnv("FIELDCLOSE_DATA_KEY", "");
    vi.stubEnv("FIELDCLOSE_LOOKUP_KEY", "");

    expect(() => requirePhoneProtectionKeys()).toThrow(WorkflowHttpError);
  });
});
