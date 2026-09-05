// The event loop of a roll call: plan waves, place one CALL-E call task per wave, wait for
// the terminal result (webhook first, polling always), classify every person with the
// fail-closed rules, then run the cascade: redial, phone the contact, or put a human on
// the door-knock list. Every step is appended to the ledger before the next one starts.

import type { Call, CalleClient } from "@call-e/calle";
import { CalleAPIError, CalleTimeoutError } from "@call-e/calle";
import { createEscalationCall, createWaveCall } from "./calle.js";
import { DEFAULT_POLICY, escalationDisposition, nextAction, type CascadePolicy } from "./cascade.js";
import { classify } from "./classify.js";
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { maskPhone, maskPhonesInText } from "./mask.js";
import type { Playbook } from "./playbooks.js";
import type { RegistryLoadReport } from "./registry.js";
import { planWaves, scorePerson } from "./risk.js";
import type { CallRecord, DispatchTicket, EscalationResult, HazardEvent, Outcome, Person, Wave } from "./types.js";
import { randomBytes } from "node:crypto";

/** Resolves waits on a call id from either a webhook delivery or a poll. */
export class CallInbox {
  private readonly waiters = new Map<string, Set<() => void>>();
  private readonly delivered = new Set<string>();

  /** Called by the webhook receiver. The payload is not trusted; the waiter re-fetches the call. */
  deliver(callId: string): void {
    this.delivered.add(callId);
    for (const wake of this.waiters.get(callId) ?? []) {
      wake();
    }
  }

  wasDelivered(callId: string): boolean {
    return this.delivered.has(callId);
  }

  onDelivery(callId: string, wake: () => void): () => void {
    const set = this.waiters.get(callId) ?? new Set<() => void>();
    set.add(wake);
    this.waiters.set(callId, set);
    return () => set.delete(wake);
  }
}

export interface RunOptions {
  config: Config;
  client: CalleClient;
  ledger: Ledger;
  inbox: CallInbox;
  event: HazardEvent;
  playbook: Playbook;
  people: Person[];
  registryReport: RegistryLoadReport;
  webhookUrl: string | null;
  waveSize: number;
  parallelWaves: number;
  policy?: CascadePolicy;
  pollIntervalMs?: number;
  callTimeoutMs?: number;
  /** Delay before the second attempt. Collapsed to zero in drills. */
  retryDelayMs?: number;
  log?: (line: string) => void;
}

export interface RunSummary {
  eventId: string;
  outcomes: Record<Outcome | "pending", number>;
  callsPlaced: number;
  escalationCalls: number;
  dispatches: number;
}

function isTerminal(call: Call): boolean {
  return call.status === "completed" || call.status === "failed" || call.status === "canceled";
}

function toRecord(call: Call, kind: CallRecord["kind"], wave: number | null, attempt: number, personByPhone: Map<string, Person>, idempotencyKey: string): CallRecord {
  return {
    callId: call.id,
    kind,
    wave,
    attempt,
    personIds: call.recipients.map((r) => personByPhone.get(r.phones[0] ?? "")?.id ?? "").filter((id) => id.length > 0),
    idempotencyKey,
    createdAt: call.createdAt,
    completedAt: call.completedAt,
    status: call.status,
    taskCompleted: call.taskCompleted,
    confidenceLabel: call.completionConfidence?.label ?? null,
    confidenceScore: call.completionConfidence?.score ?? null,
    failureCode: call.failureCode,
    recipients: call.recipients.map((r) => ({
      maskedPhone: maskPhone(r.phones[0] ?? ""),
      personId: personByPhone.get(r.phones[0] ?? "")?.id ?? null,
      status: r.status,
      attemptCount: r.attempts.length,
    })),
    firstBotTurnOffsets: call.recipients.map((r) => r.attempts[0]?.transcriptTurns.find((t) => t.speaker === "bot")?.offset_seconds ?? null),
  };
}

function userEvidence(call: Call, phone: string): string[] {
  const recipient = call.recipients.find((r) => r.phones[0] === phone);
  if (!recipient) {
    return [];
  }
  return recipient.attempts
    .flatMap((a) => a.transcriptTurns)
    .filter((t) => t.speaker === "user")
    .slice(0, 3)
    .map((t) => maskPhonesInText(t.text));
}

function isEscalationResult(value: unknown): value is EscalationResult {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return typeof v["reached"] === "string" && typeof v["will_check"] === "string" && typeof v["eta_minutes"] === "number";
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class Orchestrator {
  private readonly o: Required<Pick<RunOptions, "policy" | "pollIntervalMs" | "callTimeoutMs" | "retryDelayMs" | "log">> & RunOptions;
  private readonly personByPhone = new Map<string, Person>();
  private readonly personById = new Map<string, Person>();
  private readonly seenEventIds = new Set<string>();

  constructor(options: RunOptions) {
    this.o = {
      policy: DEFAULT_POLICY,
      pollIntervalMs: 3000,
      callTimeoutMs: 15 * 60 * 1000,
      retryDelayMs: 0,
      log: () => undefined,
      ...options,
    };
    for (const person of options.people) {
      this.personByPhone.set(person.phone, person);
      this.personById.set(person.id, person);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  async run(): Promise<RunSummary> {
    const { ledger, event, people, registryReport, config, playbook } = this.o;
    ledger.append({ type: "event.declared", at: this.now(), event, mode: config.mode });
    ledger.append({
      type: "registry.loaded",
      at: this.now(),
      count: people.length,
      skipped: registryReport.skippedNoConsent + registryReport.skippedInvalidPhone + registryReport.skippedDuplicatePhone + registryReport.skippedMissingFields,
      warnings: registryReport.warnings,
    });
    for (const person of people) {
      const risk = scorePerson(person, event.hazard);
      ledger.append({ type: "person.registered", at: this.now(), person, riskScore: risk.score, priority: risk.priority, factors: risk.factors });
    }
    this.o.log(`Event ${event.id}: ${event.headline} (${event.area}). ${people.length} people, ${config.mode} mode.`);

    const firstPass = planWaves(people, event.hazard, this.o.waveSize, 1);
    for (const wave of firstPass) {
      ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    const retryIds = await this.runWaves(firstPass);

    if (retryIds.length > 0) {
      const retryPeople = retryIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
      this.o.log(`Redialling ${retryPeople.length} people not reached on the first pass${this.o.retryDelayMs > 0 ? ` in ${Math.round(this.o.retryDelayMs / 60000)} minutes` : ""}.`);
      await sleep(this.o.retryDelayMs);
      const offset = firstPass.length;
      const retryWaves = planWaves(retryPeople, event.hazard, this.o.waveSize, 2).map((w) => ({ ...w, index: w.index + offset }));
      for (const wave of retryWaves) {
        ledger.append({ type: "wave.planned", at: this.now(), wave });
      }
      await this.runWaves(retryWaves);
    }

    await this.runCascade(null);

    const summary = this.summary();
    this.o.log(`Roll call complete: ${JSON.stringify(summary.outcomes)}. Calls placed: ${summary.callsPlaced}. Dispatch tickets: ${summary.dispatches}.`);
    void playbook;
    return summary;
  }

  /** Redials a subset of an existing event (yellow follow-ups). One attempt, then the cascade for that subset only. */
  async followUp(personIds: string[]): Promise<RunSummary> {
    const people = personIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
    if (people.length === 0) {
      return this.summary();
    }
    const attempt = Math.max(...people.map((p) => this.o.ledger.projection.states.get(p.id)?.attempts ?? 0)) + 1;
    const offset = this.o.ledger.projection.waves.length;
    const waves = planWaves(people, this.o.event.hazard, this.o.waveSize, attempt).map((w) => ({ ...w, index: w.index + offset }));
    for (const wave of waves) {
      this.o.ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    this.o.ledger.note("info", `Follow-up pass for ${people.length} people`);
    await this.runWaves(waves);
    await this.runCascade(new Set(personIds));
    return this.summary();
  }

  /** Places one call task per wave, waits, classifies. Returns the ids of people who should be redialled. */
  private async runWaves(waves: Wave[]): Promise<string[]> {
    const retry: string[] = [];
    await mapLimit(waves, this.o.parallelWaves, async (wave) => {
      const people = wave.personIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
      if (people.length === 0) {
        return;
      }
      let created: Awaited<ReturnType<typeof createWaveCall>>;
      try {
        created = await createWaveCall({
          config: this.o.config,
          client: this.o.client,
          event: this.o.event,
          playbook: this.o.playbook,
          wave,
          people,
          webhookUrl: this.o.webhookUrl,
        });
      } catch (err) {
        this.failWave(wave, people, err);
        return;
      }
      const record = toRecord(created.call, "wave", wave.index, wave.attempt, this.personByPhone, created.idempotencyKey);
      this.o.ledger.append({ type: "call.created", at: this.now(), call: record, taskPreview: created.task.slice(0, 600) });
      this.o.log(`Wave ${wave.index} (attempt ${wave.attempt}): CALL-E task ${created.call.id} created for ${people.length} people: ${people.map((p) => `${p.name} ${maskPhone(p.phone)}`).join(", ")}.`);

      const terminal = await this.waitForTerminal(created.call.id);
      const terminalRecord = toRecord(terminal, "wave", wave.index, wave.attempt, this.personByPhone, created.idempotencyKey);
      this.o.ledger.append({ type: "call.terminal", at: this.now(), call: terminalRecord, summary: terminal.summary ? maskPhonesInText(terminal.summary) : null, evidence: terminal.evidence.map(maskPhonesInText) });

      for (const person of people) {
        const recipient = terminal.recipients.find((r) => r.phones[0] === person.phone);
        const classification = recipient
          ? classify({ recipient, confidenceLabel: terminal.completionConfidence?.label ?? null })
          : { outcome: "unreachable" as const, reasons: ["recipient missing from the CALL-E response"], agentTier: null };
        const result = recipient && classification.outcome !== "unreachable" && recipient.structuredResult && "tier" in recipient.structuredResult ? (recipient.structuredResult as unknown as import("./types.js").TriageResult) : null;
        this.o.ledger.append({
          type: "person.classified",
          at: this.now(),
          personId: person.id,
          callId: terminal.id,
          classification,
          result,
          summary: recipient?.summary ? maskPhonesInText(recipient.summary) : null,
          evidence: userEvidence(terminal, person.phone),
        });
        const state = this.o.ledger.projection.states.get(person.id);
        const action = nextAction({ attempts: state?.attempts ?? wave.attempt, contactCalled: state?.contactCalled ?? false, outcome: classification.outcome }, person.contactPhone !== null, this.o.policy);
        const dueAt = action.delayMinutes !== undefined && action.delayMinutes > 0 ? new Date(Date.now() + action.delayMinutes * 60000).toISOString() : null;
        this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt });
        this.o.log(`  ${person.name}: ${classification.outcome.toUpperCase()} -> ${action.type} (${classification.reasons.join("; ")})`);
        if (action.type === "retry") {
          retry.push(person.id);
        }
      }
    });
    return retry;
  }

  private failWave(wave: Wave, people: Person[], err: unknown): void {
    const message = err instanceof CalleAPIError ? `${err.code} (${err.status}): ${err.message}` : (err as Error).message;
    this.o.ledger.note("error", `Wave ${wave.index} could not be created: ${maskPhonesInText(message)}`);
    this.o.log(`Wave ${wave.index} failed to create: ${message}`);
    for (const person of people) {
      this.o.ledger.append({
        type: "person.classified",
        at: this.now(),
        personId: person.id,
        callId: "none",
        classification: { outcome: "unreachable", reasons: [`call task could not be created: ${message.slice(0, 120)}`], agentTier: null },
        result: null,
        summary: null,
        evidence: [],
      });
      const action = nextAction({ attempts: this.o.policy.maxPersonAttempts, contactCalled: false, outcome: "unreachable" }, person.contactPhone !== null, this.o.policy);
      this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt: null });
    }
  }

  /** Webhook first, polling always. Streams developer events into the ledger while waiting. */
  private async waitForTerminal(callId: string): Promise<Call> {
    const deadline = Date.now() + this.o.callTimeoutMs;
    let cursor: string | undefined;
    while (Date.now() < deadline) {
      let woken = false;
      const unsubscribe = this.o.inbox.onDelivery(callId, () => {
        woken = true;
      });
      try {
        const call = await this.o.client.calls.get(callId);
        cursor = await this.streamEvents(callId, cursor);
        if (isTerminal(call)) {
          return call;
        }
        if (!woken && !this.o.inbox.wasDelivered(callId)) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, this.o.pollIntervalMs);
            const stop = this.o.inbox.onDelivery(callId, () => {
              clearTimeout(timer);
              stop();
              resolve();
            });
          });
        }
      } finally {
        unsubscribe();
      }
    }
    this.o.ledger.note("warning", `Call ${callId} did not reach a terminal state within the timeout; CALL-E may still dial it later (see platform issue #283).`);
    throw new CalleTimeoutError(`Timed out waiting for ${callId}`);
  }

  private async streamEvents(callId: string, cursor: string | undefined): Promise<string | undefined> {
    try {
      const list = await this.o.client.calls.listEvents(callId, cursor ? { cursor, limit: 100 } : { limit: 100 });
      for (const event of list.data) {
        if (this.seenEventIds.has(event.id)) {
          continue;
        }
        this.seenEventIds.add(event.id);
        this.o.ledger.append({ type: "call.event", at: event.created_at, callId, level: event.level, message: maskPhonesInText(event.message), eventId: event.id });
      }
      return list.nextCursor ?? cursor;
    } catch {
      return cursor;
    }
  }

  /** Escalation calls and dispatch tickets for everyone whose next action needs a human. */
  private async runCascade(only: Set<string> | null): Promise<void> {
    const states = [...this.o.ledger.projection.states.values()].filter((s) => only === null || only.has(s.personId));
    const needsContact = states.filter((s) => s.nextAction?.type === "escalate" || s.nextAction?.type === "contact-call");
    const doorKnocks = states.filter((s) => s.nextAction?.type === "door-knock");

    for (const state of states.filter((s) => s.outcome === "red")) {
      const person = this.personById.get(state.personId);
      this.createTicket({
        personId: state.personId,
        kind: "emergency_services",
        summary: `${person?.name ?? state.personId}: red flags (${state.reasons.join("; ")}). Decide whether to dispatch emergency services.`,
        etaMinutes: null,
        needsHumanApproval: true,
      });
    }

    await mapLimit(needsContact, 3, async (state) => {
      const person = this.personById.get(state.personId);
      if (!person || person.contactPhone === null) {
        return;
      }
      let created: Awaited<ReturnType<typeof createEscalationCall>>;
      try {
        created = await createEscalationCall({
          config: this.o.config,
          client: this.o.client,
          event: this.o.event,
          playbook: this.o.playbook,
          person,
          outcome: state.outcome ?? "unverified",
          reasons: state.reasons,
          attempts: state.attempts,
          webhookUrl: this.o.webhookUrl,
        });
      } catch (err) {
        const message = err instanceof CalleAPIError ? `${err.code}: ${err.message}` : (err as Error).message;
        this.o.ledger.note("error", `Escalation call for ${person.name} could not be created: ${maskPhonesInText(message)}`);
        this.createTicket({ personId: person.id, kind: "door_knock", summary: `${person.name}: contact could not be phoned (${message.slice(0, 80)}); send a person.`, etaMinutes: null, needsHumanApproval: false });
        return;
      }
      const contactByPhone = new Map<string, Person>([[person.contactPhone, person]]);
      const record = toRecord(created.call, "escalation", null, 1, contactByPhone, created.idempotencyKey);
      this.o.ledger.append({ type: "call.created", at: this.now(), call: record, taskPreview: created.task.slice(0, 600) });
      this.o.log(`Escalation: calling ${person.contactName ?? "emergency contact"} ${maskPhone(person.contactPhone)} about ${person.name} (${state.outcome}).`);
      let terminal: Call;
      try {
        terminal = await this.waitForTerminal(created.call.id);
      } catch {
        this.createTicket({ personId: person.id, kind: "door_knock", summary: `${person.name}: escalation call to contact timed out; send a person.`, etaMinutes: null, needsHumanApproval: false });
        return;
      }
      this.o.ledger.append({ type: "call.terminal", at: this.now(), call: toRecord(terminal, "escalation", null, 1, contactByPhone, created.idempotencyKey), summary: terminal.summary ? maskPhonesInText(terminal.summary) : null, evidence: terminal.evidence.map(maskPhonesInText) });
      const recipient = terminal.recipients[0];
      const result = recipient && recipient.status === "completed" && isEscalationResult(recipient.structuredResult) ? recipient.structuredResult : null;
      this.o.ledger.append({ type: "escalation.completed", at: this.now(), personId: person.id, callId: terminal.id, result, summary: recipient?.summary ? maskPhonesInText(recipient.summary) : null });
      const disposition = escalationDisposition(result, state.outcome);
      const contactName = person.contactName ?? "emergency contact";
      switch (disposition.kind) {
        case "contact_committed":
          this.createTicket({ personId: person.id, kind: "contact_committed", summary: `${contactName} is going to ${person.name}, ETA ${disposition.etaMinutes} min.`, etaMinutes: disposition.etaMinutes, needsHumanApproval: false });
          break;
        case "emergency_services":
          this.createTicket({ personId: person.id, kind: "emergency_services", summary: `${contactName} asked for emergency services to be sent to ${person.name}.`, etaMinutes: null, needsHumanApproval: true });
          break;
        case "door_knock":
          this.createTicket({ personId: person.id, kind: "door_knock", summary: `${person.name}: ${disposition.reason}; send a person.`, etaMinutes: null, needsHumanApproval: false });
          break;
        default: {
          const exhaustive: never = disposition;
          return exhaustive;
        }
      }
      this.o.log(`  ${contactName}: ${disposition.kind}${disposition.kind === "contact_committed" ? ` (ETA ${disposition.etaMinutes} min)` : ""}`);
    });

    for (const state of doorKnocks) {
      const person = this.personById.get(state.personId);
      this.createTicket({ personId: state.personId, kind: "door_knock", summary: `${person?.name ?? state.personId}: ${state.nextAction?.reason ?? "needs a visit"}.`, etaMinutes: null, needsHumanApproval: false });
    }
  }

  private createTicket(input: Omit<DispatchTicket, "id" | "createdAt" | "approvedAt">): void {
    const ticket: DispatchTicket = { ...input, id: `dsp_${randomBytes(4).toString("hex")}`, createdAt: this.now(), approvedAt: null };
    this.o.ledger.append({ type: "dispatch.created", at: this.now(), ticket });
  }

  summary(): RunSummary {
    const outcomes: Record<Outcome | "pending", number> = { green: 0, yellow: 0, red: 0, unreachable: 0, unverified: 0, pending: 0 };
    for (const state of this.o.ledger.projection.states.values()) {
      outcomes[state.outcome ?? "pending"] += 1;
    }
    const calls = [...this.o.ledger.projection.calls.values()];
    return {
      eventId: this.o.event.id,
      outcomes,
      callsPlaced: calls.filter((c) => c.kind === "wave").length,
      escalationCalls: calls.filter((c) => c.kind === "escalation").length,
      dispatches: this.o.ledger.projection.dispatches.size,
    };
  }
}
