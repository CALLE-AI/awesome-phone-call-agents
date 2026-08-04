import { describe, expect, it } from "vitest";

import { POST as executeAttempt } from "@/app/api/attempts/[attemptId]/execute/route";
import { POST as refreshAttempt } from "@/app/api/attempts/[attemptId]/refresh/route";
import { POST as approveCase } from "@/app/api/cases/[caseId]/approve/route";
import { POST as recordCaseDisposition } from "@/app/api/cases/[caseId]/disposition/route";
import { GET as getCase } from "@/app/api/cases/[caseId]/route";
import { GET as previewCase } from "@/app/api/cases/[caseId]/preview/route";
import {
  GET as listCases,
  POST as createCase,
} from "@/app/api/cases/route";

const caseId = "10000000-0000-4000-8000-000000000011";
const attemptId = "10000000-0000-4000-8000-000000000012";

const unauthenticatedRequests = [
  {
    name: "GET /api/cases",
    run: () =>
      listCases(
        new Request("http://localhost/api/cases?workspaceId=not-validated"),
      ),
  },
  {
    name: "POST /api/cases",
    run: () =>
      createCase(
        new Request("http://localhost/api/cases", {
          method: "POST",
          body: "not parsed before authentication",
        }),
      ),
  },
  {
    name: "GET /api/cases/:caseId",
    run: () =>
      getCase(
        new Request(
          `http://localhost/api/cases/${caseId}?workspaceId=not-validated`,
        ),
        { params: Promise.resolve({ caseId }) },
      ),
  },
  {
    name: "GET /api/cases/:caseId/preview",
    run: () =>
      previewCase(
        new Request(
          `http://localhost/api/cases/${caseId}/preview?workspaceId=not-validated`,
        ),
        { params: Promise.resolve({ caseId }) },
      ),
  },
  {
    name: "POST /api/cases/:caseId/approve",
    run: () =>
      approveCase(
        new Request(`http://localhost/api/cases/${caseId}/approve`, {
          method: "POST",
          body: "not parsed before authentication",
        }),
        { params: Promise.resolve({ caseId }) },
      ),
  },
  {
    name: "POST /api/cases/:caseId/disposition",
    run: () =>
      recordCaseDisposition(
        new Request(`http://localhost/api/cases/${caseId}/disposition`, {
          method: "POST",
          body: "not parsed before authentication",
        }),
        { params: Promise.resolve({ caseId }) },
      ),
  },
  {
    name: "POST /api/attempts/:attemptId/execute",
    run: () =>
      executeAttempt(
        new Request(`http://localhost/api/attempts/${attemptId}/execute`, {
          method: "POST",
          body: "not parsed before authentication",
        }),
        { params: Promise.resolve({ attemptId }) },
      ),
  },
  {
    name: "POST /api/attempts/:attemptId/refresh",
    run: () =>
      refreshAttempt(
        new Request(`http://localhost/api/attempts/${attemptId}/refresh`, {
          method: "POST",
          body: "not parsed before authentication",
        }),
        { params: Promise.resolve({ attemptId }) },
      ),
  },
] as const;

describe("closeout workflow route authentication", () => {
  it.each(unauthenticatedRequests)(
    "returns a bounded 401 before parsing $name",
    async ({ run }) => {
      const response = await run();

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "authentication_required" },
      });
    },
  );
});
