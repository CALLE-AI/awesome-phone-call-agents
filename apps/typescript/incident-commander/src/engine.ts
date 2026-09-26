import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { createAwsClients, describeAlarmState, gatherAwsSnapshot } from "./aws/context.js";
import { executeDecision } from "./aws/execute.js";
import {
  buildBriefing,
  buildEscalateBriefing,
  buildResultBriefing,
  confirmationCode
} from "./calle/briefing.js";
import {
  callIdOf,
  extractEvidence,
  extractRecipientResult,
  extractTranscript,
  parseSpokenDecision,
  placeCall,
  reachedHuman,
  waitForCall,
  getCall
} from "./calle/client.js";
import { findOpenAlarmIncident, getIncident, getIncidentByCallId, listIncidents, saveIncident } from "./store.js";
import type { CreateIncidentInput, Incident } from "./types.js";
import { getScenario } from "./scenarios.js";

export type Engine = ReturnType<typeof createEngine>;

export function createEngine(config: AppConfig) {
  const aws = createAwsClients(config);
  const listeners = new Set<(incident: Incident) => void>();
  const completing = new Set<string>();

  function emit(incident: Incident) {
    for (const listener of listeners) listener(incident);
  }

  function onIncident(listener: (incident: Incident) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function patch(id: string, mutate: (incident: Incident) => void): Promise<Incident> {
    const current = await getIncident(id);
    if (!current) throw new Error(`Unknown incident ${id}`);
    mutate(current);
    const saved = await saveIncident(current);
    emit(saved);
    return saved;
  }

  function audit(incident: Incident, kind: string, detail: string, data?: unknown) {
    incident.audit.push({ at: new Date().toISOString(), kind, detail, data });
  }

  function webhookUrl(): string | undefined {
    return config.PUBLIC_BASE_URL ? `${config.PUBLIC_BASE_URL.replace(/\/$/, "")}/calle/webhook` : undefined;
  }

  async function openIncident(input: CreateIncidentInput): Promise<Incident> {
    const scenario = getScenario(input.scenarioId);
    if (input.alarmName && !scenario) {
      const existing = await findOpenAlarmIncident(input.alarmName);
      if (existing) return existing;
    }

    const incident: Incident = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 0,
      status: "gathering",
      source: input.source,
      triggerReason: scenario?.summary ?? input.triggerReason,
      alarmName: input.alarmName ?? scenario?.snapshot.alarm.name ?? config.CW_ALARM_NAME ?? null,
      confirmationCode: confirmationCode(),
      snapshot: null,
      postActionSnapshot: null,
      calleCallId: null,
      escalateCallId: null,
      resultCallId: null,
      webhookUrl: webhookUrl() ?? null,
      spoken: null,
      evidence: [],
      transcript: [],
      execution: null,
      error: null,
      scenarioId: scenario?.id ?? null,
      sayOnPhone: scenario ? scenario.sayOnPhone.replace("{code}", "the confirmation phrase") : null,
      recommended: scenario?.recommended ?? null,
      fixCommand: scenario?.fixCommand ?? null,
      audit: [],
      attempts: 0,
      timeoutAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };
    audit(incident, "opened", `${input.source}: ${incident.triggerReason}`);
    await saveIncident(incident);
    emit(incident);

    void run(incident.id).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await patch(incident.id, (item) => {
        item.status = "failed";
        item.error = message;
        audit(item, "error", message);
      });
    });

    return (await getIncident(incident.id))!;
  }

  async function run(id: string) {
    const current = (await getIncident(id))!;
    const scenario = getScenario(current.scenarioId);
    const snapshot = scenario
      ? { ...scenario.snapshot, gatheredAt: new Date().toISOString() }
      : await gatherAwsSnapshot(config, aws, current.alarmName);
    await patch(id, (item) => {
      item.snapshot = snapshot;
      item.status = "calling";
      if (scenario) {
        item.sayOnPhone = scenario.sayOnPhone.replace("{code}", item.confirmationCode);
      }
      audit(
        item,
        scenario ? "scenario.loaded" : "aws.snapshot",
        scenario ? `Failure case ${scenario.id}` : "Live AWS context gathered",
        { revision: snapshot.currentRevision, alarm: snapshot.alarm }
      );
    });

    if (!config.ONCALL_PHONE) {
      throw new Error("ONCALL_PHONE is not set");
    }

    const currentAfter = (await getIncident(id))!;
    const task = buildBriefing({
      snapshot,
      confirmationCode: currentAfter.confirmationCode,
      triggerReason: currentAfter.triggerReason,
      source: currentAfter.source,
      recommended: currentAfter.recommended,
      sayOnPhone: currentAfter.sayOnPhone,
      fixCommand: currentAfter.fixCommand
    });

    const call = await placeCall({
      config,
      to: config.ONCALL_PHONE,
      task,
      incidentId: id,
      kind: "page",
      webhookUrl: webhookUrl()
    });
    const calleCallId = callIdOf(call);
    await patch(id, (item) => {
      item.calleCallId = calleCallId;
      item.status = "in_call";
      audit(item, "calle.placed", `Outbound CALL-E page ${calleCallId}`);
    });

    void watchCall(id, calleCallId, "page");
  }

  function watchCall(id: string, calleCallId: string, kind: "page" | "escalate" | "result") {
    void waitForCall(config, calleCallId)
      .then((completed) => applyCallResult(id, completed, kind))
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        await patch(id, (item) => {
          item.error = message;
          audit(item, "calle.wait_error", message);
        });
        setTimeout(() => {
          void getIncident(id).then((incident) => {
            if (!incident || incident.execution) return;
            if (new Date() > new Date(incident.timeoutAt)) {
              void patch(id, (item) => {
                item.status = "timeout";
                item.error = "Incident timed out after 15 minutes";
                audit(item, "timeout", "Global 15-minute timeout reached");
              });
              return;
            }
            const callId =
              kind === "result"
                ? incident.resultCallId
                : kind === "escalate"
                  ? incident.escalateCallId
                  : incident.calleCallId;
            if (incident.status === "in_call" && callId) watchCall(id, callId, kind);
          });
        }, 8000);
      });
  }

  async function syncIncident(id: string) {
    const incident = await getIncident(id);
    if (!incident?.calleCallId) throw new Error("No CALL-E call id on this incident");
    const call = await getCall(config, incident.calleCallId);
    const status = String((call as { status?: string }).status ?? "");
    if (status === "completed" || status === "failed" || status === "canceled") {
      return applyCallResult(id, call, "page");
    }
    await patch(id, (item) => {
      item.error = `CALL-E still ${status || "in progress"}. Pull again in a few seconds.`;
      audit(item, "calle.sync", status || "in_progress");
    });
    return getIncident(id);
  }

  async function resumeOpenCalls() {
    for (const incident of await listIncidents()) {
      if (incident.status === "in_call" && incident.calleCallId && !incident.execution) {
        watchCall(incident.id, incident.calleCallId, "page");
      }
    }
  }

  async function applyCallResult(id: string, call: unknown, kind: "page" | "escalate" | "result") {
    const lockKey = `${id}:${kind}`;
    if (completing.has(lockKey)) return getIncident(id);
    completing.add(lockKey);
    try {
    const existing = await getIncident(id);
    if (!existing) return existing;
    if (kind !== "page") {
      await patch(id, (item) => {
        item.transcript = [...item.transcript, ...extractTranscript(call)];
        item.evidence = [...item.evidence, ...extractEvidence(call)];
        audit(item, `calle.${kind}.completed`, "Follow-up call completed");
      });
      return getIncident(id);
    }

    if (existing.execution) {
      if (existing.status === "executing" || existing.status === "in_call") {
        return patch(id, (item) => {
          item.status = existing.execution?.ok ? "resolved" : "failed";
          if (existing.execution?.ok) item.error = null;
        });
      }
      return existing;
    }

    const transcript = extractTranscript(call);
    const evidence = extractEvidence(call);
    const spoken = parseSpokenDecision(extractRecipientResult(call), existing.confirmationCode, transcript);
    const human = reachedHuman(call) || transcript.some((turn) => turn.speaker !== "bot" && turn.text.trim());
    if (human && spoken.decision !== "unknown") {
      spoken.confirmationOk = true;
      if (spoken.decision === "scale" && spoken.scaleTo === null && existing.recommended === "scale") {
        spoken.scaleTo = getScenario(existing.scenarioId)?.scaleTo ?? 4;
      }
    }

    if (!human || spoken.decision === "unknown") {
      const updated = await patch(id, (item) => {
        item.spoken = spoken;
        item.transcript = transcript;
        item.evidence = evidence;
        item.attempts = (item.attempts || 0) + 1;
        item.error = "CALL-E did not capture an authorized human decision";
        
        if (item.attempts < 2) {
          audit(item, "calle.retry", "No usable spoken decision. Retrying in 2 minutes.");
        } else {
          item.status = "no_answer";
          audit(item, "calle.no_decision", "Max retries reached. No usable spoken decision.");
        }
      });
      
      if (updated.attempts < 2) {
        setTimeout(() => {
          void placeCall({
            config,
            to: config.ONCALL_PHONE!,
            task: buildBriefing({
              snapshot: updated.snapshot!,
              confirmationCode: updated.confirmationCode,
              triggerReason: updated.triggerReason,
              source: updated.source,
              recommended: updated.recommended,
              sayOnPhone: updated.sayOnPhone,
              fixCommand: updated.fixCommand
            }),
            incidentId: id,
            kind: "page",
            webhookUrl: webhookUrl()
          }).then(async (call) => {
            const calleCallId = callIdOf(call);
            await patch(id, (item) => {
              item.calleCallId = calleCallId;
              item.status = "in_call";
              audit(item, "calle.placed", `Retry Outbound CALL-E page ${calleCallId}`);
            });
            watchCall(id, calleCallId, "page");
          });
        }, 120000); // 2 minutes
        return updated;
      } else {
        // Automatically escalate on max retries
        spoken.decision = "escalate";
        spoken.notes = "Auto-escalated due to no human response after retries.";
      }
    }

    await patch(id, (item) => {
      item.spoken = spoken;
      item.transcript = transcript;
      item.evidence = evidence;
      item.status = "executing";
      audit(item, "calle.decision", `${spoken.decision} confirmation=${spoken.confirmationOk}`, spoken);
    });

    const snapshot = (await getIncident(id))!.snapshot;
    if (!snapshot) throw new Error("Missing AWS snapshot");

    const execution = await executeDecision({
      config,
      clients: aws,
      snapshot,
      spoken,
      fixCommand:
        existing.recommended && spoken.decision === existing.recommended ? existing.fixCommand : null
    });
    await patch(id, (item) => {
      item.execution = execution;
      audit(item, "aws.execute", execution.ok ? "AWS write completed" : "AWS write blocked/failed", execution);
    });

    if (spoken.decision === "escalate") {
      if (!config.ESCALATE_PHONE) {
        return patch(id, (item) => {
          item.status = "failed";
          item.error = "ESCALATE_PHONE is not set";
        });
      }
      const escalateTask = buildEscalateBriefing({
        snapshot,
        triggerReason: existing.triggerReason,
        notes: spoken.notes
      });
      const escalateCall = await placeCall({
        config,
        to: config.ESCALATE_PHONE,
        task: escalateTask,
        incidentId: id,
        kind: "escalate",
        webhookUrl: webhookUrl()
      });
      const escalateCallId = callIdOf(escalateCall);
      await patch(id, (item) => {
        item.escalateCallId = escalateCallId;
        item.status = "escalated";
        audit(item, "calle.escalate", `Secondary page ${escalateCallId}`);
      });
      void watchCall(id, escalateCallId, "escalate");
      return getIncident(id);
    }

    let post = snapshot;
    const live = Boolean(config.ECS_CLUSTER && config.ECS_SERVICE && !existing.scenarioId);
    if (live) {
      try {
        post = await gatherAwsSnapshot(config, aws, existing.alarmName);
        await patch(id, (item) => {
          item.postActionSnapshot = post;
          audit(item, "aws.snapshot.post", "Post-action AWS snapshot", {
            revision: post.currentRevision,
            desired: post.desiredCount
          });
        });
      } catch (error) {
        await patch(id, (item) => {
          audit(item, "aws.snapshot.post_error", error instanceof Error ? error.message : String(error));
        });
      }
    } else {
      post = {
        ...snapshot,
        events: [`Runbook applied: ${execution.command}`, ...snapshot.events]
      };
      await patch(id, (item) => {
        item.postActionSnapshot = post;
        audit(item, "runbook.applied", execution.command);
      });
    }

    if (!existing.scenarioId && config.ONCALL_PHONE && execution.ok && spoken.decision !== "ack") {
      const resultTask = buildResultBriefing({
        snapshot,
        post,
        executionSummary: execution.error ?? execution.command
      });
      const resultCall = await placeCall({
        config,
        to: config.ONCALL_PHONE,
        task: resultTask,
        incidentId: `${id}-result`,
        kind: "result",
        webhookUrl: webhookUrl()
      });
      const resultCallId = callIdOf(resultCall);
      await patch(id, (item) => {
        item.resultCallId = resultCallId;
        audit(item, "calle.result", `Result call ${resultCallId}`);
      });
      void watchCall(id, resultCallId, "result");
    }

    return patch(id, (item) => {
      item.status = execution.ok ? "resolved" : "failed";
      if (execution.ok) item.error = null;
      else item.error = execution.error ?? "AWS execution failed";
    });
    } finally {
      completing.delete(lockKey);
    }
  }

  async function handleCalleCompletion(callId: string, payload: unknown) {
    const incident = await getIncidentByCallId(callId);
    if (!incident) return null;
    const kind =
      incident.resultCallId === callId ? "result" : incident.escalateCallId === callId ? "escalate" : "page";
    return applyCallResult(incident.id, payload, kind);
  }

  async function health() {
    return {
      calleConfigured: Boolean(config.CALLE_API_KEY),
      oncallConfigured: Boolean(config.ONCALL_PHONE),
      usingFailureCatalog: true,
      storage: "local",
      webhookUrl: webhookUrl() ?? null
    };
  }

  async function pollAlarms() {
    if (!config.ENABLE_ALARM_POLLER || !config.CW_ALARM_NAME) return;
    const alarm = await describeAlarmState(aws, config.CW_ALARM_NAME);
    if (alarm.state !== "ALARM") return;
    await openIncident({
      source: "cloudwatch.poller",
      triggerReason: alarm.reason ?? `Alarm ${alarm.name} is ALARM`,
      alarmName: alarm.name
    });
  }

  return { openIncident, handleCalleCompletion, health, pollAlarms, onIncident, applyCallResult, syncIncident, resumeOpenCalls };
}
