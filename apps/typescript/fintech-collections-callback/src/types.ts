// Domain types for the fintech collections callback app.

/** A single overdue account that may be contacted by phone. */
export interface OverdueAccount {
  accountId: string;
  customerName: string;
  /** E.164 phone number, e.g. "+12025550143". */
  phone: string;
  /** ISO 3166-1 alpha-2 region for the recipient, e.g. "US", "GH". */
  region: string;
  /** IANA timezone identifier, e.g. "America/New_York". Never inferred from the phone. */
  timezone: string;
  amountDueCents: number;
  /** ISO 4217 currency code, e.g. "USD", "GHS". */
  currency: string;
  /** ISO date the payment was due, e.g. "2026-07-15". */
  dueDate: string;
  daysPastDue: number;
  /** Explicit, recorded consent to be contacted by phone about this debt. */
  consentToContact: boolean;
  /** When consent was captured (ISO datetime). Required when consentToContact is true. */
  consentTimestamp?: string;
  /** BCP-47 locale for the spoken call, e.g. "en-US". Defaults to "en-US". */
  language?: string;
}

/** Result of running the pre-dial gate for one account. */
export type GateDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Normalized structured outcome CALL-E returns for a single account. */
export interface CollectionsResult {
  outcome:
    | "promise-to-pay"
    | "dispute"
    | "callback-requested"
    | "wrong-number"
    | "no-answer"
    | "refused"
    | "unknown";
  /** ISO date the customer promised to pay, if any. */
  promiseToPayDate?: string;
  /** ISO datetime the customer asked to be called back, if any. */
  callbackAt?: string;
  notes?: string;
}

/** One row in the run report. */
export interface CallOutcome {
  accountId: string;
  phone: string;
  mode: "dry-run" | "live";
  placed: boolean;
  blockedReason?: string;
  callId?: string;
  status?: string;
  taskCompleted?: boolean;
  confidence?: number;
  structured?: CollectionsResult;
  error?: string;
  at: string;
}
