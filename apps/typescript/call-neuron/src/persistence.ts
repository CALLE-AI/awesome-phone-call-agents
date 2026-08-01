import type { Disposition, Recipient } from "./campaign";
import type { OfferBrief } from "./live";

const DATABASE = "call-neuron-local";
const STORE = "drafts";
const DRAFT_KEY = "current";

export type LocalDraft = {
  sourceName: string;
  recipients: Recipient[];
  offer: OfferBrief;
  dispositions: Record<string, Disposition>;
  savedAt: string;
};

type PersistedDraft = LocalDraft & { version: 2 };

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

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The local campaign store could not be opened."));
  });
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
  } finally {
    database.close();
  }
}
