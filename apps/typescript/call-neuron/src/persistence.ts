import type { Disposition, Recipient } from "./campaign";
import type { CallRun, OfferBrief, ReviewedPlan } from "./live";

const DATABASE = "call-neuron-local";
const STORE = "drafts";
const DRAFT_KEY = "current";
const DISPATCH_PREFIX = "dispatch:";
const CHANNEL = "call-neuron-local-updates";

export type LocalDraft = {
  sourceName: string;
  recipients: Recipient[];
  offer: OfferBrief;
  dispositions: Record<string, Disposition>;
  savedAt: string;
};

type PersistedDraft = LocalDraft & { version: 2 };

export type DispatchPhase = "planning" | "planned" | "dispatching" | "acceptance_unknown" | "accepted";

export type DispatchAttempt = {
  version: 1;
  kind: "dispatch_attempt";
  reservationId: string;
  recipientId: string;
  recipientKey: string;
  contentBinding: string;
  phase: DispatchPhase;
  reservedAt: string;
  updatedAt: string;
  planId?: string;
  planExpiresAt?: string;
  runId?: string;
  providerStatus?: string;
  attemptedAt?: string;
};

export type DispatchFingerprint = Pick<DispatchAttempt, "recipientKey" | "contentBinding">;

export class DispatchBlockedError extends Error {
  attempt: DispatchAttempt | null;

  constructor(message: string, attempt: DispatchAttempt | null = null) {
    super(message);
    this.name = "DispatchBlockedError";
    this.attempt = attempt;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validOffer(value: unknown): value is OfferBrief {
  return isObject(value) && ["organization", "offer", "details", "callbackPhone", "escalation"].every((key) => typeof value[key] === "string");
}

function validRecipient(value: unknown): value is Recipient {
  if (!isObject(value)) return false;
  const strings = ["id", "studentName", "studentCode", "recipientName", "phone", "employeeCode", "consentSource", "consentTimestamp"];
  return strings.every((key) => typeof value[key] === "string" && value[key])
    && ["guardian", "adult_student"].includes(String(value.recipientType))
    && ["eligible", "blocked"].includes(String(value.status));
}

function validDraft(value: unknown): value is PersistedDraft {
  if (!isObject(value) || value.version !== 2 || typeof value.sourceName !== "string" || typeof value.savedAt !== "string") return false;
  if (!Array.isArray(value.recipients) || !value.recipients.every(validRecipient) || !validOffer(value.offer) || !isObject(value.dispositions)) return false;
  const validDispositions = new Set<Disposition>(["unreviewed", "interested", "needs_information", "not_interested", "opted_out", "unreachable"]);
  return Object.values(value.dispositions).every((item) => typeof item === "string" && validDispositions.has(item as Disposition));
}

function validAttempt(value: unknown): value is DispatchAttempt {
  if (!isObject(value) || value.version !== 1 || value.kind !== "dispatch_attempt") return false;
  const strings = ["reservationId", "recipientId", "recipientKey", "contentBinding", "phase", "reservedAt", "updatedAt"];
  if (!strings.every((key) => typeof value[key] === "string" && value[key])) return false;
  if (!["planning", "planned", "dispatching", "acceptance_unknown", "accepted"].includes(String(value.phase))) return false;
  if (["planned", "dispatching", "acceptance_unknown", "accepted"].includes(String(value.phase)) && (typeof value.planId !== "string" || !value.planId)) return false;
  if (value.phase === "accepted" && (typeof value.runId !== "string" || !value.runId || typeof value.providerStatus !== "string" || !value.providerStatus || typeof value.attemptedAt !== "string" || !value.attemptedAt)) return false;
  return ["planId", "planExpiresAt", "runId", "providerStatus", "attemptedAt"].every((key) => value[key] === undefined || typeof value[key] === "string");
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The local campaign store could not be opened."));
  });
}

function announceChange() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("changed");
  channel.close();
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digest(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  return hex(await crypto.subtle.digest("SHA-256", encoded));
}

export function fingerprintRecipient(recipient: Recipient) {
  return digest({
    phone: recipient.phone,
    studentCode: recipient.studentCode.trim().toLowerCase(),
    employeeCode: recipient.employeeCode.trim().toLowerCase(),
  });
}

export async function fingerprintDispatch(recipient: Recipient, offer: OfferBrief, voicemail: boolean): Promise<DispatchFingerprint> {
  const recipientKey = await fingerprintRecipient(recipient);
  const contentBinding = await digest({
    recipientKey,
    recipientName: recipient.recipientName,
    recipientType: recipient.recipientType,
    organization: offer.organization,
    offer: offer.offer,
    details: offer.details,
    callbackPhone: offer.callbackPhone,
    escalation: offer.escalation,
    voicemail,
  });
  return { recipientKey, contentBinding };
}

function attemptKey(recipientKey: string) {
  return `${DISPATCH_PREFIX}${recipientKey}`;
}

function blockedMessage(attempt: DispatchAttempt | null) {
  if (!attempt) return "A local dispatch record exists but could not be verified. CallNeuron is blocking this recipient to avoid a duplicate call.";
  if (attempt.phase === "accepted") return "CALL-E already accepted a call for this recipient. Refresh that same run instead of creating another plan.";
  if (attempt.phase === "dispatching" || attempt.phase === "acceptance_unknown") return "A previous run_call may have been accepted. CallNeuron is blocking this recipient because retrying could create a duplicate call.";
  return "Another tab or an earlier session already reserved a no-call plan for this recipient. Review or discard that reservation before planning again.";
}

export async function reserveDispatch(recipient: Recipient, offer: OfferBrief, voicemail: boolean) {
  const fingerprint = await fingerprintDispatch(recipient, offer, voicemail);
  const database = await openDatabase();
  try {
    const result = await new Promise<{ created: boolean; attempt: DispatchAttempt | null; optedOut?: boolean; invalidCampaign?: boolean }>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const attemptRequest = store.get(attemptKey(fingerprint.recipientKey));
      const draftRequest = store.get(DRAFT_KEY);
      let attemptLoaded = false;
      let draftLoaded = false;
      let result: { created: boolean; attempt: DispatchAttempt | null; optedOut?: boolean; invalidCampaign?: boolean } | null = null;
      const decide = () => {
        if (!attemptLoaded || !draftLoaded || result) return;
        if (attemptRequest.result !== undefined) {
          result = { created: false, attempt: validAttempt(attemptRequest.result) ? attemptRequest.result : null };
          return;
        }
        const draft = validDraft(draftRequest.result) ? draftRequest.result : null;
        const draftRecipient = draft?.recipients.find((item) => item.id === recipient.id);
        if (!draft || draftRecipient?.status !== "eligible") {
          result = { created: false, attempt: null, invalidCampaign: true };
          return;
        }
        if (draft?.dispositions[recipient.id] === "opted_out") {
          result = { created: false, attempt: null, optedOut: true };
          return;
        }
        const now = new Date().toISOString();
        const attempt: DispatchAttempt = {
          version: 1,
          kind: "dispatch_attempt",
          reservationId: crypto.randomUUID(),
          recipientId: recipient.id,
          ...fingerprint,
          phase: "planning",
          reservedAt: now,
          updatedAt: now,
        };
        store.put(attempt, attemptKey(fingerprint.recipientKey));
        result = { created: true, attempt };
      };
      attemptRequest.onsuccess = () => { attemptLoaded = true; decide(); };
      draftRequest.onsuccess = () => { draftLoaded = true; decide(); };
      transaction.oncomplete = () => resolve(result || { created: false, attempt: null });
      transaction.onerror = () => reject(new Error("The durable dispatch reservation could not be saved. No CALL-E plan was created."));
      transaction.onabort = () => reject(new Error("The durable dispatch reservation was interrupted. No CALL-E plan was created."));
    });
    if (result.invalidCampaign) throw new DispatchBlockedError("The selected recipient is not eligible in the durable campaign draft. Save the campaign before planning.");
    if (result.optedOut) throw new DispatchBlockedError("This recipient is opted out in the durable campaign record and cannot enter CALL-E planning.");
    if (!result.created || !result.attempt) throw new DispatchBlockedError(blockedMessage(result.attempt), result.attempt);
    announceChange();
    return result.attempt;
  } finally {
    database.close();
  }
}

async function transitionAttempt(
  attempt: DispatchAttempt,
  allowedPhases: DispatchPhase[],
  update: (current: DispatchAttempt) => DispatchAttempt,
  errorMessage: string,
  failIfOptedOut = false,
) {
  const database = await openDatabase();
  try {
    const result = await new Promise<DispatchAttempt>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(attemptKey(attempt.recipientKey));
      const draftRequest = failIfOptedOut ? store.get(DRAFT_KEY) : null;
      let next: DispatchAttempt | null = null;
      let blocked: DispatchBlockedError | null = null;
      let attemptLoaded = false;
      let draftLoaded = !draftRequest;
      const decide = () => {
        if (!attemptLoaded || !draftLoaded || next || blocked) return;
        const current = validAttempt(request.result) ? request.result : null;
        if (!current || current.reservationId !== attempt.reservationId || current.contentBinding !== attempt.contentBinding || !allowedPhases.includes(current.phase)) {
          blocked = new DispatchBlockedError(blockedMessage(current), current);
          return;
        }
        const draft = draftRequest && validDraft(draftRequest.result) ? draftRequest.result : null;
        const draftRecipient = draft?.recipients.find((item) => item.id === current.recipientId);
        if (failIfOptedOut && (!draft || draftRecipient?.status !== "eligible")) {
          blocked = new DispatchBlockedError("The durable campaign changed or was deleted after planning. This unstarted plan cannot be dispatched.", current);
          return;
        }
        if (draft?.dispositions[current.recipientId] === "opted_out") {
          blocked = new DispatchBlockedError("This recipient was opted out before dispatch. The reviewed plan remains unstarted and cannot be run.", current);
          return;
        }
        next = update(current);
        store.put(next, attemptKey(current.recipientKey));
      };
      request.onsuccess = () => { attemptLoaded = true; decide(); };
      if (draftRequest) draftRequest.onsuccess = () => { draftLoaded = true; decide(); };
      transaction.oncomplete = () => blocked ? reject(blocked) : next ? resolve(next) : reject(new Error(errorMessage));
      transaction.onerror = () => reject(new Error(errorMessage));
      transaction.onabort = () => reject(new Error(errorMessage));
    });
    announceChange();
    return result;
  } finally {
    database.close();
  }
}

export function recordReviewedPlan(attempt: DispatchAttempt, plan: ReviewedPlan) {
  return transitionAttempt(attempt, ["planning"], (current) => ({
    ...current,
    phase: "planned",
    planId: plan.planId,
    planExpiresAt: plan.expiresAt,
    updatedAt: new Date().toISOString(),
  }), "The reviewed plan could not be bound to its durable reservation. No call was started.");
}

export function beginDispatch(attempt: DispatchAttempt) {
  return transitionAttempt(attempt, ["planned"], (current) => ({
    ...current,
    phase: "dispatching",
    updatedAt: new Date().toISOString(),
  }), "The dispatch gate could not be persisted. No call was started.", true);
}

export function markAcceptanceUnknown(attempt: DispatchAttempt) {
  return transitionAttempt(attempt, ["dispatching"], (current) => ({
    ...current,
    phase: "acceptance_unknown",
    updatedAt: new Date().toISOString(),
  }), "The ambiguous dispatch remains blocked by its pre-call reservation.");
}

export function recordAcceptedRun(attempt: DispatchAttempt, run: CallRun) {
  return transitionAttempt(attempt, ["dispatching"], (current) => ({
    ...current,
    phase: "accepted",
    runId: run.runId,
    providerStatus: run.status,
    attemptedAt: run.attemptedAt,
    updatedAt: new Date().toISOString(),
  }), "CALL-E returned a run, but its accepted run ID could not be persisted. The pre-call reservation remains blocked.");
}

export function recordRunStatus(attempt: DispatchAttempt, run: CallRun) {
  if (attempt.runId !== run.runId) throw new DispatchBlockedError("The returned CALL-E run does not match the durable accepted run ID.", attempt);
  return transitionAttempt(attempt, ["accepted"], (current) => ({
    ...current,
    providerStatus: run.status,
    attemptedAt: run.attemptedAt,
    updatedAt: new Date().toISOString(),
  }), "The latest CALL-E status could not be persisted; the accepted run ID remains blocked from retry.");
}

export async function abandonUnstartedDispatch(attempt: DispatchAttempt) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const request = store.get(attemptKey(attempt.recipientKey));
      let blocked: DispatchBlockedError | null = null;
      request.onsuccess = () => {
        const current = validAttempt(request.result) ? request.result : null;
        if (!current || current.reservationId !== attempt.reservationId || !["planning", "planned"].includes(current.phase)) {
          blocked = new DispatchBlockedError(blockedMessage(current), current);
          return;
        }
        store.delete(attemptKey(current.recipientKey));
      };
      transaction.oncomplete = () => blocked ? reject(blocked) : resolve();
      transaction.onerror = () => reject(new Error("The unstarted reservation could not be discarded."));
      transaction.onabort = () => reject(new Error("The unstarted reservation could not be discarded."));
    });
    announceChange();
  } finally {
    database.close();
  }
}

export async function loadDispatchAttempts() {
  const database = await openDatabase();
  try {
    return await new Promise<DispatchAttempt[]>((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.filter(validAttempt));
      request.onerror = () => reject(new Error("Durable dispatch records could not be read. Live planning is disabled."));
    });
  } finally {
    database.close();
  }
}

export async function matchDispatchAttempts(recipients: Recipient[], attempts: DispatchAttempt[]) {
  const matches = await Promise.all(recipients.map(async (recipient) => {
    const recipientKey = await fingerprintRecipient(recipient);
    return [recipient.id, attempts.find((attempt) => attempt.recipientKey === recipientKey)] as const;
  }));
  return Object.fromEntries(matches.filter((match): match is readonly [string, DispatchAttempt] => Boolean(match[1])));
}

export function runFromAcceptedAttempt(attempt: DispatchAttempt): CallRun | null {
  if (attempt.phase !== "accepted" || !attempt.runId || !attempt.providerStatus || !attempt.attemptedAt) return null;
  return {
    runId: attempt.runId,
    status: attempt.providerStatus,
    summary: "Restored durable CALL-E run. Reconnect to refresh this same run; CallNeuron will not create another plan.",
    transcript: "",
    attemptedAt: attempt.attemptedAt,
  };
}

export async function saveLocalDraft(draft: LocalDraft) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ ...draft, version: 2 } satisfies PersistedDraft, DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("The local campaign draft could not be saved."));
    });
    announceChange();
  } finally {
    database.close();
  }
}

export async function loadLocalDraft() {
  const database = await openDatabase();
  try {
    return await new Promise<LocalDraft | null>((resolve, reject) => {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(DRAFT_KEY);
      request.onsuccess = () => resolve(validDraft(request.result) ? request.result : null);
      request.onerror = () => reject(new Error("The local campaign draft could not be read."));
    });
  } finally {
    database.close();
  }
}

export async function clearLocalDraft() {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(DRAFT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("The local campaign draft could not be cleared."));
    });
    announceChange();
  } finally {
    database.close();
  }
}

export function subscribeLocalPersistence(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
  if (channel) channel.onmessage = onChange;
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  return () => {
    channel?.close();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
