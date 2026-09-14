// The event loop of an outreach campaign.
//
//   1. Ex parte first: anyone the state's own data already clears is never called.
//   2. Waves ordered by deadline and paperwork risk; one CALL-E call task per person, placed in
//      parallel within a wave, each with an idempotency key.
//   3. Webhook first, polling always; every result is classified with fail-closed rules.
//   4. Redial once; then letters and community outreach for anyone still not screened.
//   5. Every outcome becomes a worklist item for a caseworker or navigator. Nothing here changes
//      anyone's coverage.
//
// Failure semantics: a task CALL-E refuses is retried with backoff and then marked not_attempted,
// never "unreachable"; a call that has not finished is left awaiting, never guessed; `resume`
// reattaches by call id and re-places refused tasks with the same keys.

import type { Call, CalleClient } from "@call-e/calle";
import { CalleAPIError, CalleConnectionError, CalleRateLimitError, CalleTimeoutError } from "@call-e/calle";
import { createScreeningCall, screeningIdempotencyKey } from "./calle.js";
import { DEFAULT_POLICY, HARD_CALL_CAP, nextAction, type CascadePolicy } from "./cascade.js";
import { classifyScreening, isScreeningResult } from "./classify.js";
import { dialAllowed, type Config } from "./config.js";
import { suppressedIds, type Ledger } from "./ledger.js";
import { maskPhone, maskPhonesInText, maskResultText } from "./mask.js";
import { planWaves, scoreEnrollee } from "./priority.js";
import type { RegistryLoadReport } from "./registry.js";
import { checklistFor, clearedByData, exemptionLabel, exemptionLabels, formatMonth, type Rules, type StateConfig } from "./rules.js";
import type { CallRecord, Campaign, Enrollee, Outcome, PersonState, Wave, WorkItem, WorkKind } from "./types.js";
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
  campaign: Campaign;
  rules: Rules;
  state: StateConfig;
  people: Enrollee[];
  registryReport: RegistryLoadReport;
  excludedNotDue?: number;
  webhookUrl: string | null;
  waveSize: number;
  parallelWaves: number;
  policy?: CascadePolicy;
  pollIntervalMs?: number;
  callTimeoutMs?: number;
  /** Delay before the redial. Collapsed to zero in drills. */
  retryDelayMs?: number;
  createRetries?: number;
  createRetryBaseMs?: number;
  log?: (line: string) => void;
}

export interface RunSummary {
  campaignId: string;
  outcomes: Record<Outcome | "pending", number>;
  calls: number;
  workItems: number;
  corrections: number;
  notAttempted: number;
  /** Submissions that failed ambiguously: it is unknown whether a call went out. */
  dialUnknown: number;
  pending: number;
  awareYes: number;
  awareNo: number;
}

interface Placement {
  callId: string;
  wave: Wave;
  person: Enrollee;
  idempotencyKey: string;
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

function toRecord(call: Call, wave: Wave, personByPhone: Map<string, Enrollee>, idempotencyKey: string): CallRecord {
  return {
    callId: call.id,
    kind: "screen",
    wave: wave.index,
    attempt: wave.attempt,
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
    // The last things a person says are the substantive answers; the first are the greeting and the birth year.
    .slice(-4)
    .map((t) => maskPhonesInText(t.text));
}

function errorText(err: unknown): string {
  if (err instanceof CalleAPIError) {
    return `${err.code} (${err.status}): ${err.message}`;
  }
  return (err as Error).message;
}

/**
 * Did this failure happen before CALL-E could have dialled anybody?
 *
 * A 429 is the only refusal that says so plainly: the request was rejected at the door, no call
 * exists, and re-sending it is safe. A dropped connection or a 5xx says nothing of the kind - the
 * request may have arrived, created a task and started ringing a telephone before the failure
 * reached us. Those are `submissionAmbiguous` below, and the campaign stops rather than guesses.
 */
function isDefinitelyNotDialled(err: unknown): boolean {
  return err instanceof CalleRateLimitError;
}

/**
 * A failure that leaves the outcome of the submission genuinely unknown.
 *
 * An idempotency key does make a retry safe against duplication, but it cannot tell an operator
 * whether the first attempt rang. Re-sending is therefore not the problem; *claiming afterwards
 * that nobody was dialled* is. We stop, record `dial_unknown`, and put it in front of a human.
 */
function submissionAmbiguous(err: unknown): boolean {
  if (err instanceof CalleConnectionError) {
    return true;
  }
  if (err instanceof CalleAPIError) {
    return err.status >= 500 || err.code === "provider_unavailable" || err.code === "internal_error" || err.code === "call_not_ready";
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
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

type Resolved = Required<Pick<RunOptions, "policy" | "pollIntervalMs" | "callTimeoutMs" | "retryDelayMs" | "createRetries" | "createRetryBaseMs" | "log">> & RunOptions;

export class Orchestrator {
  private readonly o: Resolved;
  private readonly personByPhone = new Map<string, Enrollee>();
  private readonly personById = new Map<string, Enrollee>();
  private readonly seenEventIds = new Set<string>();

  constructor(options: RunOptions) {
    this.o = {
      policy: { ...DEFAULT_POLICY, maxAttempts: options.config.maxAttempts },
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
    const { ledger, campaign, people, registryReport, config, rules, state } = this.o;
    ledger.append({
      type: "campaign.declared",
      at: this.now(),
      campaign,
      mode: config.mode,
      stateName: state.state_name,
      callerOrg: state.caller_org,
      hoursPerMonth: rules.requirement.hours_per_month,
      exemptionLabels: exemptionLabels(rules),
    });
    ledger.append({
      type: "registry.loaded",
      at: this.now(),
      count: people.length,
      skipped: registryReport.skippedNoConsent + registryReport.skippedDoNotCall + registryReport.skippedInvalidPhone + registryReport.skippedDuplicatePhone + registryReport.skippedMissingFields,
      excludedNotDue: this.o.excludedNotDue ?? 0,
      warnings: registryReport.warnings,
    });
    for (const person of people) {
      const p = scoreEnrollee(person, campaign.asOf);
      ledger.append({ type: "person.registered", at: this.now(), person, priorityScore: p.score, priority: p.priority, daysToCheck: p.daysToCheck, factors: p.factors });
    }
    const callable: Enrollee[] = [];
    for (const person of people) {
      const clearance = clearedByData(person, rules);
      if (clearance.cleared && clearance.kind !== null) {
        ledger.append({ type: "person.cleared", at: this.now(), personId: person.id, kind: clearance.kind, codes: clearance.codes, reason: clearance.reason });
      } else {
        callable.push(person);
      }
    }
    this.o.log(`Campaign ${campaign.id}: ${people.length} people on the list, ${people.length - callable.length} cleared by state data, ${callable.length} to call (${config.mode} mode).`);

    const firstPass = planWaves(callable, campaign.asOf, this.o.waveSize, 1);
    for (const wave of firstPass) {
      ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    const retryIds = await this.runWaves(firstPass);
    await this.runRetryPass(retryIds);
    this.createWorkItems(null);
    return this.finish();
  }

  /** Calls back the people who asked for a better time and are due. Never more than three calls per person. */
  async followUp(personIds: string[]): Promise<RunSummary> {
    const suppressed = suppressedIds(this.o.ledger.projection);
    const people = personIds
      .map((id) => this.personById.get(id))
      .filter((p): p is Enrollee => p !== undefined)
      .filter((p) => !suppressed.has(p.id) && (this.states.get(p.id)?.attempts ?? 0) < HARD_CALL_CAP);
    if (people.length === 0) {
      this.o.log("Nobody is eligible for a follow-up call.");
      return this.summary();
    }
    const attempt = Math.max(...people.map((p) => this.states.get(p.id)?.attempts ?? 0)) + 1;
    const offset = this.o.ledger.projection.waves.length;
    const waves = planWaves(people, this.o.campaign.asOf, this.o.waveSize, attempt).map((w) => ({ ...w, index: w.index + offset }));
    for (const wave of waves) {
      this.o.ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    this.o.ledger.note("info", `Follow-up pass for ${people.length} people`);
    await this.runWaves(waves);
    this.createWorkItems(new Set(people.map((p) => p.id)));
    return this.finish();
  }

  /** Reattaches to an interrupted campaign: settles pending calls, re-places refused tasks, redials, finishes the worklist. Safe to repeat. */
  async resume(): Promise<RunSummary> {
    const projection = this.o.ledger.projection;
    this.o.ledger.note("info", "Resume started");
    const retryIds: string[] = [];
    const inFlight = [...projection.calls.values()].filter((c) => !TERMINAL.has(c.status));
    for (const record of inFlight) {
      const person = this.personById.get(record.personIds[0] ?? "");
      if (!person) {
        continue;
      }
      const wave = projection.waves.find((w) => w.index === record.wave) ?? { index: record.wave ?? 0, priority: 1 as const, personIds: record.personIds, attempt: record.attempt };
      this.o.log(`Resuming call ${record.callId} for ${person.name}.`);
      retryIds.push(...(await this.settle({ callId: record.callId, wave, person, idempotencyKey: record.idempotencyKey })));
    }
    const failed = [...projection.failedWaves];
    if (failed.length > 0) {
      this.o.log(`Re-placing ${failed.reduce((n, f) => n + f.personIds.length, 0)} call task(s) CALL-E did not accept earlier.`);
      retryIds.push(...(await this.runWaves(failed.map((f) => ({ ...f.wave, personIds: f.personIds })))));
    }
    await this.runRetryPass(retryIds);
    this.createWorkItems(null);
    return this.finish();
  }

  // ---------------------------------------------------------------- waves

  private async runRetryPass(retryIds: string[]): Promise<void> {
    const unique = [...new Set(retryIds)];
    if (unique.length === 0) {
      return;
    }
    const people = unique.map((id) => this.personById.get(id)).filter((p): p is Enrollee => p !== undefined);
    this.o.log(`Redialling ${people.length} people not screened on the first pass${this.o.retryDelayMs > 0 ? ` in ${Math.round(this.o.retryDelayMs / 60000)} minutes` : ""}.`);
    await sleep(this.o.retryDelayMs);
    const offset = this.o.ledger.projection.waves.length;
    const waves = planWaves(people, this.o.campaign.asOf, this.o.waveSize, 2).map((w) => ({ ...w, index: w.index + offset }));
    for (const wave of waves) {
      this.o.ledger.append({ type: "wave.planned", at: this.now(), wave });
    }
    await this.runWaves(waves);
  }

  /** Places and settles waves; one task per person, in parallel within a wave. Returns ids to redial. */
  private async runWaves(waves: Wave[]): Promise<string[]> {
    const retry: string[] = [];
    await mapLimit(waves, this.o.parallelWaves, async (wave) => {
      const people = wave.personIds.map((id) => this.personById.get(id)).filter((p): p is Enrollee => p !== undefined);
      await mapLimit(people, Math.max(1, this.o.waveSize), async (person) => {
        const placement = await this.place(wave, person);
        if (placement !== null) {
          retry.push(...(await this.settle(placement)));
        }
      });
    });
    return retry;
  }

  private async place(wave: Wave, person: Enrollee): Promise<Placement | null> {
    if (!dialAllowed(this.o.config, person.phone)) {
      this.o.ledger.note("warning", `${person.name} is not on SC_LIVE_ALLOWLIST; not dialled`);
      return null;
    }
    try {
      const created = await this.createWithRetry(`the call to ${person.name}`, () =>
        createScreeningCall({
          config: this.o.config,
          client: this.o.client,
          campaign: this.o.campaign,
          rules: this.o.rules,
          state: this.o.state,
          person,
          wave,
          webhookUrl: this.o.webhookUrl,
        }),
      );
      const record = toRecord(created.call, wave, this.personByPhone, created.idempotencyKey);
      this.o.ledger.append({ type: "call.created", at: this.now(), call: record, taskPreview: created.task.slice(0, 800) });
      this.o.log(`Wave ${wave.index} (attempt ${wave.attempt}): CALL-E task ${created.call.id} for ${person.name} ${maskPhone(person.phone)} (${person.locale}).`);
      return { callId: created.call.id, wave, person, idempotencyKey: created.idempotencyKey };
    } catch (err) {
      this.failPlacement(wave, person, err);
      return null;
    }
  }

  private async createWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;
        if (!isDefinitelyNotDialled(err) || attempt > this.o.createRetries) {
          throw err;
        }
        const delay = this.o.createRetryBaseMs * 2 ** (attempt - 1);
        this.o.ledger.note("warning", `CALL-E rate-limited ${label} (${maskPhonesInText(errorText(err))}); retry ${attempt}/${this.o.createRetries} in ${delay} ms`);
        await sleep(delay);
      }
    }
  }

  /**
   * The submission failed. Which of the two things that means decides what we may write down.
   *
   * CALL-E refusing the task outright (a validation error) is a fact: nobody was dialled, and
   * `not_attempted` says so. A connection that dropped, or a 5xx, is not a fact about the enrollee
   * or about the telephone - the call may be ringing right now. Recording `not_attempted` there
   * would be the system asserting something it does not know, which is the exact failure this app
   * exists to avoid, so it records `dial_unknown` and sends it to a human to reconcile.
   */
  private failPlacement(wave: Wave, person: Enrollee, err: unknown): void {
    const message = maskPhonesInText(errorText(err));
    const ambiguous = submissionAmbiguous(err);
    const outcome: Outcome = ambiguous ? "dial_unknown" : "not_attempted";
    const key = screeningIdempotencyKey(this.o.campaign.id, person.id, wave.attempt);
    this.o.ledger.append({ type: "wave.failed", at: this.now(), wave: { ...wave, personIds: [person.id] }, personIds: [person.id], error: message });
    this.o.log(
      ambiguous
        ? `The request to CALL-E for ${person.name} failed without saying whether the call went out: ${message}. Marked dial unknown; reconcile idempotency key ${key} in CALL-E before redialling.`
        : `CALL-E did not accept the call to ${person.name}: ${message}. Marked not attempted.`,
    );
    this.o.ledger.append({
      type: "person.classified",
      at: this.now(),
      personId: person.id,
      callId: "none",
      classification: {
        outcome,
        reasons: ambiguous
          ? [`submission failed with an ambiguous error, so it is unknown whether a call was placed: ${message.slice(0, 120)}`, `reconcile idempotency key ${key} against CALL-E`]
          : [`call task not accepted: ${message.slice(0, 140)}`],
        exemptions: [],
        correctionNeeded: false,
        agentSaid: null,
      },
      result: null,
      summary: null,
      evidence: [],
    });
    const action = nextAction(outcome, this.states.get(person.id)?.attempts ?? 0, this.o.policy);
    this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt: null });
  }

  /** Waits for one call and classifies the person. Returns [id] when they should be redialled. */
  private async settle(placement: Placement): Promise<string[]> {
    const { callId, wave, person, idempotencyKey } = placement;
    let terminal: Call;
    try {
      terminal = await this.waitForTerminal(callId);
    } catch (err) {
      const reason = err instanceof CalleTimeoutError ? "timed out waiting for the result" : maskPhonesInText(errorText(err));
      this.o.ledger.append({ type: "call.pending", at: this.now(), callId, personIds: [person.id], reason });
      this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action: { type: "await-result", reason: `call ${callId} ${reason}` }, dueAt: null });
      this.o.log(`Call ${callId} for ${person.name} is still pending (${reason}). Run resume later.`);
      return [];
    }
    this.o.ledger.append({ type: "call.terminal", at: this.now(), call: toRecord(terminal, wave, this.personByPhone, idempotencyKey), summary: terminal.summary ? maskPhonesInText(terminal.summary) : null, evidence: terminal.evidence.map(maskPhonesInText) });
    const recipient = terminal.recipients.find((r) => r.phones[0] === person.phone);
    const classification = recipient
      ? classifyScreening({ recipient, confidenceLabel: terminal.completionConfidence?.label ?? null, hoursPerMonth: this.o.rules.requirement.hours_per_month })
      : { outcome: "unreachable" as const, reasons: ["recipient missing from the CALL-E response"], exemptions: [], correctionNeeded: false, agentSaid: null };
    // Masked here, at the one place a result enters the ledger, so the dashboard, the report and
    // every export downstream read the masked copy rather than each having to remember.
    const result = recipient && isScreeningResult(recipient.structuredResult) ? maskResultText(recipient.structuredResult) : null;
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
    const attempts = this.states.get(person.id)?.attempts ?? wave.attempt;
    const action = nextAction(classification.outcome, attempts, this.o.policy);
    const dueAt = action.delayMinutes !== undefined && action.delayMinutes > 0 ? new Date(Date.now() + action.delayMinutes * 60000).toISOString() : null;
    this.o.ledger.append({ type: "person.action", at: this.now(), personId: person.id, action, dueAt });
    const labels = classification.exemptions.map((c) => exemptionLabel(this.o.rules, c));
    this.o.log(`  ${person.name}: ${classification.outcome.toUpperCase().replace(/_/g, " ")}${labels.length > 0 ? ` [${labels.join("; ")}]` : ""} -> ${action.type}${classification.correctionNeeded ? " + CORRECTION CALL" : ""}`);
    return action.type === "retry" ? [person.id] : [];
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
          // Reading a call places nothing, so both kinds of transient trouble are safe to re-read.
          if (!(isDefinitelyNotDialled(err) || submissionAmbiguous(err)) || consecutiveErrors > 5) {
            throw err;
          }
          await sleep(this.o.pollIntervalMs);
          continue;
        }
        cursor = await this.streamEvents(callId, cursor);
        if (TERMINAL.has(call.status)) {
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

  // ---------------------------------------------------------------- worklist

  /** Turns outcomes into worklist items. One item per person and kind; safe to run again. */
  private createWorkItems(only: Set<string> | null): void {
    const { rules } = this.o;
    for (const state of this.states.values()) {
      if (only !== null && !only.has(state.personId)) {
        continue;
      }
      const person = this.personById.get(state.personId);
      if (!person) {
        continue;
      }
      const checkMonth = formatMonth(person.checkDate);
      const pref = state.preferredCallback;
      const navigatorOrLetter = (highPriority: boolean, why: string): void => {
        if (state.wantsNavigator === "no") {
          this.addWork(person, "mail_letter", `${person.name}: ${why}; declined a navigator call, so send the plain-language letter with the navigator line.`, rules.requirement.checklist_at_risk, { highPriority });
        } else {
          this.addWork(person, "navigator_callback", `${person.name}: ${why}. Navigator call${pref ? ` (${pref})` : ""} before ${checkMonth}.`, rules.requirement.checklist_at_risk, { highPriority, preferredCallback: pref });
        }
      };
      switch (state.outcome) {
        case "likely_exempt": {
          const labels = state.exemptions.map((c) => exemptionLabel(rules, c)).join("; ");
          this.addWork(person, "exemption_packet", `${person.name}: may qualify for an exemption (${labels}). A caseworker reviews before anything is recorded.`, checklistFor(rules, state.exemptions), { needsHumanReview: true });
          if (state.wantsNavigator === "yes") {
            this.addWork(person, "navigator_callback", `${person.name}: asked for help with the exemption paperwork${pref ? ` (${pref})` : ""}.`, checklistFor(rules, state.exemptions), { preferredCallback: pref });
          }
          break;
        }
        case "likely_meets":
          this.addWork(person, "report_hours", `${person.name}: may already meet the requirement; remind them to report before ${checkMonth}.`, rules.requirement.checklist_meets, {});
          if (state.wantsNavigator === "yes") {
            this.addWork(person, "navigator_callback", `${person.name}: asked for help reporting their hours${pref ? ` (${pref})` : ""}.`, rules.requirement.checklist_meets, { preferredCallback: pref });
          }
          break;
        case "at_risk":
          navigatorOrLetter(true, "no exemption found and below the requirement");
          break;
        case "needs_review":
          navigatorOrLetter(false, "answers need a navigator's review");
          break;
        case "opted_out":
          this.addWork(person, "suppression", `${person.name}: asked not to be called again. Mail only from now on.`, [], {});
          break;
        case "identity_unconfirmed":
        case "unreachable":
        case "unverified":
        case "declined":
          if (state.nextAction?.type === "mail") {
            this.addWork(person, "mail_letter", `${person.name}: not screened by phone (${state.reasons[0] ?? state.outcome}). Send the plain-language letter in ${person.locale} and add to community outreach before ${checkMonth}.`, rules.requirement.checklist_at_risk, { highPriority: true });
          }
          break;
        case "not_attempted":
          this.addWork(person, "operator_review", `${person.name}: CALL-E did not accept the call task; resume the campaign or call by hand.`, [], {});
          break;
        case "dial_unknown":
          this.addWork(
            person,
            "operator_review",
            `${person.name}: the request to CALL-E failed without saying whether the call went out. Check CALL-E for this attempt before anyone dials again.`,
            ["Look the attempt up in CALL-E by its idempotency key", "If a call exists, resume the campaign so its result is settled", "If no call exists, redial by hand or re-run the campaign"],
            { highPriority: true, needsHumanReview: true },
          );
          break;
        case "cleared_by_data":
        case null:
          break;
        default: {
          const exhaustive: never = state.outcome;
          throw new Error(`unhandled outcome ${String(exhaustive)}`);
        }
      }
      if (state.correctionNeeded) {
        this.addWork(person, "correction_call", `${person.name}: the automated call said more than the answers support. A person calls back to correct the message before ${checkMonth}.`, [], { highPriority: true, needsHumanReview: true });
      }
    }
  }

  private addWork(person: Enrollee, kind: WorkKind, summary: string, checklist: string[], opts: { highPriority?: boolean; needsHumanReview?: boolean; preferredCallback?: string | null }): void {
    const exists = [...this.o.ledger.projection.work.values()].some((w) => w.personId === person.id && w.kind === kind);
    if (exists) {
      return;
    }
    const item: WorkItem = {
      id: `wk_${randomBytes(4).toString("hex")}`,
      personId: person.id,
      kind,
      summary,
      checklist,
      preferredCallback: opts.preferredCallback ?? null,
      checkDate: person.checkDate,
      highPriority: opts.highPriority ?? false,
      needsHumanReview: opts.needsHumanReview ?? false,
      reviewedAt: null,
      createdAt: this.now(),
    };
    this.o.ledger.append({ type: "work.created", at: this.now(), item });
  }

  // ---------------------------------------------------------------- summary

  private finish(): RunSummary {
    const s = this.summary();
    const o = s.outcomes;
    this.o.log(
      `Campaign ${s.pending > 0 ? "paused" : "complete"}: likely exempt ${o.likely_exempt}, likely meets ${o.likely_meets}, at risk ${o.at_risk}, needs review ${o.needs_review}, cleared by data ${o.cleared_by_data}, not reached ${o.unreachable + o.identity_unconfirmed + o.unverified}. Had not heard of the rule: ${s.awareNo} of ${s.awareYes + s.awareNo}. Calls: ${s.calls}. Worklist: ${s.workItems}${s.corrections > 0 ? ` (${s.corrections} correction call${s.corrections === 1 ? "" : "s"})` : ""}.${s.pending > 0 ? ` ${s.pending} call(s) still pending; run resume.` : ""}${o.dial_unknown > 0 ? ` ${o.dial_unknown} submission(s) failed ambiguously and need reconciling with CALL-E.` : ""}`,
    );
    return s;
  }

  summary(): RunSummary {
    const outcomes: Record<Outcome | "pending", number> = {
      cleared_by_data: 0,
      likely_exempt: 0,
      likely_meets: 0,
      at_risk: 0,
      needs_review: 0,
      declined: 0,
      opted_out: 0,
      identity_unconfirmed: 0,
      unreachable: 0,
      unverified: 0,
      dial_unknown: 0,
      not_attempted: 0,
      pending: 0,
    };
    let awareYes = 0;
    let awareNo = 0;
    for (const state of this.states.values()) {
      outcomes[state.outcome ?? "pending"] += 1;
      if (state.awareBefore === "yes") {
        awareYes += 1;
      } else if (state.awareBefore === "no") {
        awareNo += 1;
      }
    }
    const projection = this.o.ledger.projection;
    const calls = [...projection.calls.values()];
    const work = [...projection.work.values()];
    return {
      campaignId: this.o.campaign.id,
      outcomes,
      calls: calls.length,
      workItems: work.length,
      corrections: work.filter((w) => w.kind === "correction_call").length,
      notAttempted: outcomes.not_attempted,
      dialUnknown: outcomes.dial_unknown,
      pending: calls.filter((c) => !TERMINAL.has(c.status)).length,
      awareYes,
      awareNo,
    };
  }
}
