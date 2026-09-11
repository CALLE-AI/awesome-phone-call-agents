// The event loop of a roll call: plan waves, place CALL-E call tasks, wait for terminal results
// (webhook first, polling always), classify every person with the fail-closed rules, then run
// the cascade: redial, phone the contact, or put a human on the door-knock list.
//
// Failure semantics matter more than the happy path here:
//   - CALL-E refusing to accept a task (rate limit, outage) is retried with backoff, and if it
//     still fails the people are marked not_attempted. Nobody is escalated for a call that never
//     happened; an operator resumes the event instead.
//   - A call that has not finished when the run stops is left pending, never guessed. `resume`
//     reattaches to it by call id and settles it.
//   - Every task carries an idempotency key, so resume can re-place a failed wave with the same
//     key and CALL-E returns the existing call if it had in fact accepted it.
// Every step is appended to the ledger before the next one starts.

import type { Call, CalleClient } from "@call-e/calle";
import { CalleAPIError, CalleConnectionError, CalleRateLimitError, CalleTimeoutError } from "@call-e/calle";
import { createEscalationCall, createWaveCall } from "./calle.js";
import { DEFAULT_POLICY, escalationDisposition, nextAction, type CascadePolicy } from "./cascade.js";
import { classify, isTriageResult } from "./classify.js";
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";
import { maskPhone, maskPhonesInText } from "./mask.js";
import type { Playbook } from "./playbooks.js";
import type { RegistryLoadReport } from "./registry.js";
import { planWaves, scorePerson } from "./risk.js";
import type { CallRecord, DispatchTicket, EscalationResult, HazardEvent, Outcome, Person, PersonState, TaskMode, Wave } from "./types.js";
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
  taskMode?: TaskMode;
  policy?: CascadePolicy;
  pollIntervalMs?: number;
  callTimeoutMs?: number;
  /** Delay before the second attempt. Collapsed to zero in drills. */
  retryDelayMs?: number;
  /** How many times to retry a rejected create before marking people not_attempted. */
  createRetries?: number;
  /** Base delay for create retries (doubles each time). */
  createRetryBaseMs?: number;
  log?: (line: string) => void;
}

export interface RunSummary {
  eventId: string;
  outcomes: Record<Outcome | "pending", number>;
  callsPlaced: number;
  escalationCalls: number;
  dispatches: number;
  notAttempted: number;
  pending: number;
}

interface Placement {
  callId: string;
  wave: Wave;
  people: Person[];
  idempotencyKey: string;
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

function isTerminal(call: Call): boolean {
  return TERMINAL.has(call.status);
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

function errorText(err: unknown): string {
  if (err instanceof CalleAPIError) {
    return `${err.code} (${err.status}): ${err.message}`;
  }
  return (err as Error).message;
}

/** Transient platform trouble is retried; a request CALL-E rejects as invalid is not. */
function isRetryable(err: unknown): boolean {
  if (err instanceof CalleRateLimitError || err instanceof CalleConnectionError) {
    return true;
  }
  if (err instanceof CalleAPIError) {
    return err.status >= 500 || err.code === "provider_unavailable" || err.code === "internal_error" || err.code === "call_not_ready";
  }
  return false;
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

type Resolved = Required<Pick<RunOptions, "taskMode" | "policy" | "pollIntervalMs" | "callTimeoutMs" | "retryDelayMs" | "createRetries" | "createRetryBaseMs" | "log">> & RunOptions;

export class Orchestrator {
  private readonly o: Resolved;
  private readonly personByPhone = new Map<string, Person>();
  private readonly personById = new Map<string, Person>();
  private readonly seenEventIds = new Set<string>();

  constructor(options: RunOptions) {
    this.o = {
      taskMode: options.config.taskMode,
      policy: DEFAULT_POLICY,
      pollIntervalMs: 3000,
      callTimeoutMs: 15 * 60 * 1000,
      retryDelayMs: 0,
      createRetries: 4,
      createRetryBaseMs: 1000,
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

  private get states(): Map<string, PersonState> {
    return this.o.ledger.projection.states;
  }

  // ---------------------------------------------------------------- entry points

  async run(): Promise<RunSummary> {
    const { ledger, event, people, registryReport, config } = this.o;
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
    this.o.log(`Event ${event.id}: ${event.headline} (${event.area}). ${people.length} people, ${config.mode} mode, ${this.o.taskMode} tasks.`);

    const firstPass = planWaves(people, event.hazard, this.o.waveSize, 1);
    for (const wave of firstPass) {
      ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    const retryIds = await this.runWaves(firstPass);
    await this.runRetryPass(retryIds, firstPass.length);
    await this.runCascade(null);
    return this.finish();
  }

  /** Redials a subset of an existing event (yellow follow-ups). One attempt, then the cascade for that subset only. */
  async followUp(personIds: string[]): Promise<RunSummary> {
    const people = personIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
    if (people.length === 0) {
      return this.summary();
    }
    const attempt = Math.max(...people.map((p) => this.states.get(p.id)?.attempts ?? 0)) + 1;
    const offset = this.o.ledger.projection.waves.length;
    const waves = planWaves(people, this.o.event.hazard, this.o.waveSize, attempt).map((w) => ({ ...w, index: w.index + offset }));
    for (const wave of waves) {
      this.o.ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    this.o.ledger.note("info", `Follow-up pass for ${people.length} people`);
    await this.runWaves(waves);
    await this.runCascade(new Set(personIds));
    return this.finish();
  }

  /**
   * Reattaches to an interrupted event: settles calls that were still in flight, re-places waves
   * CALL-E never accepted (same idempotency keys), redials people not reached, and runs the cascade
   * for anyone still waiting on one. Safe to run more than once.
   */
  async resume(): Promise<RunSummary> {
    const projection = this.o.ledger.projection;
    this.o.ledger.note("info", "Resume started");
    const retryIds: string[] = [];

    const inFlight = [...projection.calls.values()].filter((c) => !TERMINAL.has(c.status));
    for (const record of inFlight) {
      const people = record.personIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
      if (record.kind === "wave") {
        const wave = projection.waves.find((w) => w.index === record.wave) ?? { index: record.wave ?? 0, priority: 1 as const, personIds: record.personIds, attempt: record.attempt };
        this.o.log(`Resuming wave call ${record.callId} (${people.length} people).`);
        retryIds.push(...(await this.settleWave({ callId: record.callId, wave, people, idempotencyKey: record.idempotencyKey })));
      } else {
        const person = people[0];
        if (person) {
          this.o.log(`Resuming escalation call ${record.callId} for ${person.name}.`);
          await this.settleEscalation(person, record.callId, record.idempotencyKey);
        }
      }
    }

    const failed = [...projection.failedWaves];
    if (failed.length > 0) {
      this.o.log(`Re-placing ${failed.length} wave(s) CALL-E did not accept earlier.`);
      retryIds.push(...(await this.runWaves(failed.map((f) => ({ ...f.wave, personIds: f.personIds })))));
    }

    await this.runRetryPass(retryIds, projection.waves.length);
    await this.runCascade(null);
    return this.finish();
  }

  // ---------------------------------------------------------------- waves

  private async runRetryPass(retryIds: string[], waveOffset: number): Promise<void> {
    const unique = [...new Set(retryIds)];
    if (unique.length === 0) {
      return;
    }
    const retryPeople = unique.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
    this.o.log(`Redialling ${retryPeople.length} people not reached on the first pass${this.o.retryDelayMs > 0 ? ` in ${Math.round(this.o.retryDelayMs / 60000)} minutes` : ""}.`);
    await sleep(this.o.retryDelayMs);
    const offset = Math.max(waveOffset, this.o.ledger.projection.waves.length);
    const retryWaves = planWaves(retryPeople, this.o.event.hazard, this.o.waveSize, 2).map((w) => ({ ...w, index: w.index + offset }));
    for (const wave of retryWaves) {
      this.o.ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    await this.runWaves(retryWaves);
  }

  /** Places and settles waves. Returns the ids of people who should be redialled. */
  private async runWaves(waves: Wave[]): Promise<string[]> {
    const retry: string[] = [];
    await mapLimit(waves, this.o.parallelWaves, async (wave) => {
      const people = wave.personIds.map((id) => this.personById.get(id)).filter((p): p is Person => p !== undefined);
      if (people.length === 0) {
        return;
      }
      const placements = await this.placeWave(wave, people);
      for (const placement of placements) {
        retry.push(...(await this.settleWave(placement)));
      }
    });
    return retry;
  }

  /** One task per wave (batch) or one task per person placed in parallel (per-person). */
  private async placeWave(wave: Wave, people: Person[]): Promise<Placement[]> {
    const groups: Person[][] = this.o.taskMode === "batch" ? [people] : people.map((p) => [p]);
    const placements = await mapLimit(groups, Math.max(1, this.o.waveSize), async (group) => {
      const personKey = this.o.taskMode === "per-person" ? group[0]?.id : undefined;
      try {
        const created = await this.createWithRetry(`wave ${wave.index}${personKey ? ` (${group[0]?.name})` : ""}`, () =>
          createWaveCall({
            config: this.o.config,
            client: this.o.client,
            event: this.o.event,
            playbook: this.o.playbook,
            wave,
            people: group,
            webhookUrl: this.o.webhookUrl,
            ...(personKey !== undefined ? { personKey } : {}),
          }),
        );
        const record = toRecord(created.call, "wave", wave.index, wave.attempt, this.personByPhone, created.idempotencyKey);
        this.o.ledger.append({ type: "call.created", at: this.now(), call: record, taskPreview: created.task.slice(0, 600) });
        this.o.log(`Wave ${wave.index} (attempt ${wave.attempt}): CALL-E task ${created.call.id} created for ${group.map((p) => `${p.name} ${maskPhone(p.phone)}`).join(", ")}.`);
        return { callId: created.call.id, wave, people: group, idempotencyKey: created.idempotencyKey } satisfies Placement;
      } catch (err) {
        this.failWave(wave, group, err);
        return null;
      }
    });
    return placements.filter((p): p is Placement => p !== null);
  }

  private async createWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (!isRetryable(err) || attempt > this.o.createRetries) {
          throw err;
        }
        const delay = this.o.createRetryBaseMs * 2 ** (attempt - 1);
        this.o.ledger.note("warning", `CALL-E did not accept ${label} (${maskPhonesInText(errorText(err))}); retry ${attempt}/${this.o.createRetries} in ${delay} ms`);
        await sleep(delay);
      }
    }
  }

  /** CALL-E never accepted the task: nobody was dialled, so nobody is alerted. */
  private failWave(wave: Wave, people: Person[], err: unknown): void {
    const message = maskPhonesInText(errorText(err));
    this.o.ledger.append({ type: "wave.failed", at: this.now(), wave: { ...wave, personIds: people.map((p) => p.id) }, personIds: people.map((p) => p.id), error: message });
    this.o.log(`Wave ${wave.index} was not accepted by CALL-E: ${message}. ${people.length} people marked not attempted.`);
    for (const person of people) {
      this.o.ledger.append({
        type: "person.classified",
        at: this.now(),
        personId: person.id,
        callId: "none",
        classification: { outcome: "not_attempted", reasons: [`call task not accepted: ${message.slice(0, 140)}`], agentTier: null },
        result: null,
        summary: null,
        evidence: [],
      });
      const action = nextAction({ attempts: this.states.get(person.id)?.attempts ?? 0, contactCalled: false, outcome: "not_attempted" }, person.contactPhone !== null, this.o.policy);
      this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt: null });
    }
  }

  /** Waits for a placed wave call and classifies its people. Returns ids to redial. */
  private async settleWave(placement: Placement): Promise<string[]> {
    const { callId, wave, people, idempotencyKey } = placement;
    let terminal: Call;
    try {
      terminal = await this.waitForTerminal(callId);
    } catch (err) {
      this.markPending(callId, people, err);
      return [];
    }
    const record = toRecord(terminal, "wave", wave.index, wave.attempt, this.personByPhone, idempotencyKey);
    this.o.ledger.append({ type: "call.terminal", at: this.now(), call: record, summary: terminal.summary ? maskPhonesInText(terminal.summary) : null, evidence: terminal.evidence.map(maskPhonesInText) });

    // CALL-E's completion confidence is a judgment about the whole task. With one recipient it
    // belongs to that person and may veto a green; with many it cannot be attributed, so it is
    // reported but does not change any individual verdict.
    const attributableConfidence = terminal.recipients.length === 1 ? (terminal.completionConfidence?.label ?? null) : null;
    const retry: string[] = [];
    for (const person of people) {
      const recipient = terminal.recipients.find((r) => r.phones[0] === person.phone);
      const classification = recipient
        ? classify({ recipient, confidenceLabel: attributableConfidence })
        : { outcome: "unreachable" as const, reasons: ["recipient missing from the CALL-E response"], agentTier: null };
      const result = recipient && classification.outcome !== "unreachable" && isTriageResult(recipient.structuredResult) ? recipient.structuredResult : null;
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
      const state = this.states.get(person.id);
      const action = nextAction({ attempts: state?.attempts ?? wave.attempt, contactCalled: state?.contactCalled ?? false, outcome: classification.outcome }, person.contactPhone !== null, this.o.policy);
      const dueAt = action.delayMinutes !== undefined && action.delayMinutes > 0 ? new Date(Date.now() + action.delayMinutes * 60000).toISOString() : null;
      this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt });
      this.o.log(`  ${person.name}: ${classification.outcome.toUpperCase()} -> ${action.type} (${classification.reasons.join("; ")})`);
      if (action.type === "retry") {
        retry.push(person.id);
      }
    }
    return retry;
  }

  private markPending(callId: string, people: Person[], err: unknown): void {
    const reason = err instanceof CalleTimeoutError ? "timed out waiting for the result" : maskPhonesInText(errorText(err));
    this.o.ledger.append({ type: "call.pending", at: this.now(), callId, personIds: people.map((p) => p.id), reason });
    this.o.log(`Call ${callId} is still pending (${reason}); ${people.length} people await a result. Run resume later.`);
    for (const person of people) {
      this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action: { type: "await-result", reason: `call ${callId} ${reason}` }, dueAt: null });
    }
  }

  /** Webhook first, polling always. Streams developer events into the ledger while waiting. */
  private async waitForTerminal(callId: string): Promise<Call> {
    const deadline = Date.now() + this.o.callTimeoutMs;
    let cursor: string | undefined;
    let consecutiveErrors = 0;
    while (Date.now() < deadline) {
      let woken = false;
      const unsubscribe = this.o.inbox.onDelivery(callId, () => {
        woken = true;
      });
      try {
        let call: Call;
        try {
          call = await this.o.client.calls.get(callId);
          consecutiveErrors = 0;
        } catch (err) {
          consecutiveErrors += 1;
          if (!isRetryable(err) || consecutiveErrors > 5) {
            throw err;
          }
          await sleep(this.o.pollIntervalMs);
          continue;
        }
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
    this.o.ledger.note("warning", `Call ${callId} did not reach a terminal state within the timeout; CALL-E may still dial it later (platform issue #283). Run resume to settle it.`);
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

  // ---------------------------------------------------------------- cascade

  /** Escalation calls and dispatch tickets for everyone whose next action needs a human. Idempotent. */
  private async runCascade(only: Set<string> | null): Promise<void> {
    const states = [...this.states.values()].filter((s) => only === null || only.has(s.personId));

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

    const needsContact = states.filter((s) => (s.nextAction?.type === "escalate" || s.nextAction?.type === "contact-call") && !s.contactCalled);
    await mapLimit(needsContact, 3, async (state) => {
      const person = this.personById.get(state.personId);
      if (!person || person.contactPhone === null) {
        return;
      }
      let created: Awaited<ReturnType<typeof createEscalationCall>>;
      try {
        created = await this.createWithRetry(`escalation for ${person.name}`, () =>
          createEscalationCall({
            config: this.o.config,
            client: this.o.client,
            event: this.o.event,
            playbook: this.o.playbook,
            person,
            outcome: state.outcome ?? "unverified",
            reasons: state.reasons,
            attempts: state.attempts,
            webhookUrl: this.o.webhookUrl,
          }),
        );
      } catch (err) {
        const message = maskPhonesInText(errorText(err));
        this.o.ledger.note("error", `Escalation call for ${person.name} could not be created: ${message}`);
        this.createTicket({ personId: person.id, kind: "door_knock", summary: `${person.name}: contact could not be phoned (${message.slice(0, 80)}); send a person.`, etaMinutes: null, needsHumanApproval: false });
        return;
      }
      const contactByPhone = new Map<string, Person>([[person.contactPhone, person]]);
      const record = toRecord(created.call, "escalation", null, 1, contactByPhone, created.idempotencyKey);
      this.o.ledger.append({ type: "call.created", at: this.now(), call: record, taskPreview: created.task.slice(0, 600) });
      this.o.log(`Escalation: calling ${person.contactName ?? "emergency contact"} ${maskPhone(person.contactPhone)} about ${person.name} (${state.outcome}).`);
      await this.settleEscalation(person, created.call.id, created.idempotencyKey);
    });

    for (const state of states.filter((s) => s.nextAction?.type === "door-knock")) {
      const person = this.personById.get(state.personId);
      this.createTicket({ personId: state.personId, kind: "door_knock", summary: `${person?.name ?? state.personId}: ${state.nextAction?.reason ?? "needs a visit"}.`, etaMinutes: null, needsHumanApproval: false });
    }

    for (const state of states.filter((s) => s.outcome === "not_attempted")) {
      const person = this.personById.get(state.personId);
      this.createTicket({ personId: state.personId, kind: "not_attempted", summary: `${person?.name ?? state.personId}: CALL-E did not accept the call task; resume the event or call by hand.`, etaMinutes: null, needsHumanApproval: false });
    }
  }

  private async settleEscalation(person: Person, callId: string, idempotencyKey: string): Promise<void> {
    const state = this.states.get(person.id);
    const contactByPhone = new Map<string, Person>([[person.contactPhone ?? "", person]]);
    let terminal: Call;
    try {
      terminal = await this.waitForTerminal(callId);
    } catch (err) {
      this.markPending(callId, [person], err);
      return;
    }
    this.o.ledger.append({ type: "call.terminal", at: this.now(), call: toRecord(terminal, "escalation", null, 1, contactByPhone, idempotencyKey), summary: terminal.summary ? maskPhonesInText(terminal.summary) : null, evidence: terminal.evidence.map(maskPhonesInText) });
    const recipient = terminal.recipients[0];
    const result = recipient && recipient.status === "completed" && isEscalationResult(recipient.structuredResult) ? recipient.structuredResult : null;
    this.o.ledger.append({ type: "escalation.completed", at: this.now(), personId: person.id, callId: terminal.id, result, summary: recipient?.summary ? maskPhonesInText(recipient.summary) : null });
    const disposition = escalationDisposition(result, state?.outcome ?? null);
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
  }

  /** One ticket per person and kind. Re-running the cascade never duplicates a ticket. */
  private createTicket(input: Omit<DispatchTicket, "id" | "createdAt" | "approvedAt">): void {
    const existing = [...this.o.ledger.projection.dispatches.values()].find((t) => t.personId === input.personId && t.kind === input.kind);
    if (existing) {
      return;
    }
    const ticket: DispatchTicket = { ...input, id: `dsp_${randomBytes(4).toString("hex")}`, createdAt: this.now(), approvedAt: null };
    this.o.ledger.append({ type: "dispatch.created", at: this.now(), ticket });
  }

  // ---------------------------------------------------------------- summary

  private finish(): RunSummary {
    const summary = this.summary();
    this.o.log(`Roll call ${summary.pending > 0 ? "paused" : "complete"}: ${JSON.stringify(summary.outcomes)}. Calls placed: ${summary.callsPlaced}. Dispatch tickets: ${summary.dispatches}.${summary.pending > 0 ? ` ${summary.pending} call(s) still pending; run resume.` : ""}`);
    return summary;
  }

  summary(): RunSummary {
    const outcomes: Record<Outcome | "pending", number> = { green: 0, yellow: 0, red: 0, declined: 0, unreachable: 0, unverified: 0, not_attempted: 0, pending: 0 };
    for (const state of this.states.values()) {
      outcomes[state.outcome ?? "pending"] += 1;
    }
    const calls = [...this.o.ledger.projection.calls.values()];
    return {
      eventId: this.o.event.id,
      outcomes,
      callsPlaced: calls.filter((c) => c.kind === "wave").length,
      escalationCalls: calls.filter((c) => c.kind === "escalation").length,
      dispatches: this.o.ledger.projection.dispatches.size,
      notAttempted: outcomes.not_attempted,
      pending: calls.filter((c) => !TERMINAL.has(c.status)).length,
    };
  }
}
