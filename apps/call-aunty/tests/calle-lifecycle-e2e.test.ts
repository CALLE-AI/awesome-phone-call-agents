/**
 * CALL-E end-to-end lifecycle + phone-API failover.
 *
 * Maps Call Aunty prepare/confirm/status/cancel onto the documented CALL-E
 * contract: plan_call → run_call → get_call_run, persist run_id, never re-dial.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { resetCallEventStore } from "../server/calle/call-events";
import { resetCorrelationStore } from "../server/calle/correlation";
import {
  PollingPhoneApiAdapter,
  ScriptedPhoneApiAdapter,
} from "../server/calle/phone-api-adapters";
import {
  createFailoverCalleAdapter,
  isFailoverEligible,
  wasCallAccepted,
} from "../server/calle/provider-failover";
import { createCalleService } from "../server/calle/service";
import type { PlaceCallCommand, ProviderCallResult } from "../server/calle/adapter";
import type { PrepareCallInput } from "../server/calle/types";

const dryRunEnv = {
  liveCallsEnabled: false,
  hasApiKey: false,
  killSwitch: false,
  apiKey: "",
};

const basePrepare = (overrides: Partial<PrepareCallInput> = {}): PrepareCallInput => ({
  womanId: "demo-woman-lifecycle",
  purpose: "follow_up_after_check_in",
  recipientE164: "+15555550123",
  recipientRegion: "US",
  callLanguage: "en",
  triageState: "contact_chw_today",
  callConsentGranted: true,
  actionToken: `action-token-${Math.random().toString(36).slice(2, 12)}`,
  forceDryRun: true,
  ...overrides,
});

function unavailable(providerId: string, command: PlaceCallCommand): ProviderCallResult {
  return {
    providerCallId: `failed_${command.workflowId}`,
    status: "failed",
    structuredResult: null,
    failureCode: "provider_unavailable",
    phoneProviderId: providerId,
  };
}

describe("CALL-E phone API failover rules", () => {
  it("treats outages as failover-eligible and accepted dials as sticky", () => {
    expect(
      isFailoverEligible({
        providerCallId: "failed_wf",
        status: "failed",
        structuredResult: null,
        failureCode: "provider_unavailable",
      }),
    ).toBe(true);
    expect(
      isFailoverEligible({
        providerCallId: "failed_wf",
        status: "failed",
        structuredResult: null,
        failureCode: "timeout",
      }),
    ).toBe(true);
    expect(
      wasCallAccepted({
        providerCallId: "backup-phone-api_run_wf",
        status: "in_progress",
        structuredResult: null,
        failureCode: null,
      }),
    ).toBe(true);
    expect(
      isFailoverEligible({
        providerCallId: "call-e_run_wf",
        status: "no_answer",
        structuredResult: null,
        failureCode: "no_answer",
      }),
    ).toBe(false);
    expect(
      isFailoverEligible({
        providerCallId: "twilio_CA123",
        status: "failed",
        structuredResult: null,
        failureCode: "call_failed",
      }),
    ).toBe(false);
  });
});

describe("CALL-E end-to-end call lifecycle", () => {
  beforeEach(() => {
    resetCallEventStore();
    resetCorrelationStore();
  });

  it("prepare does not place a call (plan_call equivalent)", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e", pollsUntilTerminal: 2 });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });

    const prepared = await service.prepare(basePrepare(), 11);
    expect(prepared.reused).toBe(false);
    expect(prepared.workflow.status).toBe("prepared");
    expect(prepared.workflow.providerCallId).toBeNull();
    expect(phone.placeCalls).toBe(0);
  });

  it("runs plan → run → poll until terminal without a second dial", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e", pollsUntilTerminal: 2 });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });

    const prepared = await service.prepare(basePrepare(), 11);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      11,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.status).toBe("in_progress");
    expect(confirmed.workflow.providerCallId).toMatch(/^call-e_run_/);
    expect(confirmed.workflow.completedAt).toBeNull();
    expect(phone.placeCalls).toBe(1);

    const mid = await service.getStatus(prepared.workflow.id, 11);
    expect(mid?.status).toBe("in_progress");
    expect(phone.placeCalls).toBe(1);

    const done = await service.getStatus(prepared.workflow.id, 11);
    expect(done?.status).toBe("dry_run_completed");
    expect(done?.structuredResult?.nextAction).toBe("call_again");
    expect(done?.completedAt).toBeTruthy();
    expect(phone.placeCalls).toBe(1);

    const resumed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      11,
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.workflow.status).toBe("dry_run_completed");
    expect(phone.placeCalls).toBe(1);
  });

  it("resumes an in-flight run_id via confirm without calling run again", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e", pollsUntilTerminal: 2 });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 4);
    const first = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      4,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.workflow.status).toBe("in_progress");

    const second = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      4,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.workflow.providerCallId).toBe(first.workflow.providerCallId);
    expect(phone.placeCalls).toBe(1);
  });

  it("cancels an in-progress run without a new place", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e", pollsUntilTerminal: 5 });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 8);
    await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      8,
    );
    const cancelled = await service.cancel(prepared.workflow.id, 8);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.workflow.status).toBe("cancelled");
    expect(phone.placeCalls).toBe(1);
    expect(phone.cancelCalls).toBe(1);
  });

  it("never reaches a phone API when consent is missing", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e" });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare({ callConsentGranted: false }), 3);
    expect(prepared.workflow.policyDecision).toBe("deny");
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      3,
    );
    expect(confirmed.ok).toBe(false);
    expect(phone.placeCalls).toBe(0);
  });

  it("redacts recipient numbers from lifecycle events", async () => {
    const phone = new PollingPhoneApiAdapter({ providerId: "call-e", pollsUntilTerminal: 1 });
    const service = createCalleService({
      env: dryRunEnv,
      adapter: phone,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 9);
    await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      9,
    );
    await service.getStatus(prepared.workflow.id, 9);
    const detail = await service.getCallDetail(prepared.workflow.id, 9);
    expect(JSON.stringify(detail?.workflow)).not.toContain("+15555550123");
    expect(JSON.stringify(detail?.events)).not.toContain("+15555550123");
    expect(detail?.workflow.recipientE164Masked).toBe("+15***23");
    expect(detail?.events.length).toBeGreaterThan(0);
  });
});

describe("CALL-E provider failover across phone APIs", () => {
  beforeEach(() => {
    resetCallEventStore();
    resetCorrelationStore();
  });

  it("fails over from CALL-E to the backup phone API on provider outage", async () => {
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: (command) => unavailable("call-e", command),
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 1,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
    });
    const service = createCalleService({
      env: dryRunEnv,
      adapter,
      store: new Map(),
      idempotency: new Map(),
    });

    const prepared = await service.prepare(basePrepare(), 21);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      21,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(primary.placeCalls).toBe(1);
    expect(backup.placeCalls).toBe(1);
    expect(confirmed.workflow.phoneProviderId).toBe("backup-phone-api");
    expect(confirmed.workflow.providerCallId).toMatch(/^backup-phone-api_run_/);

    const done = await service.getStatus(prepared.workflow.id, 21);
    expect(done?.status).toBe("dry_run_completed");
    expect(backup.placeCalls).toBe(1);

    const detail = await service.getCallDetail(prepared.workflow.id, 21);
    expect(detail?.events.some((event) => event.eventType === "provider_failover")).toBe(true);
  });

  it("fails over when the primary phone API throws", async () => {
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: () => ({ throwError: true, message: "call-e 503" }),
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 1,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
    });
    const service = createCalleService({
      env: dryRunEnv,
      adapter,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 22);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      22,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.phoneProviderId).toBe("backup-phone-api");
    expect(primary.placeCalls).toBe(1);
    expect(backup.placeCalls).toBe(1);
  });

  it("does not fail over after the primary API accepted a live run_id", async () => {
    const primary = new PollingPhoneApiAdapter({
      providerId: "call-e",
      pollsUntilTerminal: 1,
      terminalStatus: "no_answer",
      terminalFailureCode: "no_answer",
    });
    const backup = new PollingPhoneApiAdapter({ providerId: "backup-phone-api" });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
    });
    const service = createCalleService({
      env: dryRunEnv,
      adapter,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 23);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      23,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.phoneProviderId).toBe("call-e");
    expect(backup.placeCalls).toBe(0);

    const done = await service.getStatus(prepared.workflow.id, 23);
    expect(done?.status).toBe("no_answer");
    expect(backup.placeCalls).toBe(0);
    expect(primary.placeCalls).toBe(1);
  });

  it("does not place a second call when both APIs are down", async () => {
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: (command) => unavailable("call-e", command),
    });
    const backup = new ScriptedPhoneApiAdapter({
      providerId: "backup-phone-api",
      onPlace: () => ({ throwError: true }),
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
    });
    const service = createCalleService({
      env: dryRunEnv,
      adapter,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 24);
    const confirmed = await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      24,
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.workflow.status).toBe("failed");
    expect(confirmed.workflow.failureCode).toBe("provider_unavailable");
    expect(primary.placeCalls).toBe(1);
    expect(backup.placeCalls).toBe(1);

    await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      24,
    );
    expect(primary.placeCalls).toBe(1);
    expect(backup.placeCalls).toBe(1);
  });

  it("routes cancel to the phone API that accepted the call", async () => {
    const primary = new ScriptedPhoneApiAdapter({
      providerId: "call-e",
      onPlace: () => ({ throwError: true }),
    });
    const backup = new PollingPhoneApiAdapter({
      providerId: "backup-phone-api",
      pollsUntilTerminal: 4,
    });
    const adapter = createFailoverCalleAdapter({
      providers: [
        { id: "call-e", adapter: primary },
        { id: "backup-phone-api", adapter: backup },
      ],
    });
    const service = createCalleService({
      env: dryRunEnv,
      adapter,
      store: new Map(),
      idempotency: new Map(),
    });
    const prepared = await service.prepare(basePrepare(), 25);
    await service.confirm(
      { workflowId: prepared.workflow.id, prepareToken: prepared.workflow.prepareToken },
      25,
    );
    const cancelled = await service.cancel(prepared.workflow.id, 25);
    expect(cancelled.ok).toBe(true);
    expect(backup.cancelCalls).toBe(1);
    expect(primary.cancelCalls).toBe(0);
  });
});
