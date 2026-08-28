import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  approveLiveAttempt,
  cancelProtectedCloseoutCase,
  createProtectedCloseoutCase,
  executeApprovedLiveAttempt,
  liveCreationClaimLeaseMs,
  previewLiveCallBrief,
  refreshAcceptedLiveAttempt,
  type LiveAttemptApprovalInput,
  type ProtectedCloseoutCaseInput,
} from "@/application/live-closeout-workflow";
import { parseServerEnvironment } from "@/config/environment";
import {
  createDatabase,
  type FieldCloseDatabase,
} from "@/persistence/database";
import {
  callAttempts,
  callApprovals,
  callResults,
  closeoutCases,
  contacts,
  followUpTasks,
} from "@/persistence/schema";
import type {
  CallProvider,
  CreateCallRequest,
  ProviderCallSnapshot,
  ProviderCreationOutcome,
} from "@/providers/types";
import {
  createPhoneProtectionKeys,
  protectPhoneNumber,
} from "@/security/phone-protection";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
const workspaceId = "c43e1768-a4fe-45e3-9b92-b286330e8189";
const keys = createPhoneProtectionKeys(
  Buffer.alloc(32, 21).toString("base64"),
  Buffer.alloc(32, 22).toString("base64"),
  "live-integration-v1",
);
const environment = parseServerEnvironment({
  NODE_ENV: "test",
  FIELDCLOSE_DEMO_MODE: "false",
  FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
  FIELDCLOSE_PUBLIC_BASE_URL: "https://fieldclose.test",
  CALL_E_API_KEY: "integration-api-key",
});
const approvedNow = new Date("2026-07-29T15:00:00Z");

describe("protected live closeout workflow", () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: FieldCloseDatabase;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("fieldclose_live_workflow_test")
      .withUsername("fieldclose")
      .withPassword("fieldclose")
      .start();

    const database = createDatabase(container.getConnectionUri());
    client = database.client;
    db = database.db;
    await migrate(db, { migrationsFolder });

    await client`
      insert into "user" (
        id, name, email, email_verified, updated_at
      ) values (
        'live-owner',
        'Live workflow owner',
        'live-owner@fieldclose.invalid',
        true,
        now()
      )
    `;
    await client`
      insert into workspace (
        id, slug, display_name, kind, provider, live_calls_allowed, owner_user_id
      ) values (
        ${workspaceId},
        'live-workflow-test',
        'Live workflow test',
        'protected',
        'call_e',
        true,
        'live-owner'
      )
    `;
    await client`
      insert into workspace_membership (
        workspace_id, user_id, role
      ) values (
        ${workspaceId},
        'live-owner',
        'owner'
      )
    `;
    await client`
      insert into "user" (
        id, name, email, email_verified, updated_at
      ) values (
        'live-auditor',
        'Live workflow auditor',
        'live-auditor@fieldclose.invalid',
        true,
        now()
      )
    `;
    await client`
      insert into workspace_membership (
        workspace_id, user_id, role
      ) values (
        ${workspaceId},
        'live-auditor',
        'auditor'
      )
    `;
    await setKillSwitch(client, false);
  }, 120_000);

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  afterEach(async () => {
    await db?.update(contacts).set({ doNotCallAt: null });
  });

  it("creates a protected case only with an explicit non-demo authorization record", async () => {
    const created = await createProtectedCloseoutCase(
      db,
      "live-owner",
      workspaceId,
      {
        workOrderRef: "WO-LIVE-CREATE",
        contractorDisplayName: "Example HVAC",
        siteLabel: "Synthetic protected site",
        timezone: "America/Chicago",
        contact: {
          displayName: "Authorized site role",
          role: "site_manager",
          phoneE164: "+12025550142",
          authorizationBasis:
            "contractor_provided_authorized_contact",
          authorizationNote:
            "The contractor confirmed this business contact and purpose.",
        },
        requestedFields: [
          "observed_operating_status",
          "unresolved_issue",
        ],
        visitContext: {
          serviceDate: "2026-07-28",
          equipmentLabel: "RTU-2",
          technicianCompletionNote: "Synthetic integration fixture.",
          allowedReferenceText: "A fictional technician visited RTU-2.",
        },
      },
      keys,
    );

    expect(created).toMatchObject({
      case: {
        workOrderRef: "WO-LIVE-CREATE",
        status: "draft",
      },
      contact: {
        phoneMasked: "+*******0142",
        authorizationBasis:
          "contractor_provided_authorized_contact",
      },
    });
    expect(JSON.stringify(created)).not.toContain("+12025550142");
  });

  it("rejects a non-US live recipient before storing protected contact data", async () => {
    await expect(
      createProtectedCloseoutCase(
        db,
        "live-owner",
        workspaceId,
        protectedCaseInput("WO-LIVE-NON-US", "+442079460000"),
        keys,
      ),
    ).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          path: ["contact", "phoneE164"],
          message: "Enter an explicit US E.164 number beginning with +1.",
        }),
      ],
    });
  });

  it("blocks creating a protected case for a suppressed phone number", async () => {
    await createProtectedCase(db, "WO-LIVE-DNC-SUPPRESSED");

    const existing = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.workspaceId, workspaceId))
      .limit(1);
    await db
      .update(contacts)
      .set({ doNotCallAt: new Date(), updatedAt: new Date() })
      .where(eq(contacts.id, existing![0].id));

    await expect(
      createProtectedCloseoutCase(
        db,
        "live-owner",
        workspaceId,
        {
          workOrderRef: "WO-LIVE-DNC-BLOCKED",
          contractorDisplayName: "Example HVAC",
          siteLabel: "Synthetic protected site",
          timezone: "America/Chicago",
          contact: {
            displayName: "Authorized site role",
            role: "site_manager",
            phoneE164: "+12025550142",
            authorizationBasis: "contractor_provided_authorized_contact",
            authorizationNote:
              "The contractor confirmed this business contact and purpose.",
          },
          requestedFields: ["observed_operating_status"],
          visitContext: {
            serviceDate: "2026-07-28",
            equipmentLabel: "RTU-2",
            technicianCompletionNote: "Synthetic integration fixture.",
            allowedReferenceText: "A fictional technician visited RTU-2.",
          },
        },
        keys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
  });

  it("blocks a protected case when any existing row for the recipient is suppressed", async () => {
    const phoneE164 = "+12025550143";
    const protectedPhone = protectPhoneNumber(phoneE164, keys);

    await db.insert(contacts).values([
      {
        workspaceId,
        displayName: "Earlier unsuppressed row",
        role: "site_manager",
        ...protectedPhone,
        authorizationBasis: "contractor_provided_authorized_contact",
        authorizationNote: "Synthetic unsuppressed legacy row.",
      },
      {
        workspaceId,
        displayName: "Later suppressed row",
        role: "site_manager",
        ...protectedPhone,
        authorizationBasis: "contractor_provided_authorized_contact",
        authorizationNote: "Synthetic suppressed legacy row.",
        doNotCallAt: new Date(),
      },
    ]);

    await expect(
      createProtectedCloseoutCase(
        db,
        "live-owner",
        workspaceId,
        protectedCaseInput("WO-LIVE-DNC-MIXED-ROWS", phoneE164),
        keys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
  });

  it("serializes protected case creation with recipient suppression", async () => {
    const phoneE164 = "+12025550144";
    const protectedPhone = protectPhoneNumber(phoneE164, keys);
    const lockKey = `fieldclose:closeout:${workspaceId}:${protectedPhone.phoneLookupHash}`;
    let releaseSuppression!: () => void;
    let reportSuppressionReady!: () => void;
    const suppressionReady = new Promise<void>((resolve) => {
      reportSuppressionReady = resolve;
    });
    const suppressionRelease = new Promise<void>((resolve) => {
      releaseSuppression = resolve;
    });
    const suppressionTransaction = db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      await transaction.insert(contacts).values({
        workspaceId,
        displayName: "Concurrent suppressed recipient",
        role: "site_manager",
        ...protectedPhone,
        authorizationBasis: "contractor_provided_authorized_contact",
        authorizationNote: "Synthetic concurrent suppression fixture.",
        doNotCallAt: new Date(),
      });
      reportSuppressionReady();
      await suppressionRelease;
    });

    await suppressionReady;
    let creationSettled = false;
    const creation = createProtectedCloseoutCase(
      db,
      "live-owner",
      workspaceId,
      protectedCaseInput("WO-LIVE-DNC-CONCURRENT", phoneE164),
      keys,
    )
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      )
      .finally(() => {
        creationSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(creationSettled).toBe(false);

    releaseSuppression();
    await suppressionTransaction;
    const outcome = await creation;

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") {
      expect(outcome.error).toMatchObject({ code: "contact_do_not_call" });
    }
  });

  it("persists a plain refusal across future protected cases for the recipient", async () => {
    const phoneE164 = "+12025550145";
    const created = await createProtectedCloseoutCase(
      db,
      "live-owner",
      workspaceId,
      protectedCaseInput("WO-LIVE-REFUSED-SOURCE", phoneE164),
      keys,
    );
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      created.case.id,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      created.case.id,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_refused",
        taskStatus: "queued",
      },
      [refusedProviderSnapshot("call_live_refused")],
    );

    await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      approvedNow,
    );
    const [storedAttempt] = await db
      .select({ acceptedAt: callAttempts.acceptedAt })
      .from(callAttempts)
      .where(eq(callAttempts.id, approved.attempt.id))
      .limit(1);
    if (!storedAttempt?.acceptedAt) {
      throw new Error("The refused-call fixture was not accepted");
    }
    await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      new Date(storedAttempt.acceptedAt.getTime() + 5_000),
    );

    await expect(
      createProtectedCloseoutCase(
        db,
        "live-owner",
        workspaceId,
        protectedCaseInput("WO-LIVE-REFUSED-BLOCKED", phoneE164),
        keys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
  });

  it("blocks approval when another row for the same recipient becomes suppressed", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-DNC-BEFORE-APPROVAL");
    await db.insert(contacts).values({
      workspaceId,
      displayName: "Suppressed duplicate recipient",
      role: "site_manager",
      ...protectPhoneNumber("+12025550142", keys),
      authorizationBasis: "contractor_provided_authorized_contact",
      authorizationNote: "Synthetic suppression before approval.",
      doNotCallAt: new Date(),
    });
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );

    await expect(
      approveLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        fixture.caseId,
        approvalInput(preview.briefHash),
        keys,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
  });

  it("rechecks recipient-wide suppression immediately before CALL-E creation", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-DNC-BEFORE-CREATE");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    await db.insert(contacts).values({
      workspaceId,
      displayName: "Suppressed duplicate before creation",
      role: "site_manager",
      ...protectPhoneNumber("+12025550142", keys),
      authorizationBasis: "contractor_provided_authorized_contact",
      authorizationNote: "Synthetic suppression before provider creation.",
      doNotCallAt: new Date(),
    });
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_must_not_be_created_for_suppressed_recipient",
      taskStatus: "queued",
    });

    await expect(
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        approvedNow,
      ),
    ).rejects.toMatchObject({ code: "contact_do_not_call" });
    expect(provider.requests).toHaveLength(0);
  });

  it("cancels a protected case and blocks later approval", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-CANCEL");

    const cancelled = await cancelProtectedCloseoutCase(
      db,
      "live-owner",
      workspaceId,
      fixture.caseId,
    );

    expect(cancelled).toMatchObject({ caseId: fixture.caseId, status: "cancelled" });

    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    await expect(
      approveLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        fixture.caseId,
        approvalInput(preview.briefHash),
        keys,
      ),
    ).rejects.toMatchObject({ code: "case_cancelled" });
  });

  it("invalidates an approved attempt when it is cancelled before provider creation", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-CANCEL-APPROVED");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );

    await cancelProtectedCloseoutCase(
      db,
      "live-owner",
      workspaceId,
      fixture.caseId,
    );

    const [storedApproval] = await db
      .select({ invalidatedAt: callApprovals.invalidatedAt })
      .from(callApprovals)
      .where(eq(callApprovals.id, approved.approval.id))
      .limit(1);
    expect(storedApproval?.invalidatedAt).toBeInstanceOf(Date);

    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_cancelled_approved",
      taskStatus: "queued",
    });
    await expect(
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        approvedNow,
      ),
    ).rejects.toMatchObject({ code: "attempt_not_executable" });
    expect(provider.requests).toHaveLength(0);
  });

  it("does not claim local cancellation after provider acceptance", async () => {
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_live_cancel_too_late",
      taskStatus: "queued",
    });
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-CANCEL-TOO-LATE",
      provider,
    );

    await expect(
      cancelProtectedCloseoutCase(
        db,
        "live-owner",
        workspaceId,
        accepted.caseId,
      ),
    ).rejects.toMatchObject({ code: "case_cancellation_not_safe" });

    const [storedCase] = await db
      .select({ status: closeoutCases.status })
      .from(closeoutCases)
      .where(eq(closeoutCases.id, accepted.caseId))
      .limit(1);
    expect(storedCase?.status).toBe("calling");
  });

  it("allows pre-creation cancellation while live-call creation is paused", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-CANCEL-WHILE-PAUSED");
    await setKillSwitch(client, true);

    try {
      await expect(
        cancelProtectedCloseoutCase(
          db,
          "live-owner",
          workspaceId,
          fixture.caseId,
        ),
      ).resolves.toMatchObject({ status: "cancelled" });
    } finally {
      await setKillSwitch(client, false);
    }
  });

  it("previews, live-approves, and invokes CALL-E once with a stable approved request", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-ONCE");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_live_once",
      taskStatus: "queued",
    });

    const first = await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      approvedNow,
    );
    const duplicateBrowserAction = await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      approvedNow,
    );

    expect(preview).toMatchObject({
      mode: "live",
      provider: "call_e",
      brief: {
        recipient: { phoneMasked: "+*******0142" },
      },
    });
    expect(approved.approval.liveCallApproved).toBe(true);
    expect(first).toMatchObject({
      state: "in_progress",
      attempt: {
        providerCallId: "call_live_once",
        creationDisposition: "created",
      },
    });
    expect(duplicateBrowserAction).toMatchObject({
      state: "in_progress",
      attempt: { providerCallId: "call_live_once" },
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]).toMatchObject({
      attemptId: approved.attempt.id,
      idempotencyKey: `fieldclose:attempt:${approved.attempt.id}`,
      brief: {
        attemptId: approved.attempt.id,
        recipient: { phoneE164: "+12025550142" },
      },
    });
  });

  it("serializes concurrent live creation to one consistent recorded outcome", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-CONCURRENT-EXECUTE");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_live_concurrent_execute",
      taskStatus: "queued",
    });

    const results = await Promise.all([
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        approvedNow,
      ),
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        approvedNow,
      ),
    ]);

    expect(provider.requests).toHaveLength(1);

    // Both requests remain bound to the same attempt. The request that loses
    // the durable creation claim can return before provider acceptance is
    // stored, so only the winning response is required to carry the call ID.
    expect(results.every((result) => result.state === "in_progress")).toBe(
      true,
    );
    expect(
      results.every(
        (result) => result.attempt.id === approved.attempt.id,
      ),
    ).toBe(true);
    expect(
      results.filter(
        (result) =>
          result.attempt.providerCallId === "call_live_concurrent_execute",
      ),
    ).toHaveLength(1);

    // The durable attempt row must carry one consistent creation outcome.
    const [stored] = await db
      .select({
        providerCallId: callAttempts.providerCallId,
        creationDisposition: callAttempts.creationDisposition,
        acceptedAt: callAttempts.acceptedAt,
      })
      .from(callAttempts)
      .where(eq(callAttempts.id, approved.attempt.id))
      .limit(1);
    expect(stored).toMatchObject({
      providerCallId: "call_live_concurrent_execute",
      creationDisposition: "created",
    });
    expect(stored?.acceptedAt).toBeInstanceOf(Date);
  });

  it("recovers a calling attempt whose provider acceptance was not stored", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-ACCEPTANCE-RECOVERY");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    await db
      .update(closeoutCases)
      .set({ status: "calling", updatedAt: approvedNow })
      .where(eq(closeoutCases.id, fixture.caseId));
    await db
      .update(callAttempts)
      .set({ requestedAt: approvedNow, updatedAt: approvedNow })
      .where(eq(callAttempts.id, approved.attempt.id));
    const provider = new RecordingCallEProvider({
      disposition: "duplicate_returned",
      providerCallId: "call_live_recovered",
      taskStatus: "queued",
    });
    const recoveryNow = new Date(
      approvedNow.getTime() + liveCreationClaimLeaseMs,
    );

    const recovered = await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      recoveryNow,
    );

    expect(recovered).toMatchObject({
      state: "in_progress",
      attempt: {
        providerCallId: "call_live_recovered",
        creationDisposition: "duplicate_returned",
      },
    });
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.idempotencyKey).toBe(
      `fieldclose:attempt:${approved.attempt.id}`,
    );
  });

  it("rechecks the durable kill switch immediately before provider invocation", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-KILL-SWITCH");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_must_not_happen",
      taskStatus: "queued",
    });
    await setKillSwitch(client, true);

    await expect(
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        approvedNow,
      ),
    ).rejects.toMatchObject({
      code: "live_call_blocked_global_kill_switch_paused",
    });
    expect(provider.requests).toHaveLength(0);

    await setKillSwitch(client, false);
  });

  it("blocks execution outside the exact approved local calling window", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-WINDOW");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider({
      disposition: "created",
      providerCallId: "call_outside_window",
      taskStatus: "queued",
    });

    await expect(
      executeApprovedLiveAttempt(
        db,
        environment,
        "live-owner",
        workspaceId,
        approved.attempt.id,
        provider,
        keys,
        new Date("2026-07-30T02:00:00Z"),
      ),
    ).rejects.toMatchObject({ code: "outside_calling_window" });
    expect(provider.requests).toHaveLength(0);
  });

  it("freezes an ambiguous creation outcome and never auto-retries it", async () => {
    const fixture = await createProtectedCase(db, "WO-LIVE-AMBIGUOUS");
    const preview = await previewLiveCallBrief(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      keys,
    );
    const approved = await approveLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      fixture.caseId,
      approvalInput(preview.briefHash),
      keys,
    );
    const provider = new RecordingCallEProvider({
      disposition: "ambiguous_requires_reconciliation",
      errorCode: "call_e_transport_ambiguous",
    });

    const first = await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      approvedNow,
    );
    const second = await executeApprovedLiveAttempt(
      db,
      environment,
      "live-owner",
      workspaceId,
      approved.attempt.id,
      provider,
      keys,
      approvedNow,
    );

    expect(first.state).toBe("reconciliation_required");
    expect(second.state).toBe("reconciliation_required");
    expect(provider.requests).toHaveLength(1);
  });

  it("polls an accepted call without creating a result until the provider is terminal", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_polling",
        taskStatus: "queued",
      },
      [
        providerSnapshot("call_live_polling", "in_progress"),
        providerSnapshot("call_live_polling", "completed"),
      ],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-POLLING",
      provider,
    );
    const firstCheck = new Date(accepted.acceptedAt.getTime() + 5_000);

    const pending = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      firstCheck,
    );
    const throttled = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(firstCheck.getTime() + 1_000),
    );
    const resultBeforeTerminal = await db
      .select({ id: callResults.id })
      .from(callResults)
      .where(eq(callResults.attemptId, accepted.attemptId));
    const completed = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(firstCheck.getTime() + 5_000),
    );
    const duplicateRefresh = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(firstCheck.getTime() + 10_000),
    );

    expect(pending.state).toBe("in_progress");
    expect(throttled.state).toBe("in_progress");
    expect(resultBeforeTerminal).toHaveLength(0);
    expect(completed.state).toBe("completed");
    expect(duplicateRefresh.state).toBe("completed");
    expect(provider.requests).toHaveLength(1);
    expect(provider.lookups).toEqual([
      "call_live_polling",
      "call_live_polling",
    ]);
    await expect(
      db
        .select({ id: callResults.id })
        .from(callResults)
        .where(eq(callResults.attemptId, accepted.attemptId)),
    ).resolves.toHaveLength(1);
  });

  it("allows only one provider lookup for concurrent refreshes", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_concurrent",
        taskStatus: "queued",
      },
      [providerSnapshot("call_live_concurrent", "in_progress")],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-CONCURRENT",
      provider,
    );
    const refreshAt = new Date(accepted.acceptedAt.getTime() + 5_000);

    const results = await Promise.all([
      refreshAcceptedLiveAttempt(
        db,
        "live-owner",
        workspaceId,
        accepted.attemptId,
        provider,
        refreshAt,
      ),
      refreshAcceptedLiveAttempt(
        db,
        "live-owner",
        workspaceId,
        accepted.attemptId,
        provider,
        refreshAt,
      ),
    ]);

    expect(results.map((result) => result.state)).toEqual([
      "in_progress",
      "in_progress",
    ]);
    expect(provider.lookups).toEqual(["call_live_concurrent"]);
  });

  it("keeps transient lookup failures in progress and never retries call creation", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_transient",
        taskStatus: "queued",
      },
      [
        new Error("temporary lookup failure"),
        providerSnapshot("call_live_transient", "in_progress"),
      ],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-TRANSIENT",
      provider,
    );

    const failedLookup = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(accepted.acceptedAt.getTime() + 5_000),
    );
    const recoveredLookup = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(accepted.acceptedAt.getTime() + 10_000),
    );

    expect(failedLookup.state).toBe("in_progress");
    expect(recoveredLookup.state).toBe("in_progress");
    expect(provider.requests).toHaveLength(1);
    expect(provider.lookups).toHaveLength(2);
  });

  it("times out to one reconciliation task and can recover on a later manual refresh", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_timeout",
        taskStatus: "queued",
      },
      [
        providerSnapshot("call_live_timeout", "in_progress"),
        providerSnapshot("call_live_timeout", "completed"),
      ],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-TIMEOUT",
      provider,
    );
    const timeoutAt = new Date(accepted.acceptedAt.getTime() + 600_000);

    const timedOut = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      timeoutAt,
    );
    const stillThrottled = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(timeoutAt.getTime() + 1_000),
    );
    const recovered = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(timeoutAt.getTime() + 5_000),
    );
    const reconciliationTasks = await db
      .select({ status: followUpTasks.status })
      .from(followUpTasks)
      .where(eq(followUpTasks.caseId, accepted.caseId));

    expect(timedOut.state).toBe("reconciliation_required");
    expect(stillThrottled.state).toBe("reconciliation_required");
    expect(recovered.state).toBe("completed");
    expect(
      reconciliationTasks.filter(({ status }) => status === "resolved"),
    ).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });

  it("quarantines a provider call id mismatch without placing another call", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_expected",
        taskStatus: "queued",
      },
      [providerSnapshot("call_live_other", "completed")],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-MISMATCH",
      provider,
    );

    const refreshed = await refreshAcceptedLiveAttempt(
      db,
      "live-owner",
      workspaceId,
      accepted.attemptId,
      provider,
      new Date(accepted.acceptedAt.getTime() + 5_000),
    );

    expect(refreshed).toMatchObject({
      state: "reconciliation_required",
      attempt: { errorCode: "provider_call_id_mismatch" },
    });
    expect(provider.requests).toHaveLength(1);
  });

  it("retrieves an accepted result even after the live-call kill switch is paused", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_paused_after_acceptance",
        taskStatus: "queued",
      },
      [providerSnapshot("call_live_paused_after_acceptance", "completed")],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-PAUSED-REFRESH",
      provider,
    );

    await setKillSwitch(client, true);
    try {
      await expect(
        refreshAcceptedLiveAttempt(
          db,
          "live-owner",
          workspaceId,
          accepted.attemptId,
          provider,
          new Date(accepted.acceptedAt.getTime() + 5_000),
        ),
      ).resolves.toMatchObject({ state: "completed" });
    } finally {
      await setKillSwitch(client, false);
    }

    expect(provider.requests).toHaveLength(1);
  });

  it("rejects auditor refreshes before querying CALL-E", async () => {
    const provider = new RecordingCallEProvider(
      {
        disposition: "created",
        providerCallId: "call_live_auditor",
        taskStatus: "queued",
      },
      [providerSnapshot("call_live_auditor", "completed")],
    );
    const accepted = await createAcceptedAttempt(
      db,
      "WO-LIVE-AUDITOR-REFRESH",
      provider,
    );

    await expect(
      refreshAcceptedLiveAttempt(
        db,
        "live-auditor",
        workspaceId,
        accepted.attemptId,
        provider,
        new Date(accepted.acceptedAt.getTime() + 5_000),
      ),
    ).rejects.toMatchObject({ code: "operator_role_forbidden" });
    expect(provider.lookups).toHaveLength(0);
  });
});

class RecordingCallEProvider implements CallProvider {
  readonly providerName = "call_e" as const;
  readonly requests: CreateCallRequest[] = [];
  readonly lookups: string[] = [];

  constructor(
    private readonly outcome: ProviderCreationOutcome,
    private readonly snapshots: Array<ProviderCallSnapshot | Error> = [],
  ) {}

  async createCall(request: CreateCallRequest) {
    this.requests.push(request);
    return this.outcome;
  }

  async getCall(providerCallId: string): Promise<ProviderCallSnapshot> {
    this.lookups.push(providerCallId);
    const snapshot = this.snapshots.shift();

    if (snapshot instanceof Error) {
      throw snapshot;
    }
    if (!snapshot) {
      throw new Error("No provider snapshot was configured");
    }

    return snapshot;
  }
}

async function createAcceptedAttempt(
  db: FieldCloseDatabase,
  workOrderRef: string,
  provider: RecordingCallEProvider,
) {
  const fixture = await createProtectedCase(db, workOrderRef);
  const preview = await previewLiveCallBrief(
    db,
    environment,
    "live-owner",
    workspaceId,
    fixture.caseId,
    keys,
  );
  const approved = await approveLiveAttempt(
    db,
    environment,
    "live-owner",
    workspaceId,
    fixture.caseId,
    approvalInput(preview.briefHash),
    keys,
  );
  await executeApprovedLiveAttempt(
    db,
    environment,
    "live-owner",
    workspaceId,
    approved.attempt.id,
    provider,
    keys,
    approvedNow,
  );
  const [storedAttempt] = await db
    .select({ acceptedAt: callAttempts.acceptedAt })
    .from(callAttempts)
    .where(eq(callAttempts.id, approved.attempt.id))
    .limit(1);

  if (!storedAttempt?.acceptedAt) {
    throw new Error("The accepted live attempt fixture was not stored");
  }

  return {
    attemptId: approved.attempt.id,
    caseId: fixture.caseId,
    acceptedAt: storedAttempt.acceptedAt,
  };
}

function providerSnapshot(
  providerCallId: string,
  taskStatus: ProviderCallSnapshot["taskStatus"],
): ProviderCallSnapshot {
  return {
    providerCallId,
    taskStatus,
    attemptOutcome:
      taskStatus === "completed" ? "answered" : "not_determined",
    structuredResult:
      taskStatus === "completed"
        ? {
            contactVerification: "authorized_role",
            observedOperatingStatus: "operating_as_expected",
            unresolvedIssue: {
              value: "no",
              confidence: "high",
              evidenceRefs: [],
            },
            returnVisitRequested: {
              value: "no",
              confidence: "high",
              evidenceRefs: [],
            },
            preferredWindows: [],
            administrativeResults: {},
            outOfScopeTopics: [],
            escalationReasons: [],
            summary: "The authorized contact confirmed normal operation.",
            evidenceRefs: [],
          }
        : null,
  };
}

function refusedProviderSnapshot(providerCallId: string): ProviderCallSnapshot {
  return {
    providerCallId,
    taskStatus: "completed",
    attemptOutcome: "refused",
    structuredResult: {
      contactVerification: "refused",
      observedOperatingStatus: "refused",
      unresolvedIssue: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["recipient-refused"],
      },
      returnVisitRequested: {
        value: "refused",
        confidence: "high",
        evidenceRefs: ["recipient-refused"],
      },
      preferredWindows: [],
      administrativeResults: {},
      outOfScopeTopics: [],
      escalationReasons: ["recipient_refused"],
      summary: "The recipient refused the automated conversation.",
      evidenceRefs: ["recipient-refused"],
    },
  };
}

async function createProtectedCase(
  db: FieldCloseDatabase,
  workOrderRef: string,
) {
  const protectedPhone = protectPhoneNumber("+12025550142", keys);
  const [contact] = await db
    .insert(contacts)
    .values({
      workspaceId,
      displayName: "Authorized site role",
      role: "site_manager",
      ...protectedPhone,
      authorizationBasis: "contractor_provided_authorized_contact",
      authorizationNote:
        "The contractor confirmed this business contact and purpose.",
    })
    .returning({ id: contacts.id });

  if (!contact) {
    throw new Error("Unable to create the protected contact fixture");
  }

  const [closeoutCase] = await db
    .insert(closeoutCases)
    .values({
      workspaceId,
      workOrderRef,
      contractorDisplayName: "Example HVAC",
      siteLabel: "Synthetic protected site",
      timezone: "America/Chicago",
      contactId: contact.id,
      requestedFields: [
        "observed_operating_status",
        "unresolved_issue",
        "return_visit_request",
      ],
      visitContext: {
        serviceDate: "2026-07-28",
        equipmentLabel: "RTU-2",
        technicianCompletionNote: "Synthetic integration fixture.",
        allowedReferenceText: "A fictional technician visited RTU-2.",
      },
      createdBy: "live-owner",
    })
    .returning({ id: closeoutCases.id });

  if (!closeoutCase) {
    throw new Error("Unable to create the protected case fixture");
  }

  return { caseId: closeoutCase.id };
}

function protectedCaseInput(
  workOrderRef: string,
  phoneE164 = "+12025550142",
): ProtectedCloseoutCaseInput {
  return {
    workOrderRef,
    contractorDisplayName: "Example HVAC",
    siteLabel: "Synthetic protected site",
    timezone: "America/Chicago",
    contact: {
      displayName: "Authorized site role",
      role: "site_manager",
      phoneE164,
      authorizationBasis: "contractor_provided_authorized_contact" as const,
      authorizationNote:
        "The contractor confirmed this business contact and purpose.",
    },
    requestedFields: ["observed_operating_status"],
    visitContext: {
      serviceDate: "2026-07-28",
      equipmentLabel: "RTU-2",
      technicianCompletionNote: "Synthetic integration fixture.",
      allowedReferenceText: "A fictional technician visited RTU-2.",
    },
  };
}

function approvalInput(briefHash: string): LiveAttemptApprovalInput {
  return {
    expectedCaseVersion: 1,
    expectedBriefHash: briefHash,
    callingWindow: {
      timezone: "America/Chicago",
      startLocal: "2026-07-29T09:00:00",
      endLocal: "2026-07-29T17:00:00",
      evaluatedAt: "2026-07-29T14:55:00Z",
    },
    operatorAttestations: [
      "contact_authorized",
      "brief_reviewed",
      "live_call_authorized",
      "recipient_consent_confirmed",
    ],
  };
}

async function setKillSwitch(client: Sql, paused: boolean) {
  await client`
    update system_setting
    set
      boolean_value = ${paused},
      updated_at = now(),
      updated_by = 'live-workflow-integration'
    where key = 'live_calls_paused'
  `;
}
