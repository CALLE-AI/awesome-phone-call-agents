import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BookingDraft } from "../src/domain/booking-contract.js";
import { createDineLineServer } from "../src/server.js";

const temporaryDirectories: string[] = [];
const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("DineLine CALL-E interface server", () => {
  it("reports fixture mode and the active safeguards", async () => {
    const baseUrl = await startServer();
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await jsonBody(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      mode: "fixture",
      realCallReady: false,
      bookingCallReady: false,
      intakeCallReady: false,
      agents: {
        preferenceAgent: "DineLine Concierge",
        bookingAgent: "Agent Jake",
      },
      safeguards: {
        explicitApprovalRequired: true,
        duplicateProtection: true,
        automaticRetry: false,
        evidenceVerification: true,
        destinationAllowlistRequired: true,
      },
    });
  });

  it("serves the visible interface with security headers", async () => {
    const baseUrl = await startServer();
    const response = await fetch(baseUrl);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(html).toContain("Pick the restaurant");
    expect(html).toContain("Have the DineLine Concierge call you");
    expect(html).toContain("Run Agent Jake demo call");
    expect(html).toContain('id="demo-mode-title"');
    expect(html).toContain('id="execute-button-label"');
    expect(html).toContain('id="controlled-destination-field" hidden');
    expect(html).toContain("The server allowlist still has final say.");
  });

  it("keeps real-call readiness false when a gate has no valid destination allowlist", async () => {
    const baseUrl = await startServer({
      DINELINE_CALL_MODE: "real",
      CALLE_API_KEY: "test-key",
      DINELINE_ALLOW_REAL_CALLS: "true",
      DINELINE_ALLOW_REAL_INTAKE_CALLS: "true",
    });
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await jsonBody(response);

    expect(body).toMatchObject({
      mode: "real",
      bookingCallReady: false,
      intakeCallReady: false,
    });
  });

  it("reports each real-call role ready only with its own valid allowlist", async () => {
    const baseUrl = await startServer({
      DINELINE_CALL_MODE: "real",
      CALLE_API_KEY: "test-key",
      DINELINE_ALLOW_REAL_CALLS: "true",
      DINELINE_ALLOWED_BOOKING_PHONES: "+12025550143",
      DINELINE_ALLOW_REAL_INTAKE_CALLS: "true",
      DINELINE_ALLOWED_INTAKE_PHONES: "+12025550109",
    });
    const response = await fetch(`${baseUrl}/api/config`);
    const body = await jsonBody(response);

    expect(body).toMatchObject({
      mode: "real",
      realCallReady: true,
      bookingCallReady: true,
      intakeCallReady: true,
    });
  });

  it("previews a stable preference request and masks the diner phone", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest();
    const first = await postJson(`${baseUrl}/api/intake/preview`, request);
    const second = await postJson(`${baseUrl}/api/intake/preview`, request);

    expect(first.response.status).toBe(200);
    expect(first.body.preview.phone).toBe("+1******0109");
    expect(first.body.preview.requestId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.body.preview.correlationId).toMatch(/^dli_[a-f0-9]{24}$/);
    expect(second.body.preview.requestId).toBe(first.body.preview.requestId);
  });

  it("runs Agent 1 in fixture mode and returns search-ready preferences", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest();
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const result = await postJson(`${baseUrl}/api/intake/execute`, {
      request,
      approvedRequestId: preview.body.preview.requestId,
      scenario: "complete",
    });

    expect(result.response.status).toBe(200);
    expect(result.body.provider).toBe("fixture-intake");
    expect(result.body.execution.kind).toBe("completed");
    expect(result.body.execution.outcome).toMatchObject({
      usableForSearch: true,
      needsUserInput: false,
      preferences: {
        location: "Manhattan, New York",
        cuisine: "Italian",
        partySize: 2,
      },
    });
  });

  it("returns missing Agent 1 fields to the UI instead of inventing them", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest("session-intake-missing");
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const result = await postJson(`${baseUrl}/api/intake/execute`, {
      request,
      approvedRequestId: preview.body.preview.requestId,
      scenario: "missing",
    });

    expect(result.body.execution.outcome).toMatchObject({
      usableForSearch: false,
      needsUserInput: true,
      missingFields: ["location"],
    });
  });

  it("requires explicit consent before a preference call can be previewed", async () => {
    const baseUrl = await startServer();
    const result = await postJson(`${baseUrl}/api/intake/preview`, {
      phone: "+12025550109",
      sessionId: "session-no-consent",
    });

    expect(result.response.status).toBe(400);
    expect(result.body.error).toContain("DineLine contract");
  });

  it("rejects Agent 1 execution when the diner number changes after preview", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest("session-intake-change");
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const changed = { ...request, phone: "+12025550110" };
    const result = await postJson(`${baseUrl}/api/intake/execute`, {
      request: changed,
      approvedRequestId: preview.body.preview.requestId,
      scenario: "complete",
    });

    expect(result.response.status).toBe(409);
    expect(result.body.error).toContain("changed after");
  });

  it("blocks a duplicate Agent 1 dispatch in the same session", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest("session-intake-duplicate");
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const payload = {
      request,
      approvedRequestId: preview.body.preview.requestId,
      scenario: "complete",
    };

    const first = await postJson(`${baseUrl}/api/intake/execute`, payload);
    const second = await postJson(`${baseUrl}/api/intake/execute`, payload);

    expect(first.body.execution.kind).toBe("completed");
    expect(second.body.execution.kind).toBe("duplicate_blocked");
  });

  it("executes the Agent 1 n8n handoff with one intake correlation ID", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest("session-n8n-intake");
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const result = await postJson(
      `${baseUrl}/api/n8n/intake/dispatch`,
      makeN8nIntakeDispatch(request, preview.body.preview),
    );

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("x-dineline-intake-correlation-id")).toBe(
      preview.body.preview.correlationId,
    );
    expect(result.body).toMatchObject({
      requestId: preview.body.preview.requestId,
      correlationId: preview.body.preview.correlationId,
      state: "completed",
      retryPolicy: { automaticRetryAllowed: false },
      planningResult: {
        status: "preferences_ready",
        usableForSearch: true,
      },
    });
  });

  it("returns non-retryable dispatch_unknown for Agent 1", async () => {
    const baseUrl = await startServer();
    const request = makeIntakeRequest("session-n8n-timeout");
    const preview = await postJson(`${baseUrl}/api/intake/preview`, request);
    const payload = makeN8nIntakeDispatch(
      request,
      preview.body.preview,
      "timeout",
    );

    const first = await postJson(`${baseUrl}/api/n8n/intake/dispatch`, payload);
    const second = await postJson(`${baseUrl}/api/n8n/intake/dispatch`, payload);

    expect(first.body).toMatchObject({
      state: "dispatch_unknown",
      retryPolicy: { automaticRetryAllowed: false },
      planningResult: {
        status: "dispatch_unknown",
        needsUserInput: true,
      },
    });
    expect(second.body).toMatchObject({
      state: "dispatch_unknown",
      planningResult: { status: "duplicate_blocked" },
    });
  });

  it("builds a stable preview and masks the phone number", async () => {
    const baseUrl = await startServer();
    const first = await postJson(`${baseUrl}/api/preview`, makeDraft());
    const second = await postJson(`${baseUrl}/api/preview`, makeDraft());

    expect(first.response.status).toBe(200);
    expect(first.body.preview.restaurant.phone).toBe("+1******0143");
    expect(first.body.preview.contractId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.body.preview.correlationId).toMatch(/^dle_[a-f0-9]{24}$/);
    expect(second.body.preview.contractId).toBe(first.body.preview.contractId);
    expect(second.body.preview.correlationId).toBe(first.body.preview.correlationId);
  });

  it("executes an explicitly approved fixture and returns verified evidence", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const result = await postJson(`${baseUrl}/api/execute`, {
      draft,
      approvedContractId: preview.body.preview.contractId,
      explicitApproval: true,
      scenario: "confirmed",
      sessionId: "session-confirmed-test",
    });

    expect(result.response.status).toBe(200);
    expect(result.body.execution.kind).toBe("completed");
    expect(result.body.execution.outcome).toMatchObject({
      outcome: "confirmed",
      confirmationCode: "FIXTURE-42",
      needsHumanReview: false,
    });
    expect(result.body.execution.outcome.evidence).toHaveLength(1);
  });

  it("rejects execution when details changed after approval", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const changedDraft = makeDraft();
    changedDraft.reservation.guestName = "Different Guest";
    const result = await postJson(`${baseUrl}/api/execute`, {
      draft: changedDraft,
      approvedContractId: preview.body.preview.contractId,
      explicitApproval: true,
      scenario: "confirmed",
      sessionId: "session-changed-test",
    });

    expect(result.response.status).toBe(409);
    expect(result.body.error).toContain("changed after approval");
  });

  it("requires the explicit approval literal", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const result = await postJson(`${baseUrl}/api/execute`, {
      draft,
      approvedContractId: preview.body.preview.contractId,
      scenario: "confirmed",
      sessionId: "session-no-approval",
    });

    expect(result.response.status).toBe(400);
    expect(result.body.error).toContain("DineLine contract");
  });

  it("blocks a second execution of the same contract in one session", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const payload = {
      draft,
      approvedContractId: preview.body.preview.contractId,
      explicitApproval: true,
      scenario: "confirmed",
      sessionId: "session-duplicate-test",
    };

    const first = await postJson(`${baseUrl}/api/execute`, payload);
    const second = await postJson(`${baseUrl}/api/execute`, payload);

    expect(first.body.execution.kind).toBe("completed");
    expect(second.body.execution.kind).toBe("duplicate_blocked");
  });

  it("keeps fixture retries session-safe while allowing a fresh demo session", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const approved = {
      draft,
      approvedContractId: preview.body.preview.contractId,
      explicitApproval: true,
      scenario: "confirmed",
    };

    const firstPayload = {
      ...approved,
      sessionId: "session-one-booking",
    };
    const first = await postJson(`${baseUrl}/api/execute`, firstPayload);
    const exactRetry = await postJson(`${baseUrl}/api/execute`, firstPayload);
    const freshSession = await postJson(`${baseUrl}/api/execute`, {
      ...approved,
      sessionId: "session-two-booking",
    });

    expect(first.body.execution.kind).toBe("completed");
    expect(exactRetry.body.execution.kind).toBe("duplicate_blocked");
    expect(freshSession.body.execution.kind).toBe("completed");
  });

  it("rejects impossible dates and unknown time zones before preview", async () => {
    const baseUrl = await startServer();
    const impossibleDate = makeDraft();
    impossibleDate.reservation.date = "2026-02-30";
    const badDate = await postJson(`${baseUrl}/api/preview`, impossibleDate);

    const unknownZone = makeDraft();
    unknownZone.reservation.timeZone = "Mars/Olympus_Mons";
    const badZone = await postJson(`${baseUrl}/api/preview`, unknownZone);

    expect(badDate.response.status).toBe(400);
    expect(badDate.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "reservation.date" }),
      ]),
    );
    expect(badZone.response.status).toBe(400);
    expect(badZone.body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "reservation.timeZone" }),
      ]),
    );
  });

  it("fails closed when returned evidence contradicts confirmation", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const result = await postJson(`${baseUrl}/api/execute`, {
      draft,
      approvedContractId: preview.body.preview.contractId,
      explicitApproval: true,
      scenario: "contradiction",
      sessionId: "session-contradiction-test",
    });

    expect(result.body.execution.outcome).toMatchObject({
      outcome: "uncertain",
      needsHumanReview: true,
    });
    expect(result.body.execution.outcome.summary).toContain("did not pass");
  });

  it("executes a strict n8n fixture handoff with one correlation ID", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const result = await postJson(
      `${baseUrl}/api/n8n/dispatch`,
      makeN8nDispatch(draft, preview.body.preview),
    );

    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("x-dineline-correlation-id")).toBe(
      preview.body.preview.correlationId,
    );
    expect(result.body).toMatchObject({
      adapterVersion: "1.0",
      correlationId: preview.body.preview.correlationId,
      contractId: preview.body.preview.contractId,
      state: "completed",
      source: {
        n8nExecutionId: "fixture-run-101",
        sourceCallId: "calle-intake-fixture-101",
        toolCallId: "tool-call-fixture-101",
      },
      retryPolicy: {
        automaticRetryAllowed: false,
      },
      bookingResult: {
        status: "booked",
        needsHumanReview: false,
      },
    });
  });

  it("rejects an n8n handoff when its correlation ID changed in transit", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const payload = makeN8nDispatch(draft, preview.body.preview);
    payload.correlationId = "dle_000000000000000000000000";
    const result = await postJson(`${baseUrl}/api/n8n/dispatch`, payload);

    expect(result.response.status).toBe(409);
    expect(result.body.error).toContain("correlation ID");
  });

  it("returns a non-retryable dispatch_unknown result to n8n", async () => {
    const baseUrl = await startServer();
    const draft = makeDraft();
    const preview = await postJson(`${baseUrl}/api/preview`, draft);
    const payload = makeN8nDispatch(draft, preview.body.preview, "timeout");

    const first = await postJson(`${baseUrl}/api/n8n/dispatch`, payload);
    const second = await postJson(`${baseUrl}/api/n8n/dispatch`, payload);

    expect(first.body).toMatchObject({
      state: "dispatch_unknown",
      retryPolicy: { automaticRetryAllowed: false },
      bookingResult: {
        status: "dispatch_unknown",
        needsHumanReview: true,
      },
    });
    expect(first.body.bookingResult.messageToCaller).toContain("not confirmed");
    expect(second.body).toMatchObject({
      state: "dispatch_unknown",
      bookingResult: {
        status: "duplicate_blocked",
        needsHumanReview: true,
      },
    });
  });
});

async function startServer(
  environment: NodeJS.ProcessEnv = { DINELINE_CALL_MODE: "fixture" },
): Promise<string> {
  const journalRoot = await mkdtemp(path.join(tmpdir(), "dineline-ui-"));
  temporaryDirectories.push(journalRoot);
  const server = createDineLineServer({
    journalRoot,
    environment,
    now: () => new Date("2026-09-10T09:00:00.000Z"),
  });
  openServers.push(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(url: string, value: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  return { response, body: await jsonBody(response) };
}

async function jsonBody(response: Response): Promise<any> {
  return response.json();
}

function makeDraft(): BookingDraft {
  return {
    restaurant: {
      name: "Santoro House",
      address: "28 Bedford Street, New York, NY",
      phone: "+12025550143",
    },
    reservation: {
      date: "2026-09-18",
      time: "19:30",
      timeZone: "America/New_York",
      partySize: 2,
      guestName: "Demo Guest",
      specialRequests: "",
    },
    policy: {
      acceptAlternativeTime: false,
      leaveVoicemail: false,
      discloseAiCaller: true,
    },
  };
}

function makeIntakeRequest(sessionId = "session-intake-test") {
  return {
    phone: "+12025550109",
    sessionId,
    explicitConsent: true,
  };
}

function makeN8nIntakeDispatch(
  request: ReturnType<typeof makeIntakeRequest>,
  preview: { requestId: string; correlationId: string },
  scenario = "complete",
) {
  return {
    request,
    approvedRequestId: preview.requestId,
    correlationId: preview.correlationId,
    source: {
      n8nExecutionId: "fixture-intake-101",
      sourceCallId: "planning:fixture-intake-101",
      toolCallId: null,
    },
    scenario,
  };
}

function makeN8nDispatch(
  draft: BookingDraft,
  preview: { contractId: string; correlationId: string },
  scenario = "confirmed",
) {
  return {
    draft,
    approvedContractId: preview.contractId,
    correlationId: preview.correlationId,
    explicitApproval: true,
    source: {
      n8nExecutionId: "fixture-run-101",
      sourceCallId: "calle-intake-fixture-101",
      toolCallId: "tool-call-fixture-101",
    },
    scenario,
  };
}
