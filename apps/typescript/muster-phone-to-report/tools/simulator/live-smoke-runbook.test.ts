import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const successorRunbook = new URL(
  "../../docs/demo/calle-twilio-greenhouse-qualification.md",
  import.meta.url,
);

describe("Phase 6 exact live-smoke handoff", () => {
  it("AC-HAPPY-3 sequences non-calling verification, replay rehearsal, a fresh authorization boundary, and immediate fallback", async () => {
    const runbook = await readFile(successorRunbook, "utf8");
    const prose = runbook.replace(/\s+/gu, " ");
    const orderedHeadings = [
      "## 1. Non-calling verification",
      "## 2. Deterministic replay rehearsal",
      "## 3. Fresh live authorization boundary",
      "## 4. One-call PASS or FAIL review",
      "## 5. Restoration, revocation, and cleanup",
      "## 6. Immediate replay fallback",
    ];
    let priorIndex = -1;
    for (const heading of orderedHeadings) {
      const currentIndex = runbook.indexOf(heading);
      expect(currentIndex, heading).toBeGreaterThan(priorIndex);
      priorIndex = currentIndex;
    }
    for (const text of [
      "Node `24.18.0`",
      "pnpm `11.20.0`",
      "corepack pnpm verify:foundation",
      "destination_routing",
      "transcription",
      "structured_output",
      "callback_lifecycle",
      "application_admission",
      "RED CONFIRMED",
      "deterministic replay is selected by default",
      "no live POST",
      "fresh explicit authorization",
      "credential access",
      "tunnel startup",
      "Twilio mutation",
      "deployment",
      "publication",
      "submission",
    ]) {
      expect(prose.toLowerCase(), text).toContain(text.toLowerCase());
    }
    expect(runbook).toMatch(/Replay evidence is not live provider evidence/iu);
  });

  it("AC-ERROR-7 defines one-call PASS or FAIL, Reject restoration, secret revocation, host-first cleanup, and privacy-safe evidence", async () => {
    const runbook = await readFile(successorRunbook, "utf8");
    const prose = runbook.replace(/\s+/gu, " ");
    for (const text of [
      "exactly one application dispatch",
      "exactly one reconciled Twilio call",
      "signed voice, canary, and status callbacks",
      "zero DTMF",
      "exactly four grounded Readings",
      "Anything less is FAIL",
      "no retry or redial",
      "hosted `<Reject/>`",
      "read-back",
      "runtime-secret capability",
      "callback grace",
      "stop the host before the owned tunnel",
      "only owned resources",
      "corepack pnpm simulator:live-smoke:cleanup",
      "interrupted guarded operator process",
      "manual_stop_required",
      "hostStopped: true",
      "tunnelStopRequired: true",
      "$ngrokProcess.Path",
      "$ngrokProcess.StartTime",
      "$ngrokProcess.HasExited",
      "Stop-Process -InputObject $ngrokProcess -ErrorAction Stop",
      "I STOPPED THE OWNED NGROK PROCESS",
      "operation ID",
      "opaque references",
    ]) {
      expect(prose.toLowerCase(), text).toContain(text.toLowerCase());
    }
    expect(runbook).not.toMatch(/AC[a-f0-9]{32}|SK[a-f0-9]{32}|\+1\d{10}/u);
    expect(runbook).not.toMatch(/one-use permit\s*[:=]\s*\S+/iu);
    expect(runbook).not.toContain("raw provider payload");
    expect(runbook).not.toContain("transcript body");
    expect(runbook).not.toContain("SIMULATOR_NGROK_PID");
    expect(runbook).not.toContain("Stop-Process -Id");
  });

  it("AC-VERIFY-4 asserts the causal cleanup barrier, successful order, and interrupted recovery boundary", async () => {
    const [rootManifest, runbook] = await Promise.all([
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
      readFile(successorRunbook, "utf8"),
    ]);
    const rootScripts = (JSON.parse(rootManifest) as { scripts: Record<string, string> }).scripts;
    expect(rootScripts["simulator:live-smoke:cleanup"]).toBe(
      "corepack pnpm --filter @muster/simulator-host live-smoke:cleanup",
    );
    const cleanupStart = runbook.indexOf("## 5. Restoration, revocation, and cleanup");
    const cleanupEnd = runbook.indexOf("## 6. Immediate replay fallback");
    expect(cleanupStart).toBeGreaterThanOrEqual(0);
    expect(cleanupEnd).toBeGreaterThan(cleanupStart);

    const cleanup = runbook.slice(cleanupStart, cleanupEnd);
    const successfulOrder = [
      "1. Keep the run gate closed.",
      "2. Commit the durable dispatch fence / causal barrier.",
      "3. If dispatch was accepted, observe the exact callback-bound inbound arrival.",
      "4. Observe a supported terminal status.",
      "5. Complete the persisted trailing grace and a final same-terminal observation.",
      "6. Claim restoration exactly once.",
      "7. Update hosted `<Reject/>` routing and verify the read-back.",
      "8. Revoke runtime secrets.",
      "9. Stop the host.",
      "10. Stop and acknowledge the exact owned tunnel.",
      "11. Mark durable cleanup complete.",
      "12. Tear down owned persistence last.",
    ];
    let priorIndex = -1;
    for (const step of successfulOrder) {
      const currentIndex = cleanup.indexOf(step);
      expect(currentIndex, step).toBeGreaterThan(priorIndex);
      priorIndex = currentIndex;
    }

    const cleanupProse = cleanup.replace(/\s+/gu, " ");
    for (const invariant of [
      "Proven zero-dispatch after the atomic fence skips inbound polling.",
      "A blocked or `manual_stop_required` result retains the reconciliation resources it names and is never successful cleanup.",
      "corepack pnpm simulator:live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped",
      "corepack pnpm --filter @muster/simulator-host live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped",
      "Use `--previous-owner-stopped` only after positive operator confirmation that the prior guarded process is stopped.",
      "`restoration_started` recovery performs read-back only and never issues a second update.",
      "No latest-row lookup, raw provider identity input, PID discovery, retry, redial, or implicit assume-no-dispatch switch is permitted.",
    ]) {
      expect(cleanupProse, invariant).toContain(invariant);
    }
  });

  it("AC-VERIFY-4 preserves the synthetic failure contract, privacy-safe claim ceiling, replay default, and fresh authorization boundary", async () => {
    const runbook = await readFile(successorRunbook, "utf8");
    const prose = runbook.replace(/\s+/gu, " ");
    for (const claim of [
      "Synthetic failure contract: `destination_routing` **FAIL**",
      "`transcription`, `structured_output`, `callback_lifecycle`, and `application_admission` **unassessed**.",
      "Deterministic replay is the provider-free default, and its evidence is not provider success.",
      "Routine artifacts are limited to allowlisted lifecycle states, aggregates, the opaque operation ID, and opaque references.",
      "Routine artifacts exclude targets, phone values, credentials, payloads, transcripts, raw provider identity, and cleanup owner digests.",
      "Any future live qualification requires fresh explicit authorization in a separate later turn.",
      "This repair authorizes no live Twilio or CALL-E action, credential resolution, tunnel, provider capability, provider mutation, deployment, requalification, or external network call.",
      "Nothing in this runbook claims live success or authorizes retry or redial.",
      "No observed provider-call records are bundled.",
      "Historical success or failure never establishes present live-recording readiness.",
      "`replayReady` reports whether current checkout-bound deterministic replay evidence passes.",
      "`ready` is an exact compatibility alias of `replayReady`.",
      '`liveReadiness: "NOT_ASSESSED"`',
    ]) {
      expect(prose, claim).toContain(claim);
    }
  });

  it("AC-HAPPY-9 documents the non-calling command, one-call sequence, replay proof, and cleanup", async () => {
    const [manifest, runbook] = await Promise.all([
      readFile(new URL("../../package.json", import.meta.url), "utf8"),
      readFile(
        new URL("../../docs/demo/hackathon-live-calle-observation.md", import.meta.url),
        "utf8",
      ),
    ]);
    const scripts = JSON.parse(manifest).scripts as Record<string, string>;
    for (const command of [
      "simulator:live-smoke:prepare",
      "simulator:live-smoke:run",
      "simulator:live-smoke:cleanup",
    ]) {
      expect(scripts[command]).toBeTypeOf("string");
    }
    for (const text of [
      "corepack pnpm simulator:live-smoke:prepare",
      "corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal",
      "corepack pnpm simulator:live-smoke:cleanup",
      "Live-smoke preflight",
      "Run gate: CLOSED",
      "Emergency stop",
      "Authorization consumed—no retry",
      "actionOnEmptyResult",
      "/twilio/voice",
      "/twilio/canary",
      "/twilio/status",
      "request capture",
      "TLS terminates at ngrok",
      "restore",
      "1 matching call",
      "three-minute demo",
      "Sensaphone audio fidelity",
    ]) {
      expect(runbook, text).toContain(text);
    }
    expect(runbook).toContain("hostStopped: true");
    expect(runbook).toContain("tunnelStopRequired: true");
    expect(runbook).toContain("at most 120 seconds");
    expect(runbook).toContain('Start-Process -FilePath "ngrok"');
    expect(runbook).toContain('"--inspect=false"');
    expect(runbook).toContain("Stop-Process -InputObject $ngrokProcess -ErrorAction Stop");
    expect(runbook).toContain("$ngrokProcess.Path");
    expect(runbook).toContain("$ngrokProcess.StartTime");
    expect(runbook).toContain("$ngrokProcess.HasExited");
    expect(runbook).toContain("manual_stop_required");
    expect(runbook).toContain("I STOPPED THE OWNED NGROK PROCESS");
    expect(runbook).toContain("Phone Numbers → Manage → Active numbers");
    expect(runbook).toContain("hosted `<Reject/>` TwiML Bin URL");
    expect(runbook).toContain("Voice request method = `POST`");
    expect(runbook).toContain("Status callback URL is empty");
    expect(runbook).toContain("restore/read-back → stop host → stop ngrok");
    expect(runbook).not.toContain("simulator:authorize --scenario");
    expect(runbook).not.toContain("SIMULATOR_NGROK_PID");
    expect(runbook).not.toContain("Stop-Process -Id");
    expect(runbook).not.toMatch(/AC[a-f0-9]{32}|SK[a-f0-9]{32}|\+1\d{10}/u);
  });
});
