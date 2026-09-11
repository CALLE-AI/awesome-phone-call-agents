import {
  createGateway,
  FixtureCalleGateway,
  LiveCalleGateway,
  NullCalleGateway,
  type CalleGateway,
} from "./calle/index.js";
import { randomUUID } from "node:crypto";
import { loadConfig, type ClaimLineConfig } from "./config.js";
import { languageFor } from "./domain/language.js";
import { assertE164, maskPhone } from "./domain/phone.js";
import type {
  CallIntent,
  CallResultRecord,
  CallType,
  Claim,
  ClaimContact,
  ClaimDecision,
  ClaimDecisionType,
  ContactRole,
  Customer,
  HumanDecision,
  Payment,
  Policy,
  PolicyStatus,
  PolicyType,
} from "./domain/types.js";
import { createNotifier, type Notifier, type NotifyResult } from "./notify/index.js";
import { createPaymentGateway, type PaymentGateway } from "./payments/index.js";
import { Dispatcher } from "./services/dispatcher.js";
import { assessFraud, type FraudAssessment } from "./services/fraud.js";
import { Reconciler } from "./services/reconciler.js";
import { buildCaseReport, type CaseReport } from "./services/report.js";
import { roleToCallType } from "./services/tasks.js";
import { Store } from "./store/store.js";

export interface IntentView {
  intent: CallIntent;
  result: CallResultRecord | null;
  decision: HumanDecision | null;
}

export interface ClaimView {
  claim: Claim;
  intents: IntentView[];
}

/**
 * PII-minimized shapes for output over the JSON API and MCP. Full E.164 numbers
 * stay in the access-controlled store; external callers only ever see the
 * masked form.
 */
export type PublicClaim = Omit<Claim, "claimantPhone" | "providerPhone"> & {
  claimantPhone: string;
  providerPhone: string | null;
};

export type PublicIntent = Omit<CallIntent, "destinationPhone"> & {
  destinationPhone: string;
};

export interface PublicIntentView {
  intent: PublicIntent;
  result: CallResultRecord | null;
  decision: HumanDecision | null;
}

export interface PublicClaimView {
  claim: PublicClaim;
  intents: PublicIntentView[];
}

export function maskClaim(claim: Claim): PublicClaim {
  return {
    ...claim,
    claimantPhone: maskPhone(claim.claimantPhone),
    providerPhone: claim.providerPhone ? maskPhone(claim.providerPhone) : null,
  };
}

export function maskIntent(intent: CallIntent): PublicIntent {
  return { ...intent, destinationPhone: maskPhone(intent.destinationPhone) };
}

export function toPublicClaimView(view: ClaimView): PublicClaimView {
  return {
    claim: maskClaim(view.claim),
    intents: view.intents.map((iv) => ({
      intent: maskIntent(iv.intent),
      result: iv.result,
      decision: iv.decision,
    })),
  };
}

/** Masked contact for output over the API / MCP / dashboard. */
export type PublicClaimContact = Omit<ClaimContact, "phone"> & { phone: string };

export function maskContact(contact: ClaimContact): PublicClaimContact {
  return { ...contact, phone: maskPhone(contact.phone) };
}

/** Masked customer for output. */
export type PublicCustomer = Omit<Customer, "phone"> & { phone: string };

export function maskCustomer(customer: Customer): PublicCustomer {
  return { ...customer, phone: maskPhone(customer.phone) };
}

/** A customer with their policies and a claim summary, for the customer page. */
export interface CustomerView {
  customer: PublicCustomer;
  policies: Policy[];
  claims: PublicClaim[];
}

/** One contact plus its most recent call, for the aggregated case view. */
export interface ContactCallView {
  contact: PublicClaimContact;
  defaultCallType: CallType;
  intent: PublicIntent | null;
  result: CallResultRecord | null;
  decision: HumanDecision | null;
}

export interface CaseTotals {
  billedTotal: number | null;
  currency: string | null;
  /** True if any bill call is unknown/unreached, so the total is incomplete. */
  incomplete: boolean;
}

/** The aggregated claim ("case"): all associated contacts, calls, and totals. */
export interface CaseView {
  claim: PublicClaim;
  contacts: ContactCallView[];
  /** Claim-level calls not tied to a specific contact (legacy path). */
  otherCalls: PublicIntentView[];
  totals: CaseTotals;
  claimDecision: ClaimDecision | null;
}

export interface DecisionInput {
  decidedBy: string;
  decision: string;
  note?: string | null;
}

export interface SanctionInput {
  decidedBy: string;
  decision: ClaimDecisionType;
  sanctionedAmount?: number | null;
  currency?: string | null;
  note?: string | null;
}

export interface ContactInput {
  role: ContactRole;
  name: string;
  phone: string;
  /** Optional per-contact language override (en/hi/es). */
  language?: string | null;
  note?: string | null;
}

export interface CreateClaimInput {
  reference?: string;
  customerId?: string | null;
  policyId?: string | null;
  policyholderName: string;
  claimantPhone: string;
  incidentType: string;
  /** Preferred call language (en/hi/es). Sets region + locale for the calls. */
  language?: string | null;
  region?: string;
  locale?: string;
  providerName?: string | null;
  providerPhone?: string | null;
  notes?: string | null;
  /** Extra associated contacts to call (doctor, hospital billing, ...). */
  contacts?: ContactInput[];
}

/**
 * Wires the ClaimLine services together and exposes the operations the server
 * and CLI share. Owns the human-decision step (never auto-applied) and the
 * read models used by the dashboard.
 */
export class ClaimLineApp {
  readonly config: ClaimLineConfig;
  readonly store: Store;
  readonly gateway: CalleGateway;
  readonly dispatcher: Dispatcher;
  readonly reconciler: Reconciler;
  readonly payments: PaymentGateway;
  readonly notifier: Notifier;
  /** Shared fixture gateway (stateful) reused for all fixture-mode calls. */
  private readonly fixtureGateway: FixtureCalleGateway;

  constructor(options?: {
    config?: ClaimLineConfig;
    store?: Store;
    gateway?: CalleGateway;
    payments?: PaymentGateway;
    notifier?: Notifier;
  }) {
    this.config = options?.config ?? loadConfig();
    this.store = options?.store ?? Store.open(this.config.dbPath);
    this.gateway = options?.gateway ?? createGateway(this.config);
    this.fixtureGateway =
      this.gateway instanceof FixtureCalleGateway
        ? this.gateway
        : new FixtureCalleGateway();
    this.dispatcher = new Dispatcher(this.store, this.gateway, this.config);
    this.reconciler = new Reconciler(
      this.store,
      this.gateway,
      this.dispatcher,
      this.config,
    );
    this.payments = options?.payments ?? createPaymentGateway(this.config);
    this.notifier = options?.notifier ?? createNotifier(this.config);
  }

  /**
   * Resolve the gateway for a specific actor's API key. Fixture mode always
   * uses the shared stateful fixture gateway; live mode builds a per-key live
   * gateway (owner's server key or a guest's own key).
   */
  gatewayForKey(apiKey: string | null): CalleGateway {
    if (this.config.mode === "fixture") return this.fixtureGateway;
    if (apiKey) {
      return new LiveCalleGateway({ apiKey, baseUrl: this.config.calleBaseUrl });
    }
    return new NullCalleGateway();
  }

  /** A dispatcher bound to a specific actor's key (for placing calls). */
  dispatcherFor(apiKey: string | null): Dispatcher {
    if (this.config.mode === "fixture") return this.dispatcher;
    return new Dispatcher(this.store, this.gatewayForKey(apiKey), this.config);
  }

  /** A reconciler bound to a specific actor's key (for polling their calls). */
  reconcilerFor(apiKey: string | null): Reconciler {
    if (this.config.mode === "fixture") return this.reconciler;
    const gateway = this.gatewayForKey(apiKey);
    const dispatcher = new Dispatcher(this.store, gateway, this.config);
    return new Reconciler(this.store, gateway, dispatcher, this.config);
  }

  createClaim(input: CreateClaimInput): Claim {
    const claimantPhone = assertE164(input.claimantPhone, "claimant phone");
    const providerPhone =
      input.providerPhone && input.providerPhone.trim().length > 0
        ? assertE164(input.providerPhone, "provider phone")
        : null;
    // Language drives the CALL-E region + locale unless explicitly overridden.
    const lang = languageFor(input.language);
    const region = input.region ?? lang.region;
    const locale = input.locale ?? lang.locale;
    const reference = input.reference?.trim() || this.nextClaimReference();

    const claim = this.store.createClaim({
      reference,
      customerId: input.customerId ?? null,
      policyId: input.policyId ?? null,
      policyholderName: input.policyholderName,
      claimantPhone,
      incidentType: input.incidentType,
      region,
      locale,
      language: lang.code,
      providerName: input.providerName ?? null,
      providerPhone,
      notes: input.notes ?? null,
    });

    // Auto-create the standard contacts so the claim is immediately callable.
    this.store.createContact({
      claimId: claim.id,
      role: "claimant",
      name: claim.policyholderName,
      phone: claimantPhone,
      note: "Policyholder",
    });
    if (input.providerName && providerPhone) {
      this.store.createContact({
        claimId: claim.id,
        role: "repair_shop",
        name: input.providerName,
        phone: providerPhone,
        note: "Provider",
      });
    }
    for (const c of input.contacts ?? []) {
      this.addContact(claim.id, c);
    }
    return claim;
  }

  /** Generate the next CLM-#### reference. */
  private nextClaimReference(): string {
    const n = this.store.listClaims().length + 1001;
    let ref = `CLM-${n}`;
    // Avoid collisions if references were created out of band.
    let bump = n;
    while (this.store.getClaimByReference(ref)) {
      bump += 1;
      ref = `CLM-${bump}`;
    }
    return ref;
  }

  /** Add an associated contact (doctor, hospital billing, witness, ...). */
  addContact(claimId: string, input: ContactInput): ClaimContact {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    const phone = assertE164(input.phone, `${input.role} phone`);
    const lang = input.language ? languageFor(input.language) : null;
    return this.store.createContact({
      claimId: claim.id,
      role: input.role,
      name: input.name,
      phone,
      region: lang ? lang.region : null,
      locale: lang ? lang.locale : null,
      note: input.note ?? null,
    });
  }

  /**
   * Record a human-owned decision and apply the business transition. ClaimLine
   * only reaches this from terminal_verified or needs_human — a person decides.
   */
  applyDecision(intentId: string, input: DecisionInput): CallIntent {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error(`unknown intent: ${intentId}`);
    if (intent.state !== "terminal_verified" && intent.state !== "needs_human") {
      throw new Error(
        `intent ${intentId} is ${intent.state}; a decision can only be applied from terminal_verified or needs_human`,
      );
    }
    const decision: HumanDecision = {
      intentId,
      decidedBy: input.decidedBy,
      decision: input.decision,
      note: input.note ?? null,
      decidedAt: new Date().toISOString(),
    };
    this.store.saveDecision(decision);
    return this.store.updateIntentState(intentId, "applied", {
      reason: `decision:${input.decision}`,
    });
  }

  getClaimView(claimId: string): ClaimView | null {
    const claim = this.store.getClaim(claimId);
    if (!claim) return null;
    const intents = this.store.listIntentsByClaim(claim.id).map((intent) => ({
      intent,
      result: this.store.getResult(intent.id),
      decision: this.store.getDecision(intent.id),
    }));
    return { claim, intents };
  }

  listClaimViews(): ClaimView[] {
    return this.store
      .listClaims()
      .map((claim) => this.getClaimView(claim.id))
      .filter((v): v is ClaimView => v !== null);
  }

  /** Resolve a claim id from either its id or its human reference (CLM-1001). */
  resolveClaimId(idOrReference: string): string {
    const byId = this.store.getClaim(idOrReference);
    if (byId) return byId.id;
    const byRef = this.store.getClaimByReference(idOrReference);
    if (byRef) return byRef.id;
    throw new Error(`unknown claim: ${idOrReference}`);
  }

  /** Masked, PII-minimized claim view for the JSON API and MCP. */
  getPublicClaimView(claimId: string): PublicClaimView | null {
    const view = this.getClaimView(claimId);
    return view ? toPublicClaimView(view) : null;
  }

  listPublicClaimViews(): PublicClaimView[] {
    return this.listClaimViews().map(toPublicClaimView);
  }

  /** Resolve a contact id, verifying it belongs to the given claim. */
  resolveContactId(claimId: string, contactId: string): string {
    const contact = this.store.getContact(contactId);
    if (!contact || contact.claimId !== claimId) {
      throw new Error(`unknown contact ${contactId} for claim ${claimId}`);
    }
    return contact.id;
  }

  /**
   * Aggregated "case" view: every associated contact with its latest call and
   * result, plus a computed billed total across all bill-verification calls.
   */
  getCaseView(claimId: string): CaseView | null {
    const claim = this.store.getClaim(claimId);
    if (!claim) return null;

    const contacts: ContactCallView[] = this.store
      .listContactsByClaim(claim.id)
      .map((contact) => {
        const intent = this.store.getIntentByContact(contact.id);
        return {
          contact: maskContact(contact),
          defaultCallType: roleToCallType(contact.role),
          intent: intent ? maskIntent(intent) : null,
          result: intent ? this.store.getResult(intent.id) : null,
          decision: intent ? this.store.getDecision(intent.id) : null,
        };
      });

    const otherCalls: PublicIntentView[] = this.store
      .listIntentsByClaim(claim.id)
      .filter((i) => i.contactId === null)
      .map((intent) => ({
        intent: maskIntent(intent),
        result: this.store.getResult(intent.id),
        decision: this.store.getDecision(intent.id),
      }));

    const totals = this.computeTotals(claim.id);

    return {
      claim: maskClaim(claim),
      contacts,
      otherCalls,
      totals,
      claimDecision: this.store.getClaimDecision(claim.id),
    };
  }

  listCaseViews(): CaseView[] {
    return this.store
      .listClaims()
      .map((claim) => this.getCaseView(claim.id))
      .filter((v): v is CaseView => v !== null);
  }

  // ---- Customers & policies ----------------------------------------------

  createCustomer(input: {
    name: string;
    phone: string;
    email?: string | null;
    address?: string | null;
    language?: string | null;
  }): Customer {
    const phone = assertE164(input.phone, "customer phone");
    return this.store.createCustomer({
      name: input.name,
      phone,
      email: input.email ?? null,
      address: input.address ?? null,
      language: input.language ? languageFor(input.language).code : "en",
    });
  }

  addPolicy(
    customerId: string,
    input: {
      policyNumber: string;
      type: PolicyType;
      status?: PolicyStatus;
      coverageLimit?: number | null;
      currency?: string | null;
    },
  ): Policy {
    const customer = this.store.getCustomer(customerId);
    if (!customer) throw new Error(`unknown customer: ${customerId}`);
    return this.store.createPolicy({
      customerId: customer.id,
      policyNumber: input.policyNumber,
      type: input.type,
      status: input.status ?? "active",
      coverageLimit: input.coverageLimit ?? null,
      currency: input.currency ?? "USD",
    });
  }

  listCustomers(): PublicCustomer[] {
    return this.store.listCustomers().map(maskCustomer);
  }

  resolveCustomerId(idOrName: string): string {
    const byId = this.store.getCustomer(idOrName);
    if (byId) return byId.id;
    const match = this.store
      .listCustomers()
      .find((c) => c.name.toLowerCase() === idOrName.toLowerCase());
    if (match) return match.id;
    throw new Error(`unknown customer: ${idOrName}`);
  }

  getCustomerView(customerId: string): CustomerView | null {
    const customer = this.store.getCustomer(customerId);
    if (!customer) return null;
    return {
      customer: maskCustomer(customer),
      policies: this.store.listPoliciesByCustomer(customer.id),
      claims: this.store.listClaimsByCustomer(customer.id).map(maskClaim),
    };
  }

  /**
   * Open a claim on behalf of a customer + policy. Copies the customer's name
   * and phone onto the claim so the claimant contact is created automatically.
   */
  openClaimForCustomer(input: {
    customerId: string;
    policyId?: string | null;
    incidentType: string;
    notes?: string | null;
    language?: string | null;
    contacts?: ContactInput[];
  }): Claim {
    const customer = this.store.getCustomer(input.customerId);
    if (!customer) throw new Error(`unknown customer: ${input.customerId}`);
    return this.createClaim({
      customerId: customer.id,
      policyId: input.policyId ?? null,
      policyholderName: customer.name,
      claimantPhone: customer.phone,
      incidentType: input.incidentType,
      language: input.language ?? customer.language,
      notes: input.notes ?? null,
      contacts: input.contacts,
    });
  }

  /** Dashboard KPIs. */
  stats(): {
    customers: number;
    claims: number;
    openClaims: number;
    needsReview: number;
    sanctioned: number;
    calls: number;
  } {
    const cases = this.listCaseViews();
    let needsReview = 0;
    let calls = 0;
    let sanctioned = 0;
    let open = 0;
    for (const c of cases) {
      const rows = [...c.contacts.map((x) => x.intent), ...c.otherCalls.map((x) => x.intent)];
      const activeCalls = rows.filter((i) => i && i.state !== "canceled");
      calls += activeCalls.length;
      if (activeCalls.some((i) => i && i.state === "needs_human")) needsReview += 1;
      if (c.claimDecision?.decision === "approved") sanctioned += 1;
      else open += 1;
    }
    return {
      customers: this.store.countCustomers(),
      claims: cases.length,
      openClaims: open,
      needsReview,
      sanctioned,
      calls,
    };
  }

  /** Business-impact analytics across every claim (for the Insights page). */
  analytics(): {
    claims: number;
    approved: number;
    rejected: number;
    pending: number;
    callsCompleted: number;
    callsNeedsReview: number;
    partiesCalled: number;
    hoursSaved: number;
    fraudFlagged: number;
    fraudHigh: number;
    paidOut: { currency: string; amount: number }[];
    incidentBreakdown: { type: string; count: number }[];
  } {
    const cases = this.listCaseViews();
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    let callsCompleted = 0;
    let callsNeedsReview = 0;
    let partiesCalled = 0;
    let fraudFlagged = 0;
    let fraudHigh = 0;
    const paid = new Map<string, number>();
    const incidents = new Map<string, number>();

    for (const c of cases) {
      const d = c.claimDecision?.decision;
      if (d === "approved") approved += 1;
      else if (d === "rejected") rejected += 1;
      else pending += 1;

      for (const row of c.contacts) {
        if (!row.intent) continue;
        partiesCalled += 1;
        if (row.intent.state === "terminal_verified") callsCompleted += 1;
        else if (row.intent.state === "needs_human") callsNeedsReview += 1;
      }
      for (const row of c.otherCalls) {
        if (row.intent.state === "terminal_verified") callsCompleted += 1;
        else if (row.intent.state === "needs_human") callsNeedsReview += 1;
      }

      const fraud = this.assessClaimFraud(c.claim.id);
      if (fraud && fraud.level !== "low") fraudFlagged += 1;
      if (fraud && fraud.level === "high") fraudHigh += 1;

      const payment = this.store.getLatestPaymentByClaim(c.claim.id);
      if (payment && payment.status === "succeeded") {
        paid.set(payment.currency, (paid.get(payment.currency) ?? 0) + payment.amount);
      }

      incidents.set(c.claim.incidentType, (incidents.get(c.claim.incidentType) ?? 0) + 1);
    }

    // Assume ~12 minutes of manual work saved per completed/attempted party call.
    const MINUTES_PER_CALL = 12;
    const hoursSaved =
      Math.round(((callsCompleted + callsNeedsReview) * MINUTES_PER_CALL) / 6) / 10;

    return {
      claims: cases.length,
      approved,
      rejected,
      pending,
      callsCompleted,
      callsNeedsReview,
      partiesCalled,
      hoursSaved,
      fraudFlagged,
      fraudHigh,
      paidOut: [...paid.entries()].map(([currency, amount]) => ({ currency, amount })),
      incidentBreakdown: [...incidents.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  private computeTotals(claimId: string): CaseTotals {
    let billedTotal: number | null = null;
    let currency: string | null = null;
    let incomplete = false;
    for (const intent of this.store.listIntentsByClaim(claimId)) {
      if (intent.callType !== "bill_verification") continue;
      const result = this.store.getResult(intent.id);
      const amount = result?.structuredResult?.total_amount;
      if (result?.disposition === "auto_ok" && typeof amount === "number") {
        billedTotal = (billedTotal ?? 0) + amount;
        const cur = result.structuredResult?.estimated_cost_currency
          ?? result.structuredResult?.currency;
        if (typeof cur === "string" && !currency) currency = cur;
      } else {
        incomplete = true;
      }
    }
    return { billedTotal, currency, incomplete };
  }

  /**
   * Record the human-owned claim outcome (approve/reject/hold). ClaimLine only
   * gathers facts; sanctioning a claim is always a person's decision.
   */
  sanctionClaim(claimId: string, input: SanctionInput): ClaimDecision {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    const decision: ClaimDecision = {
      claimId: claim.id,
      decidedBy: input.decidedBy,
      decision: input.decision,
      sanctionedAmount:
        input.decision === "approved" ? input.sanctionedAmount ?? null : null,
      currency: input.decision === "approved" ? input.currency ?? null : null,
      note: input.note ?? null,
      decidedAt: new Date().toISOString(),
    };
    this.store.saveClaimDecision(decision);
    return decision;
  }

  // ---- Autopilot: call every party, then report --------------------------

  /**
   * Autopilot: place a call to every party on the claim at once, flag the claim
   * so a consolidated report is delivered when all calls finish, then reconcile
   * once (fixture calls complete immediately; live calls finish in the
   * background). Returns the report inline when everything is already terminal.
   */
  async runAutopilot(
    claimId: string,
    opts: { placedBy?: string | null; apiKey?: string | null } = {},
  ): Promise<{ dispatched: number; report: CaseReport | null; notified: boolean }> {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`unknown claim: ${claimId}`);
    const dispatcher =
      opts.apiKey !== undefined ? this.dispatcherFor(opts.apiKey) : this.dispatcher;

    let dispatched = 0;
    for (const contact of this.store.listContactsByClaim(claimId)) {
      const outcome = await dispatcher.dispatchToContact(claimId, contact.id, {
        confirm: true,
        placedBy: opts.placedBy ?? null,
      });
      if (outcome.status === "submitted") dispatched += 1;
    }
    this.store.setClaimAutopilot(claimId, true);

    const reconciler =
      opts.apiKey !== undefined ? this.reconcilerFor(opts.apiKey) : this.reconciler;
    await reconciler.pollOnce({ claimId }).catch(() => {});
    const { sent, report } = await this.maybeSendAutopilotReport(claimId);
    return { dispatched, report, notified: sent };
  }

  /** Cross-party fraud / consistency assessment for a claim (null if unknown). */
  assessClaimFraud(claimId: string): FraudAssessment | null {
    const view = this.getCaseView(claimId);
    if (!view) return null;
    const claim = this.store.getClaim(claimId);
    const policy = claim?.policyId ? this.store.getPolicy(claim.policyId) : null;
    return assessFraud(view, { coverageLimit: policy?.coverageLimit ?? null });
  }

  /** Build the consolidated end-of-case report for a claim (incl. any payout). */
  buildReportFor(claimId: string): CaseReport | null {
    const view = this.getCaseView(claimId);
    if (!view) return null;
    return buildCaseReport(
      view,
      this.store.getLatestPaymentByClaim(claimId),
      this.assessClaimFraud(claimId),
    );
  }

  /**
   * If a claim is under autopilot and every call has reached a terminal state,
   * generate the report, push it to Slack/Teams, and mark it sent (exactly once).
   */
  async maybeSendAutopilotReport(
    claimId: string,
  ): Promise<{ sent: boolean; report: CaseReport | null }> {
    const flags = this.store.getClaimAutopilot(claimId);
    if (!flags.autopilot || flags.reportSentAt) return { sent: false, report: null };
    const intents = this.store.listIntentsByClaim(claimId);
    if (intents.length === 0) return { sent: false, report: null };
    const terminal = new Set([
      "terminal_verified",
      "needs_human",
      "applied",
      "canceled",
    ]);
    if (!intents.every((i) => terminal.has(i.state))) {
      return { sent: false, report: null };
    }
    const report = this.buildReportFor(claimId);
    if (!report) return { sent: false, report: null };
    await this.notifier.send({ title: report.title, text: report.text }).catch(() => {});
    this.store.markClaimReportSent(claimId, new Date().toISOString());
    return { sent: true, report };
  }

  /** Background hook: finish any pending autopilot reports. */
  async processAutopilotReports(): Promise<void> {
    for (const claimId of this.store.listAutopilotPendingClaimIds()) {
      await this.maybeSendAutopilotReport(claimId).catch(() => {});
    }
  }

  /** Manually (re)send a claim's report to the configured channel(s). */
  async sendCaseReport(
    claimId: string,
  ): Promise<{ report: CaseReport; result: NotifyResult }> {
    const report = this.buildReportFor(claimId);
    if (!report) throw new Error(`unknown claim: ${claimId}`);
    const result = await this.notifier.send({ title: report.title, text: report.text });
    this.store.markClaimReportSent(claimId, new Date().toISOString());
    return { report, result };
  }

  // ---- Payments (Stripe demo) --------------------------------------------

  /**
   * Pay out an approved claim's sanctioned amount. Uses Stripe (test mode) when
   * STRIPE_SECRET_KEY is configured, otherwise a simulated success. Idempotent:
   * a claim already paid returns its existing successful payment.
   */
  async payoutClaim(claimId: string): Promise<Payment> {
    const decision = this.store.getClaimDecision(claimId);
    if (!decision || decision.decision !== "approved") {
      throw new Error("claim must be approved before payout");
    }
    const amount = decision.sanctionedAmount;
    if (amount === null || !(amount > 0)) {
      throw new Error("approved claim has no sanctioned amount to pay out");
    }
    const existing = this.store.getLatestPaymentByClaim(claimId);
    if (existing && existing.status === "succeeded") return existing;

    const currency = decision.currency ?? "USD";
    const claim = this.store.getClaim(claimId);
    const result = await this.payments.charge({
      amount,
      currency,
      description: `ClaimLine payout for ${claim?.reference ?? claimId}`,
      metadata: { claimId, reference: claim?.reference ?? "" },
    });
    const payment: Payment = {
      id: randomUUID(),
      claimId,
      amount,
      currency,
      status: result.status,
      provider: result.provider,
      reference: result.reference,
      createdAt: new Date().toISOString(),
    };
    this.store.savePayment(payment);
    return payment;
  }

  getLatestPayment(claimId: string): Payment | null {
    return this.store.getLatestPaymentByClaim(claimId);
  }

  /**
   * Idempotently create a realistic demo dataset: several customers, each with
   * a policy, plus a few open claims (including a multi-party, multi-language
   * bike-accident case). Safe to call repeatedly.
   */
  seedDemo(): Claim[] {
    if (this.store.countCustomers() > 0) {
      return this.store.listClaims();
    }

    const mk = (
      name: string,
      phone: string,
      language: string,
      email: string,
      address: string,
      policyNumber: string,
      type: PolicyType,
      coverage: number,
    ): { customer: Customer; policy: Policy } => {
      const customer = this.createCustomer({ name, phone, language, email, address });
      const policy = this.addPolicy(customer.id, {
        policyNumber,
        type,
        coverageLimit: coverage,
        currency: "USD",
      });
      return { customer, policy };
    };

    const ravi = mk("Ravi Patel", "+12025550142", "en", "ravi.patel@example.com", "12 Oak St, Springfield", "POL-AUTO-1001", "auto", 25000);
    const maria = mk("Maria Gomez", "+12025550171", "es", "maria.gomez@example.com", "88 Pine Ave, Rivertown", "POL-HOME-1002", "home", 150000);
    const alex = mk("Alex Kim", "+12025550164", "en", "alex.kim@example.com", "5 Birch Rd, Lakeside", "POL-HEALTH-1003", "health", 50000);
    mk("Priya Sharma", "+919812345670", "hi", "priya.sharma@example.com", "22 MG Road, Pune", "POL-AUTO-1004", "auto", 800000);
    mk("Diego Torres", "+525512345678", "es", "diego.torres@example.com", "Calle 5 de Mayo 10, CDMX", "POL-TRAVEL-1005", "travel", 20000);

    const created: Claim[] = [];

    created.push(
      this.openClaimForCustomer({
        customerId: ravi.customer.id,
        policyId: ravi.policy.id,
        incidentType: "auto_collision",
        language: "en",
        notes: "Rear-end collision; demo claim for intake + repair status.",
        contacts: [
          { role: "repair_shop", name: "Downtown Auto Body", phone: "+12025550188", note: "Repair shop" },
        ],
      }),
    );

    created.push(
      this.openClaimForCustomer({
        customerId: maria.customer.id,
        policyId: maria.policy.id,
        incidentType: "property_water",
        language: "es",
        notes: "Burst pipe; used to demo Spanish calls + needs-review handling.",
        contacts: [
          { role: "repair_shop", name: "SprayTech Restoration", phone: "+12025550133", note: "Restoration vendor" },
        ],
      }),
    );

    created.push(
      this.openClaimForCustomer({
        customerId: alex.customer.id,
        policyId: alex.policy.id,
        incidentType: "injury",
        language: "en",
        notes: "Bike accident injury claim — multi-party: claimant, treating doctor, hospital billing.",
        contacts: [
          { role: "treating_doctor", name: "Dr. Anita Rao", phone: "+12025550109", note: "Treated the patient in the ER" },
          { role: "hospital_billing", name: "City General Hospital — Billing", phone: "+12025550117", note: "Accounts / billing desk" },
        ],
      }),
    );

    return created;
  }

  close(): void {
    this.store.close();
  }
}
