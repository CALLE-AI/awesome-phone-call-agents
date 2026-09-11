import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authorizeLiveCall } from "@/application/live-call-gate";
import {
  ENABLE_LIVE_CALLS_CONFIRMATION,
  PAUSE_LIVE_CALLS_CONFIRMATION,
  PROVISION_PROTECTED_WORKSPACE_CONFIRMATION,
  provisionProtectedWorkspace,
  setProtectedWorkspaceLiveCalls,
} from "@/application/protected-workspaces";
import {
  ensurePersonalDemoWorkspace,
  listUserWorkspaces,
} from "@/application/workspaces";
import { parseServerEnvironment } from "@/config/environment";
import {
  createDatabase,
  type FieldCloseDatabase,
} from "@/persistence/database";

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

describe("PostgreSQL schema", () => {
  let container: StartedPostgreSqlContainer;
  let client: Sql;
  let db: FieldCloseDatabase;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("fieldclose_test")
      .withUsername("fieldclose")
      .withPassword("fieldclose")
      .start();

    const database = createDatabase(container.getConnectionUri());
    client = database.client;
    db = database.db;

    await migrate(database.db, { migrationsFolder });
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
  });

  it("creates the durable workflow tables and a paused live-call switch", async () => {
    const tables = await client<{ table_name: string }[]>`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;
    const tableNames = tables.map((row) => row.table_name);

    expect(tableNames).toEqual(
      expect.arrayContaining([
        "audit_event",
        "account",
        "call_approval",
        "call_attempt",
        "call_result",
        "closeout_case",
        "contact",
        "follow_up_task",
        "human_disposition",
        "session",
        "system_setting",
        "user",
        "verification",
        "workspace",
        "workspace_administrative_event",
        "workspace_membership",
      ]),
    );
    expect(tableNames).not.toContain("provider_webhook_event");

    const removedWebhookTypes = await client<{ typname: string }[]>`
      select typname
      from pg_type
      where typname = 'webhook_processing_status'
    `;
    expect(removedWebhookTypes).toEqual([]);

    const userColumns = await client<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'user'
      order by ordinal_position
    `;

    expect(userColumns.map((column) => column.column_name)).toEqual(
      expect.arrayContaining(["username", "display_username"]),
    );

    const [killSwitch] = await client<
      { boolean_value: boolean; updated_by: string }[]
    >`
      select boolean_value, updated_by
      from system_setting
      where key = 'live_calls_paused'
    `;

    expect(killSwitch).toEqual({
      boolean_value: true,
      updated_by: "migration",
    });
  });

  it("backfills pre-workspace records into a locked legacy demo workspace", async () => {
    await client.unsafe("create database fieldclose_upgrade_contract");

    const upgradeUrl = new URL(container.getConnectionUri());
    upgradeUrl.pathname = "/fieldclose_upgrade_contract";
    const upgradeDatabase = createDatabase(upgradeUrl.toString());

    try {
      await applySqlMigration(
        upgradeDatabase.client,
        new URL("../../drizzle/0000_vengeful_captain_universe.sql", import.meta.url),
      );

      const [contact] = await upgradeDatabase.client<{ id: string }[]>`
        insert into contact (
          display_name,
          role,
          phone_e164_ciphertext,
          phone_encryption_iv,
          phone_encryption_tag,
          phone_key_version,
          phone_lookup_hash,
          phone_masked,
          authorization_basis,
          authorization_note
        ) values (
          'Legacy authorized role',
          'site_manager',
          'legacy-ciphertext-fixture',
          'legacy-iv-fixture',
          'legacy-tag-fixture',
          'v1',
          ${"9".repeat(64)},
          '+1 ******0142',
          'demo_fixture',
          'Pre-workspace migration fixture'
        )
        returning id
      `;

      await upgradeDatabase.client`
        insert into closeout_case (
          work_order_ref,
          contractor_display_name,
          site_label,
          timezone,
          contact_id,
          requested_fields,
          visit_context,
          created_by
        ) values (
          'WO-LEGACY-MIGRATION',
          'Example HVAC',
          'Legacy fictional site',
          'America/Chicago',
          ${contact.id},
          ${JSON.stringify(["observed_operating_status"])}::jsonb,
          ${JSON.stringify(createVisitContext())}::jsonb,
          'legacy-operator'
        )
      `;

      await applySqlMigration(
        upgradeDatabase.client,
        new URL("../../drizzle/0001_woozy_sumo.sql", import.meta.url),
      );

      const [migrated] = await upgradeDatabase.client<
        {
          contact_workspace_id: string;
          case_workspace_id: string;
          kind: string;
          provider: string;
          live_calls_allowed: boolean;
          role: string;
        }[]
      >`
        select
          contact.workspace_id as contact_workspace_id,
          closeout_case.workspace_id as case_workspace_id,
          workspace.kind,
          workspace.provider,
          workspace.live_calls_allowed,
          workspace_membership.role
        from closeout_case
        inner join contact on contact.id = closeout_case.contact_id
        inner join workspace on workspace.id = closeout_case.workspace_id
        inner join workspace_membership
          on workspace_membership.workspace_id = workspace.id
        where closeout_case.work_order_ref = 'WO-LEGACY-MIGRATION'
      `;

      expect(migrated).toEqual({
        contact_workspace_id: "00000000-0000-4000-8000-000000000001",
        case_workspace_id: "00000000-0000-4000-8000-000000000001",
        kind: "demo",
        provider: "fake",
        live_calls_allowed: false,
        role: "owner",
      });
    } finally {
      await upgradeDatabase.client.end();
    }
  });

  it("enforces concurrent attempt idempotency and one approval per attempt", async () => {
    const fixture = await createCaseFixture(client, "WO-DB-1001");
    const fingerprint = "f".repeat(64);

    const attemptWrites = await Promise.allSettled([
      client<{ id: string }[]>`
        insert into call_attempt (
          case_id,
          mode,
          idempotency_key,
          request_fingerprint,
          provider
        ) values (
          ${fixture.caseId},
          'fake',
          'case-db-1001-attempt-1',
          ${fingerprint},
          'fake'
        )
        returning id
      `,
      client<{ id: string }[]>`
        insert into call_attempt (
          case_id,
          mode,
          idempotency_key,
          request_fingerprint,
          provider
        ) values (
          ${fixture.caseId},
          'fake',
          'case-db-1001-attempt-1',
          ${fingerprint},
          'fake'
        )
        returning id
      `,
    ]);

    const successfulWrites = attemptWrites.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const rejectedReasons = attemptWrites.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );

    expect(successfulWrites).toHaveLength(1);
    expect(rejectedReasons).toHaveLength(1);
    expect(rejectedReasons[0]).toMatchObject({ code: "23505" });

    const [attempt] = successfulWrites[0] ?? [];
    expect(attempt).toBeDefined();

    if (!attempt) {
      throw new Error("Expected one attempt insert to win the idempotency race");
    }

    const approvalValues = {
      briefHash: "b".repeat(64),
      callingWindow: JSON.stringify({
        timezone: "America/Chicago",
        startLocal: "2026-07-28T09:00:00",
        endLocal: "2026-07-28T17:00:00",
        evaluatedAt: "2026-07-28T08:55:00Z",
      }),
      attestations: JSON.stringify(["contact_authorized", "brief_reviewed"]),
    };

    const [approval] = await client<{ id: string }[]>`
      insert into call_approval (
        case_id,
        case_version,
        approved_attempt_id,
        approved_by,
        brief_hash,
        live_call_approved,
        calling_window,
        operator_attestations
      ) values (
        ${fixture.caseId},
        1,
        ${attempt.id},
        'operator-db-test',
        ${approvalValues.briefHash},
        true,
        ${approvalValues.callingWindow}::jsonb,
        ${approvalValues.attestations}::jsonb
      )
      returning id
    `;

    await client`
      update call_attempt
      set mode = 'live', approval_id = ${approval.id}
      where id = ${attempt.id}
    `;

    await expect(
      client`
        insert into call_approval (
          case_id,
          case_version,
          approved_attempt_id,
          approved_by,
          brief_hash,
          live_call_approved,
          calling_window,
          operator_attestations
        ) values (
          ${fixture.caseId},
          1,
          ${attempt.id},
          'operator-db-test',
          ${approvalValues.briefHash},
          true,
          ${approvalValues.callingWindow}::jsonb,
          ${approvalValues.attestations}::jsonb
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces exact case scope for live approvals and current attempts", async () => {
    const firstFixture = await createCaseFixture(client, "WO-DB-1003");
    const secondFixture = await createCaseFixture(client, "WO-DB-1004");
    const fingerprint = "d".repeat(64);

    await expect(
      client`
        insert into call_attempt (
          case_id,
          mode,
          idempotency_key,
          request_fingerprint,
          provider
        ) values (
          ${firstFixture.caseId},
          'live',
          'case-db-1003-unapproved-live',
          ${fingerprint},
          'call_e'
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });

    const [firstAttempt] = await client<{ id: string }[]>`
      insert into call_attempt (
        case_id,
        mode,
        idempotency_key,
        request_fingerprint,
        provider
      ) values (
        ${firstFixture.caseId},
        'dry_run',
        'case-db-1003-attempt-1',
        ${fingerprint},
        'call_e'
      )
      returning id
    `;
    const [secondAttempt] = await client<{ id: string }[]>`
      insert into call_attempt (
        case_id,
        mode,
        idempotency_key,
        request_fingerprint,
        provider
      ) values (
        ${secondFixture.caseId},
        'dry_run',
        'case-db-1004-attempt-1',
        ${fingerprint},
        'call_e'
      )
      returning id
    `;

    const [approval] = await client<{ id: string }[]>`
      insert into call_approval (
        case_id,
        case_version,
        approved_attempt_id,
        approved_by,
        brief_hash,
        live_call_approved,
        calling_window,
        operator_attestations
      ) values (
        ${firstFixture.caseId},
        1,
        ${firstAttempt.id},
        'operator-db-test',
        ${"e".repeat(64)},
        true,
        ${JSON.stringify({
          timezone: "America/Chicago",
          startLocal: "2026-07-28T09:00:00",
          endLocal: "2026-07-28T17:00:00",
          evaluatedAt: "2026-07-28T08:55:00Z",
        })}::jsonb,
        ${JSON.stringify(["contact_authorized", "brief_reviewed"])}::jsonb
      )
      returning id
    `;

    await client`
      update call_attempt
      set
        mode = 'live',
        approval_id = ${approval.id},
        provider_call_id = 'provider-db-1003-call-1'
      where id = ${firstAttempt.id}
    `;

    await expect(
      client`
        update call_attempt
        set mode = 'live', approval_id = ${approval.id}
        where id = ${secondAttempt.id}
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await expect(
      client`
        update call_attempt
        set provider_call_id = 'provider-db-1003-call-1'
        where id = ${secondAttempt.id}
      `,
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      client`
        update closeout_case
        set current_attempt_id = ${secondAttempt.id}
        where id = ${firstFixture.caseId}
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await client`
      update closeout_case
      set current_attempt_id = ${firstAttempt.id}
      where id = ${firstFixture.caseId}
    `;

    await client`
      delete from closeout_case
      where id = ${firstFixture.caseId}
    `;

    const [remainingScopeRows] = await client<{ count: number }[]>`
      select count(*)::int as count
      from call_attempt
      where case_id = ${firstFixture.caseId}
    `;

    expect(remainingScopeRows?.count).toBe(0);
  });

  it("isolates workspaces and requires every live-call switch", async () => {
    const workspaceId = await createWorkspaceFixture(client);
    const liveEnvironment = parseServerEnvironment({
      FIELDCLOSE_DEMO_MODE: "false",
      FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
      CALL_E_API_KEY: "database-test-api-key",
    });

    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'database-test-outsider',
        'Database test outsider',
        'database-test-outsider@fieldclose.invalid',
        true,
        now()
      )
      on conflict (id) do nothing
    `;

    await expect(
      authorizeLiveCall(
        db,
        liveEnvironment,
        "database-test-outsider",
        workspaceId,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "workspace_access_denied",
    });

    await expect(
      authorizeLiveCall(
        db,
        liveEnvironment,
        "database-test-owner",
        workspaceId,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "workspace_not_protected",
    });

    await client`
      update workspace
      set
        kind = 'protected',
        provider = 'call_e',
        live_calls_allowed = true
      where id = ${workspaceId}
    `;

    await expect(
      authorizeLiveCall(
        db,
        liveEnvironment,
        "database-test-owner",
        workspaceId,
      ),
    ).resolves.toEqual({
      allowed: false,
      reason: "global_kill_switch_paused",
    });

    await client`
      update system_setting
      set boolean_value = false, updated_by = 'database-test-owner'
      where key = 'live_calls_paused'
    `;

    await expect(
      authorizeLiveCall(
        db,
        liveEnvironment,
        "database-test-owner",
        workspaceId,
      ),
    ).resolves.toEqual({ allowed: true });

    await client`
      update system_setting
      set boolean_value = true, updated_by = 'database-test-cleanup'
      where key = 'live_calls_paused'
    `;
    await client`
      update workspace
      set kind = 'demo', provider = 'fake', live_calls_allowed = false
      where id = ${workspaceId}
    `;
  });

  it("creates one fake-only demo workspace per authenticated user", async () => {
    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'database-demo-user',
        'Demo operator',
        'database-demo-user@fieldclose.invalid',
        true,
        now()
      )
    `;

    const firstWorkspace = await ensurePersonalDemoWorkspace(db, {
      id: "database-demo-user",
      name: "Demo operator",
    });
    const repeatedWorkspace = await ensurePersonalDemoWorkspace(db, {
      id: "database-demo-user",
      name: "Demo operator",
    });

    expect(repeatedWorkspace.id).toBe(firstWorkspace.id);
    expect(firstWorkspace).toMatchObject({
      kind: "demo",
      provider: "fake",
      liveCallsAllowed: false,
      ownerUserId: "database-demo-user",
    });
    await expect(listUserWorkspaces(db, "database-demo-user")).resolves.toEqual([
      expect.objectContaining({
        id: firstWorkspace.id,
        role: "owner",
      }),
    ]);
    await expect(
      listUserWorkspaces(db, "database-test-outsider"),
    ).resolves.not.toContainEqual(
      expect.objectContaining({ id: firstWorkspace.id }),
    );

    await expect(
      client`
        update workspace
        set provider = 'call_e'
        where id = ${firstWorkspace.id}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("provisions and toggles one protected workspace with append-only administration evidence", async () => {
    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'protected-admin-owner',
        'Protected admin owner',
        'protected-admin@fieldclose.invalid',
        true,
        now()
      )
    `;

    const actor = {
      userId: "protected-admin-owner",
      name: "Protected admin owner",
      email: "protected-admin@fieldclose.invalid",
    };
    const environment = parseServerEnvironment({
      FIELDCLOSE_DEMO_MODE: "false",
      FIELDCLOSE_LIVE_CALLS_ENABLED: "true",
      FIELDCLOSE_PROTECTED_OPERATOR_EMAILS:
        "protected-admin@fieldclose.invalid",
      CALL_E_API_KEY: "protected-admin-test-api-key",
    });
    const input = {
      slug: "protected-admin-workspace",
      displayName: "Protected administration workspace",
      confirmation: PROVISION_PROTECTED_WORKSPACE_CONFIRMATION,
    } as const;

    const provisioned = await provisionProtectedWorkspace(
      db,
      environment,
      actor,
      input,
    );
    const repeated = await provisionProtectedWorkspace(
      db,
      environment,
      actor,
      input,
    );

    expect(provisioned).toMatchObject({
      created: true,
      "workspace": {
        kind: "protected",
        provider: "call_e",
        liveCallsAllowed: false,
      },
    });
    expect(repeated).toEqual({
      ...provisioned,
      created: false,
    });

    await expect(
      setProtectedWorkspaceLiveCalls(
        db,
        environment,
        actor,
        provisioned.workspace.id,
        {
          enabled: true,
          confirmation: PAUSE_LIVE_CALLS_CONFIRMATION,
        },
      ),
    ).rejects.toMatchObject({
      code: "live_setting_confirmation_required",
    });

    const enabled = await setProtectedWorkspaceLiveCalls(
      db,
      environment,
      actor,
      provisioned.workspace.id,
      {
        enabled: true,
        confirmation: ENABLE_LIVE_CALLS_CONFIRMATION,
      },
    );
    const repeatedEnable = await setProtectedWorkspaceLiveCalls(
      db,
      environment,
      actor,
      provisioned.workspace.id,
      {
        enabled: true,
        confirmation: ENABLE_LIVE_CALLS_CONFIRMATION,
      },
    );
    const paused = await setProtectedWorkspaceLiveCalls(
      db,
      environment,
      actor,
      provisioned.workspace.id,
      {
        enabled: false,
        confirmation: PAUSE_LIVE_CALLS_CONFIRMATION,
      },
    );

    expect(enabled).toMatchObject({
      changed: true,
      "workspace": { liveCallsAllowed: true },
    });
    expect(repeatedEnable).toMatchObject({
      changed: false,
      "workspace": { liveCallsAllowed: true },
    });
    expect(paused).toMatchObject({
      changed: true,
      "workspace": { liveCallsAllowed: false },
    });

    const events = await client<
      { id: string; event_type: string; metadata: unknown }[]
    >`
      select id, event_type, metadata
      from workspace_administrative_event
      where workspace_id = ${provisioned.workspace.id}
      order by occurred_at, id
    `;

    expect(events.map((event) => event.event_type)).toEqual([
      "protected_workspace.provisioned",
      "protected_workspace.live_calls_enabled",
      "protected_workspace.live_calls_paused",
    ]);
    expect(JSON.stringify(events)).not.toContain(
      "protected-admin@fieldclose.invalid",
    );

    await expect(
      client`
        update workspace_administrative_event
        set event_type = 'tampered'
        where id = ${events[0]?.id}
      `,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects direct audit mutation", async () => {
    const fixture = await createCaseFixture(client, "WO-DB-1002");

    const [auditEvent] = await client<{ id: string }[]>`
      insert into audit_event (
        case_id,
        actor_type,
        actor_id,
        event_type,
        metadata
      ) values (
        ${fixture.caseId},
        'operator',
        'operator-db-test',
        'case.created',
        ${JSON.stringify({ source: "database_contract_test" })}::jsonb
      )
      returning id
    `;

    await expect(
      client`
        update audit_event
        set event_type = 'case.updated'
        where id = ${auditEvent.id}
      `,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects a case that references another workspace's contact", async () => {
    const fixture = await createCaseFixture(client, "WO-DB-WORKSPACE-SCOPE");

    await client`
      insert into "user" (
        id,
        name,
        email,
        email_verified,
        updated_at
      ) values (
        'database-cross-workspace-user',
        'Cross workspace operator',
        'database-cross-workspace-user@fieldclose.invalid',
        true,
        now()
      )
    `;
    const otherWorkspace = await ensurePersonalDemoWorkspace(db, {
      id: "database-cross-workspace-user",
      name: "Cross workspace operator",
    });

    await expect(
      client`
        insert into closeout_case (
          workspace_id,
          work_order_ref,
          contractor_display_name,
          site_label,
          timezone,
          contact_id,
          requested_fields,
          visit_context,
          created_by
        ) values (
          ${otherWorkspace.id},
          'WO-DB-WORKSPACE-MISMATCH',
          'Example HVAC',
          'Fictional cross-workspace site',
          'America/Chicago',
          ${fixture.contactId},
          ${JSON.stringify(["observed_operating_status"])}::jsonb,
          ${JSON.stringify(createVisitContext())}::jsonb,
          'database-cross-workspace-user'
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects invalid case versions and empty requested fields", async () => {
    const workspaceId = await createWorkspaceFixture(client);
    const [contact] = await client<{ id: string }[]>`
      insert into contact (
        workspace_id,
        display_name,
        role,
        phone_e164_ciphertext,
        phone_encryption_iv,
        phone_encryption_tag,
        phone_key_version,
        phone_lookup_hash,
        phone_masked,
        authorization_basis,
        authorization_note
      ) values (
        ${workspaceId},
        'Authorized site role',
        'site_manager',
        'ciphertext-fixture',
        'iv-fixture',
        'tag-fixture',
        'v1',
        ${"c".repeat(64)},
        '+1 ******0142',
        'demo_fixture',
        'Fictional database contract fixture'
      )
      returning id
    `;

    await expect(
      client`
        insert into closeout_case (
          workspace_id,
          version,
          work_order_ref,
          contractor_display_name,
          site_label,
          timezone,
          contact_id,
          requested_fields,
          visit_context,
          created_by
        ) values (
          ${workspaceId},
          0,
          'WO-DB-INVALID',
          'Example HVAC',
          'Fictional North Store',
          'America/Chicago',
          ${contact.id},
          ${JSON.stringify([])}::jsonb,
          ${JSON.stringify(createVisitContext())}::jsonb,
          'operator-db-test'
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });
});

async function createCaseFixture(client: Sql, workOrderRef: string) {
  const workspaceId = await createWorkspaceFixture(client);
  const [contact] = await client<{ id: string }[]>`
    insert into contact (
      workspace_id,
      display_name,
      role,
      phone_e164_ciphertext,
      phone_encryption_iv,
      phone_encryption_tag,
      phone_key_version,
      phone_lookup_hash,
      phone_masked,
      authorization_basis,
      authorization_note
    ) values (
      ${workspaceId},
      'Authorized site role',
      'site_manager',
      'ciphertext-fixture',
      'iv-fixture',
      'tag-fixture',
      'v1',
      ${workOrderRef.padEnd(64, "0").slice(0, 64)},
      '+1 ******0142',
      'demo_fixture',
      'Fictional database contract fixture'
    )
    returning id
  `;

  const [closeoutCase] = await client<{ id: string }[]>`
    insert into closeout_case (
      workspace_id,
      work_order_ref,
      contractor_display_name,
      site_label,
      timezone,
      contact_id,
      requested_fields,
      visit_context,
      created_by
    ) values (
      ${workspaceId},
      ${workOrderRef},
      'Example HVAC',
      'Fictional North Store',
      'America/Chicago',
      ${contact.id},
      ${JSON.stringify([
        "observed_operating_status",
        "unresolved_issue",
        "return_visit_request",
      ])}::jsonb,
      ${JSON.stringify(createVisitContext())}::jsonb,
      'operator-db-test'
    )
    returning id
  `;

  return {
    caseId: closeoutCase.id,
    contactId: contact.id,
    workspaceId,
  };
}

const databaseTestWorkspaceId = "10000000-0000-4000-8000-000000000001";

async function createWorkspaceFixture(client: Sql) {
  await client`
    insert into "user" (
      id,
      name,
      email,
      email_verified,
      updated_at
    ) values (
      'database-test-owner',
      'Database test owner',
      'database-test-owner@fieldclose.invalid',
      true,
      now()
    )
    on conflict (id) do nothing
  `;

  await client`
    insert into workspace (
      id,
      slug,
      display_name,
      kind,
      provider,
      live_calls_allowed,
      owner_user_id
    ) values (
      ${databaseTestWorkspaceId},
      'database-test-workspace',
      'Database test workspace',
      'demo',
      'fake',
      false,
      'database-test-owner'
    )
    on conflict (id) do nothing
  `;

  await client`
    insert into workspace_membership (
      workspace_id,
      user_id,
      role
    ) values (
      ${databaseTestWorkspaceId},
      'database-test-owner',
      'owner'
    )
    on conflict (workspace_id, user_id) do nothing
  `;

  return databaseTestWorkspaceId;
}

function createVisitContext() {
  return {
    serviceDate: "2026-07-27",
    equipmentLabel: "Rooftop unit RTU-2",
    technicianCompletionNote: "Filter replaced and unit restarted",
    allowedReferenceText: "A technician visited to service RTU-2.",
  };
}

async function applySqlMigration(client: Sql, migrationUrl: URL) {
  const migration = await readFile(migrationUrl, "utf8");
  const statements = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.unsafe(statement);
  }
}
