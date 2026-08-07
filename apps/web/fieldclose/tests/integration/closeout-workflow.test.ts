import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  approveFakeAttempt,
  createDemoCloseoutCase,
  executeApprovedFakeAttempt,
  previewFakeCallBrief,
  type FakeAttemptApprovalInput,
} from "@/application/closeout-workflow";
import { recordHumanDisposition } from "@/application/human-disposition";
import {
  getCloseoutCaseDetail,
  listCloseoutCases,
} from "@/application/case-queries";
import { ensurePersonalDemoWorkspace } from "@/application/workspaces";
import {
  createDatabase,
  type FieldCloseDatabase,
} from "@/persistence/database";
import { FakeCallProvider } from "@/providers/fake/fake-call-provider";
import type { FakeScenarioId } from "@/providers/fake/scenarios";
import type {
  CallProvider,
  CreateCallRequest,
  ProviderCreationOutcome,
} from "@/providers/types";
import { createPhoneProtectionKeys } from "@/security/phone-protection";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
const phoneKeys = createPhoneProtectionKeys(
  Buffer.alloc(32, 11).toString("base64"),
  Buffer.alloc(32, 12).toString("base64"),
  "integration-v1",
);

describe("database-driven fake closeout workflow", () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: FieldCloseDatabase;
  let workspaceId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("fieldclose_workflow_test")
      .withUsername("fieldclose")
      .withPassword("fieldclose")
      .start();

    const database = createDatabase(container.getConnectionUri());
    client = database.client;
    db = database.db;
    await migrate(db, { migrationsFolder });

    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'workflow-owner',
        'Workflow demo owner',
        'workflow-owner@fieldclose.invalid',
        true,
        now()
      )
    `;

    const workspace = await ensurePersonalDemoWorkspace(db, {
      id: "workflow-owner",
      name: "Workflow demo owner",
    });
    workspaceId = workspace.id;

    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'workflow-auditor',
        'Workflow auditor',
        'workflow-auditor@fieldclose.invalid',
        true,
        now()
      )
    `;
    await client`
      insert into workspace_membership (workspace_id, user_id, role)
      values (${workspaceId}, 'workflow-auditor', 'auditor')
    `;
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("persists an approved result and makes duplicate execution idempotent", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-RESOLVED");
    const provider = new CountingProvider(
      new FakeCallProvider("resolved_clear"),
    );

    const repeatedApproval = await approveFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(fixture.preview),
      phoneKeys,
    );

    expect(repeatedApproval).toMatchObject({
      reused: true,
      attempt: { id: fixture.attemptId },
    });

    const first = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );
    const duplicate = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );

    expect(first).toMatchObject({
      state: "completed",
      result: { route: "ready_for_closeout_review" },
    });
    expect(duplicate).toEqual(first);
    expect(provider.createCount).toBe(1);
    expect(provider.getCount).toBe(1);

    const [counts] = await client<
      {
        attempt_count: number;
        approval_count: number;
        result_count: number;
        task_count: number;
        case_status: string;
      }[]
    >`
      select
        (select count(*)::int from call_attempt where case_id = ${fixture.caseId}) as attempt_count,
        (select count(*)::int from call_approval where case_id = ${fixture.caseId}) as approval_count,
        (select count(*)::int from call_result where case_id = ${fixture.caseId}) as result_count,
        (select count(*)::int from follow_up_task where case_id = ${fixture.caseId}) as task_count,
        (select status::text from closeout_case where id = ${fixture.caseId}) as case_status
    `;

    expect(counts).toEqual({
      attempt_count: 1,
      approval_count: 1,
      result_count: 1,
      task_count: 1,
      case_status: "completed",
    });

    const [task] = await client<{ type: string; reason_codes: string[] }[]>`
      select type::text, reason_codes
      from follow_up_task
      where case_id = ${fixture.caseId}
    `;
    expect(task).toEqual({
      type: "closeout_review",
      reason_codes: ["normalized_result_ready"],
    });

    const cases = await listCloseoutCases(
      db,
      "workflow-owner",
      workspaceId,
    );
    const listed = cases.find((item) => item.id === fixture.caseId);
    expect(listed).toMatchObject({
      status: "completed",
      phoneMasked: "+*******0142",
      providerTaskStatus: "completed",
    });

    const detail = await getCloseoutCaseDetail(
      db,
      "workflow-owner",
      workspaceId,
      fixture.caseId,
    );
    expect(detail).toMatchObject({
      case: { id: fixture.caseId, contact: { phoneMasked: "+*******0142" } },
      attempt: { id: fixture.attemptId },
      result: { route: "ready_for_closeout_review" },
      tasks: [{ type: "closeout_review" }],
    });
    expect(JSON.stringify({ cases, detail })).not.toContain("+12025550142");
  });

  it("routes a reported issue to return-visit review without a commitment", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-RETURN");

    const execution = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      new FakeCallProvider("issue_return_requested"),
      phoneKeys,
    );

    expect(execution).toMatchObject({
      state: "completed",
      result: { route: "return_visit_review" },
    });
    const [task] = await client<{ type: string }[]>`
      select type::text
      from follow_up_task
      where case_id = ${fixture.caseId}
    `;
    expect(task?.type).toBe("return_visit_review");
  });

  it("records a durable do-not-call block before any future approval", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-DNC");

    await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      new FakeCallProvider("do_not_call"),
      phoneKeys,
    );

    const [contact] = await client<{ do_not_call_at: string | null }[]>`
      select contact.do_not_call_at
      from closeout_case
      inner join contact on contact.id = closeout_case.contact_id
      where closeout_case.id = ${fixture.caseId}
    `;
    expect(contact?.do_not_call_at).not.toBeNull();
    expect(Date.parse(contact?.do_not_call_at ?? "")).not.toBeNaN();

    await expect(
      approveFakeAttempt(
        db,
        "workflow-owner",
        workspaceId,
        fixture.caseId,
        approvalInput(fixture.preview),
        phoneKeys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });

    const [task] = await client<{ type: string }[]>`
      select type::text
      from follow_up_task
      where case_id = ${fixture.caseId}
    `;
    expect(task?.type).toBe("privacy_request");
  });

  it("propagates a do-not-call block to existing contacts with the same phone number", async () => {
    const first = await createApprovedFixture("WO-WORKFLOW-DNC-CROSS-1");
    const second = await createCase("WO-WORKFLOW-DNC-CROSS-2");

    await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      first.attemptId,
      new FakeCallProvider("do_not_call"),
      phoneKeys,
    );

    const [otherCaseContact] = await client<{ do_not_call_at: string | null }[]>`
      select contact.do_not_call_at
      from closeout_case
      inner join contact on contact.id = closeout_case.contact_id
      where closeout_case.id = ${second.case.id}
    `;
    expect(otherCaseContact?.do_not_call_at).not.toBeNull();

    const preview = await previewFakeCallBrief(
      db,
      "workflow-owner",
      workspaceId,
      second.case.id,
      phoneKeys,
    );
    await expect(
      approveFakeAttempt(
        db,
        "workflow-owner",
        workspaceId,
        second.case.id,
        approvalInput(preview),
        phoneKeys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
  });

  it("preserves malformed provider output as a human technical review", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-MALFORMED");

    const execution = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      new FakeCallProvider("malformed_provider_result"),
      phoneKeys,
    );

    expect(execution).toMatchObject({
      state: "completed",
      attempt: { errorCode: "result_validation_failed" },
      result: {
        route: "human_follow_up",
        validationFailed: true,
      },
    });

    const [stored] = await client<
      { case_status: string; task_type: string; escalation_reasons: string[] }[]
    >`
      select
        closeout_case.status::text as case_status,
        follow_up_task.type::text as task_type,
        call_result.escalation_reasons
      from closeout_case
      inner join follow_up_task on follow_up_task.case_id = closeout_case.id
      inner join call_result on call_result.case_id = closeout_case.id
      where closeout_case.id = ${fixture.caseId}
    `;
    expect(stored).toEqual({
      case_status: "needs_attention",
      task_type: "technical_review",
      escalation_reasons: ["result_validation_failed"],
    });
  });

  it("never completes a case from a failed provider task carrying a schema-valid result", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-FAILED-RESULT");
    const provider: CallProvider = {
      providerName: "fake",
      async createCall() {
        return {
          disposition: "created",
          providerCallId: "call_failed_with_valid_result",
          taskStatus: "queued",
        };
      },
      async getCall() {
        return {
          providerCallId: "call_failed_with_valid_result",
          taskStatus: "failed",
          attemptOutcome: "unknown",
          structuredResult: {
            contactVerification: "authorized_role",
            observedOperatingStatus: "operating_as_expected",
            unresolvedIssue: { value: "no", confidence: "high", evidenceRefs: [] },
            returnVisitRequested: {
              value: "no",
              confidence: "high",
              evidenceRefs: [],
            },
            preferredWindows: [],
            administrativeResults: {},
            outOfScopeTopics: [],
            escalationReasons: [],
            summary: "This stale result must never close the case.",
            evidenceRefs: [],
          },
        };
      },
    };

    const execution = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );

    expect(execution).toMatchObject({
      state: "completed",
      attempt: { providerTaskStatus: "failed" },
      result: { route: "failed" },
    });

    const [stored] = await client<
      { case_status: string; route: string; task_type: string }[]
    >`
      select
        closeout_case.status::text as case_status,
        call_result.route::text as route,
        follow_up_task.type::text as task_type
      from closeout_case
      inner join call_result on call_result.case_id = closeout_case.id
      inner join follow_up_task on follow_up_task.case_id = closeout_case.id
      where closeout_case.id = ${fixture.caseId}
    `;
    expect(stored).toEqual({
      case_status: "failed",
      route: "failed",
      task_type: "contact_review",
    });
  });

  it("freezes an ambiguous creation outcome and never submits it twice", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-AMBIGUOUS");
    const provider = new CountingProvider(
      new FakeCallProvider("creation_timeout_unknown"),
    );

    const first = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );
    const duplicate = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );

    expect(first).toMatchObject({
      state: "reconciliation_required",
      attempt: {
        providerCallId: null,
        creationDisposition: "ambiguous_requires_reconciliation",
      },
    });
    expect(duplicate).toEqual(first);
    expect(provider.createCount).toBe(1);
    expect(provider.getCount).toBe(0);

    const [stored] = await client<
      { case_status: string; task_count: number; task_type: string }[]
    >`
      select
        closeout_case.status::text as case_status,
        count(follow_up_task.id)::int as task_count,
        min(follow_up_task.type::text) as task_type
      from closeout_case
      inner join follow_up_task on follow_up_task.case_id = closeout_case.id
      where closeout_case.id = ${fixture.caseId}
      group by closeout_case.status
    `;
    expect(stored).toEqual({
      case_status: "needs_attention",
      task_count: 1,
      task_type: "provider_reconciliation",
    });
  });

  it("fails safely when the provider proves no call was accepted", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-FAILED");
    const provider: CallProvider = {
      providerName: "fake",
      async createCall() {
        return {
          disposition: "failed_before_acceptance",
          errorCode: "fake_provider_rejected",
        };
      },
      async getCall() {
        throw new Error("A rejected call cannot be retrieved");
      },
    };

    const execution = await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      provider,
      phoneKeys,
    );

    expect(execution).toMatchObject({
      state: "failed",
      attempt: {
        providerCallId: null,
        creationDisposition: "failed_before_acceptance",
        errorCode: "fake_provider_rejected",
      },
    });
  });

  it("cannot execute a demo attempt through a provider labelled for live calls", async () => {
    const fixture = await createApprovedFixture("WO-WORKFLOW-LIVE-BLOCK");
    let createCount = 0;
    const provider: CallProvider = {
      providerName: "call_e",
      async createCall() {
        createCount += 1;
        return {
          disposition: "failed_before_acceptance",
          errorCode: "must_not_be_reached",
        };
      },
      async getCall() {
        throw new Error("A live provider must not run in a demo workspace");
      },
    };

    await expect(
      executeApprovedFakeAttempt(
        db,
        "workflow-owner",
        workspaceId,
        fixture.attemptId,
        provider,
        phoneKeys,
      ),
    ).rejects.toMatchObject({ code: "fake_provider_required" });
    expect(createCount).toBe(0);
  });

  it("records one atomic closeout disposition under concurrent exact repeats", async () => {
    const detail = await executeScenario(
      "WO-WORKFLOW-DISPOSITION-CLOSEOUT",
      "resolved_clear",
    );
    const task = detail.tasks.find((item) => item.status === "open");
    expect(task?.type).toBe("closeout_review");

    const input = {
      expectedCaseVersion: detail.case.version,
      taskId: task!.id,
      outcome: "closeout_accepted" as const,
      resolutionNote: null,
    };
    const [first, second] = await Promise.all([
      recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        input,
      ),
      recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        input,
      ),
    ]);

    expect(first.disposition.id).toBe(second.disposition.id);
    expect([first.reused, second.reused].sort()).toEqual([false, true]);

    const [stored] = await client<
      {
        disposition_count: number;
        audit_count: number;
        case_status: string;
        case_version: number;
        task_status: string;
        assigned_to: string | null;
      }[]
    >`
      select
        (select count(*)::int from human_disposition where case_id = ${detail.case.id}) as disposition_count,
        (select count(*)::int from audit_event where case_id = ${detail.case.id} and event_type = 'case.human_disposition_recorded') as audit_count,
        (select status::text from closeout_case where id = ${detail.case.id}) as case_status,
        (select version from closeout_case where id = ${detail.case.id}) as case_version,
        (select status::text from follow_up_task where id = ${task!.id}) as task_status,
        (select assigned_to from follow_up_task where id = ${task!.id}) as assigned_to
    `;
    expect(stored).toEqual({
      disposition_count: 1,
      audit_count: 1,
      case_status: "closed",
      case_version: detail.case.version + 1,
      task_status: "resolved",
      assigned_to: "workflow-owner",
    });

    const finalDetail = await getCloseoutCaseDetail(
      db,
      "workflow-owner",
      workspaceId,
      detail.case.id,
    );
    expect(finalDetail).toMatchObject({
      case: { status: "closed", version: detail.case.version + 1 },
      disposition: {
        id: first.disposition.id,
        taskId: task!.id,
        outcome: "closeout_accepted",
        recordedBy: "workflow-owner",
      },
      tasks: [{ id: task!.id, status: "resolved" }],
    });
    expect(JSON.stringify(finalDetail.audit)).not.toContain("12025550142");
  });

  it.each([
    {
      scenarioId: "issue_return_requested",
      workOrderRef: "WO-WORKFLOW-DISPOSITION-RETURN",
      outcome: "return_visit_handoff" as const,
      resolutionNote: "Service coordinator owns return-visit review.",
      expectedTaskStatus: "resolved",
    },
    {
      scenarioId: "wrong_person",
      workOrderRef: "WO-WORKFLOW-DISPOSITION-MANUAL",
      outcome: "manual_follow_up_handoff" as const,
      resolutionNote: "Office manager owns authorized-contact follow-up.",
      expectedTaskStatus: "resolved",
    },
    {
      scenarioId: "do_not_call",
      workOrderRef: "WO-WORKFLOW-DISPOSITION-STOP",
      outcome: "no_further_automated_action" as const,
      resolutionNote: null,
      expectedTaskStatus: "cancelled",
    },
  ])(
    "persists $outcome without performing an external action",
    async ({
      expectedTaskStatus,
      outcome,
      resolutionNote,
      scenarioId,
      workOrderRef,
    }) => {
      const detail = await executeScenario(
        workOrderRef,
        scenarioId as FakeScenarioId,
      );
      const task = detail.tasks.find((item) => item.status === "open");
      expect(task).toBeDefined();

      const recorded = await recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        {
          expectedCaseVersion: detail.case.version,
          taskId: task!.id,
          outcome,
          resolutionNote,
        },
      );

      expect(recorded).toMatchObject({
        reused: false,
        case: { status: "closed", version: detail.case.version + 1 },
        task: {
          id: task!.id,
          status: expectedTaskStatus,
          resolutionNote,
        },
        disposition: { outcome, resolutionNote },
        audit: { eventType: "case.human_disposition_recorded" },
      });
    },
  );

  it("rejects auditors, stale state, invalid routes, and conflicting decisions atomically", async () => {
    const detail = await executeScenario(
      "WO-WORKFLOW-DISPOSITION-GATES",
      "issue_return_requested",
    );
    const task = detail.tasks.find((item) => item.status === "open");
    expect(task?.type).toBe("return_visit_review");

    const validInput = {
      expectedCaseVersion: detail.case.version,
      taskId: task!.id,
      outcome: "return_visit_handoff" as const,
      resolutionNote: "Dispatcher owns the return-visit review.",
    };

    await expect(
      recordHumanDisposition(
        db,
        "workflow-auditor",
        workspaceId,
        detail.case.id,
        validInput,
      ),
    ).rejects.toMatchObject({ code: "operator_role_forbidden" });
    await expect(
      recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        { ...validInput, expectedCaseVersion: detail.case.version + 1 },
      ),
    ).rejects.toMatchObject({ code: "stale_case_version" });
    await expect(
      recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        {
          ...validInput,
          outcome: "closeout_accepted",
          resolutionNote: null,
        },
      ),
    ).rejects.toMatchObject({ code: "disposition_outcome_not_allowed" });

    const unchanged = await getCloseoutCaseDetail(
      db,
      "workflow-owner",
      workspaceId,
      detail.case.id,
    );
    expect(unchanged).toMatchObject({
      case: { status: "completed", version: detail.case.version },
      disposition: null,
      tasks: [{ id: task!.id, status: "open" }],
    });

    await recordHumanDisposition(
      db,
      "workflow-owner",
      workspaceId,
      detail.case.id,
      validInput,
    );
    await expect(
      recordHumanDisposition(
        db,
        "workflow-owner",
        workspaceId,
        detail.case.id,
        {
          ...validInput,
          outcome: "manual_follow_up_handoff",
        },
      ),
    ).rejects.toMatchObject({ code: "human_disposition_conflict" });
  });

  it("rejects stale approval inputs and never exposes the canonical phone", async () => {
    const created = await createCase("WO-WORKFLOW-PREFLIGHT");
    const preview = await previewFakeCallBrief(
      db,
      "workflow-owner",
      workspaceId,
      created.case.id,
      phoneKeys,
    );

    expect(JSON.stringify(created)).not.toContain("+12025550142");
    expect(JSON.stringify(preview)).not.toContain("+12025550142");
    expect(preview.brief.recipient.phoneMasked).toBe("+*******0142");

    await expect(
      approveFakeAttempt(
        db,
        "workflow-owner",
        workspaceId,
        created.case.id,
        {
          ...approvalInput(preview),
          expectedCaseVersion: preview.caseVersion + 1,
        },
        phoneKeys,
      ),
    ).rejects.toMatchObject({ code: "stale_case_version" });

    await expect(
      approveFakeAttempt(
        db,
        "workflow-owner",
        workspaceId,
        created.case.id,
        {
          ...approvalInput(preview),
          expectedBriefHash: "0".repeat(64),
        },
        phoneKeys,
      ),
    ).rejects.toMatchObject({ code: "brief_hash_mismatch" });

    const [stored] = await client<
      { phone_e164_ciphertext: string; audit_text: string }[]
    >`
      select
        contact.phone_e164_ciphertext,
        coalesce(string_agg(audit_event.metadata::text, ' '), '') as audit_text
      from closeout_case
      inner join contact on contact.id = closeout_case.contact_id
      left join audit_event on audit_event.case_id = closeout_case.id
      where closeout_case.id = ${created.case.id}
      group by contact.phone_e164_ciphertext
    `;
    expect(stored?.phone_e164_ciphertext).not.toContain("12025550142");
    expect(stored?.audit_text).not.toContain("12025550142");
  });

  async function createApprovedFixture(workOrderRef: string) {
    const created = await createCase(workOrderRef);
    const preview = await previewFakeCallBrief(
      db,
      "workflow-owner",
      workspaceId,
      created.case.id,
      phoneKeys,
    );
    const approved = await approveFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      created.case.id,
      approvalInput(preview),
      phoneKeys,
    );

    expect(approved.reused).toBe(false);

    return {
      caseId: created.case.id,
      attemptId: approved.attempt.id,
      preview,
    };
  }

  async function executeScenario(
    workOrderRef: string,
    scenarioId: FakeScenarioId,
  ) {
    const fixture = await createApprovedFixture(workOrderRef);
    await executeApprovedFakeAttempt(
      db,
      "workflow-owner",
      workspaceId,
      fixture.attemptId,
      new FakeCallProvider(scenarioId),
      phoneKeys,
    );

    return getCloseoutCaseDetail(
      db,
      "workflow-owner",
      workspaceId,
      fixture.caseId,
    );
  }

  function createCase(workOrderRef: string) {
    return createDemoCloseoutCase(
      db,
      "workflow-owner",
      workspaceId,
      {
        workOrderRef,
        contractorDisplayName: "Example HVAC",
        siteLabel: "Fictional North Store",
        timezone: "America/Chicago",
        contact: {
          displayName: null,
          role: "site_manager",
          phoneE164: "+12025550142",
        },
        requestedFields: [
          "observed_operating_status",
          "unresolved_issue",
          "return_visit_request",
        ],
        visitContext: {
          serviceDate: "2026-07-27",
          equipmentLabel: "Rooftop unit RTU-2",
          technicianCompletionNote: "Filter replaced and unit restarted",
          allowedReferenceText:
            "A fictional technician visited to service rooftop unit RTU-2.",
        },
      },
      phoneKeys,
    );
  }
});

function approvalInput(preview: {
  caseVersion: number;
  briefHash: string;
}): FakeAttemptApprovalInput {
  return {
    expectedCaseVersion: preview.caseVersion,
    expectedBriefHash: preview.briefHash,
    callingWindow: {
      timezone: "America/Chicago",
      startLocal: "2026-07-28T09:00:00",
      endLocal: "2026-07-28T17:00:00",
      evaluatedAt: "2026-07-28T08:55:00Z",
    },
    operatorAttestations: [
      "contact_authorized",
      "brief_reviewed",
      "fictional_demo_only",
    ],
  };
}

class CountingProvider implements CallProvider {
  readonly providerName: "fake" | "call_e";
  createCount = 0;
  getCount = 0;

  constructor(private readonly delegate: CallProvider) {
    this.providerName = delegate.providerName;
  }

  async createCall(
    request: CreateCallRequest,
  ): Promise<ProviderCreationOutcome> {
    this.createCount += 1;
    return this.delegate.createCall(request);
  }

  async getCall(providerCallId: string) {
    this.getCount += 1;
    return this.delegate.getCall(providerCallId);
  }
}
