"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { isTerminalExecution, type SourcingExecution } from "../lib/calle/contracts.ts";
import { getSupportedMarket, SUPPORTED_MARKETS, type SupportedMarket } from "../lib/markets.ts";
import { rememberHistoryAccess } from "../lib/history-store.ts";
import { SiteFooter, SiteHeader } from "./components/site-chrome";

type Stage = "request" | "plan" | "calling" | "results";

type Quote = {
  id: number;
  supplier: string;
  area: string;
  status: "Verified" | "Partial";
  brand: string;
  price: number;
  stock: string;
  delivery: string;
  confidence: number;
  evidence: string;
  note?: string;
};

type UiSupplier = { id: string; name: string; area: string; phone: string; fixturePhone: string };
type SupplierDraft = { id: string; name: string; area: string; phone: string };

const supplierTemplates = [
  { id: "independent-dealer", name: "Independent Parts Dealer", area: "Local specialist" },
  { id: "city-spares", name: "City Spares Centre", area: "Multi-brand stockist" },
  { id: "regional-distributor", name: "Regional Parts Distributor", area: "Delivery network" },
] as const;

function suppliersForMarket(market: SupportedMarket): UiSupplier[] {
  return supplierTemplates.map((supplier, index) => ({
    ...supplier,
    fixturePhone: market.fixturePhones[index],
    phone: market.fixturePhones[index].replace(/\d(?=\d{3})/g, "•"),
  }));
}

function maskPhoneForDisplay(phone: string): string {
  return phone.replace(/\d(?=\d{3})/g, "•");
}

const quotes: Quote[] = [
  {
    id: 1,
    supplier: "AutoHub Industrial",
    area: "Industrial Area",
    status: "Verified",
    brand: "SKF",
    price: 6500,
    stock: "2 in stock",
    delivery: "Today · before 5 PM",
    confidence: 96,
    evidence: "Confirmed against chassis suffix 5K9 and OEM reference 43550-12030.",
  },
  {
    id: 2,
    supplier: "Kirinyaga Parts Co.",
    area: "Kirinyaga Road",
    status: "Verified",
    brand: "NSK",
    price: 7200,
    stock: "1 in stock",
    delivery: "Collection only",
    confidence: 91,
    evidence: "Seller read back the vehicle year, model and front-left position.",
  },
  {
    id: 3,
    supplier: "Mombasa Road Motors",
    area: "Mombasa Road",
    status: "Partial",
    brand: "Aftermarket",
    price: 5800,
    stock: "Available",
    delivery: "Tomorrow · KSh 450",
    confidence: 68,
    evidence: "Vehicle model matched, but the seller could not verify the OEM reference.",
    note: "Compatibility needs manual confirmation before reservation.",
  },
];

const callActivity = [
  "Call plan approved — preparing three supplier calls",
  "AutoHub answered — checking chassis compatibility",
  "Kirinyaga Parts quoted an NSK bearing",
  "Mombasa Road Motors needs an OEM reference check",
  "Three conversations normalized into comparable offers",
];

const liveCallActivity = [
  "Approved plan submitted once with a stable idempotency key",
  "CALL-E accepted the supplier batch",
  "Refreshing the existing run without redialing",
  "Terminal supplier results will be normalized and stored",
];

const formatMoney = (value: number, currency = "KES", locale = "en-KE") =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

function executionQuotes(execution: SourcingExecution, supplierList: UiSupplier[]): Quote[] {
  return execution.quotes.map((quote, index) => {
    const result = quote.result ?? {};
    const compatible = result.compatibility === "confirmed";
    const quantity = typeof result.available_quantity === "number" ? result.available_quantity : 0;
    const baseConfidence = Math.round((execution.completionConfidence?.score ?? 0.75) * 100);
    const evidence = Array.isArray(result.evidence)
      ? result.evidence.find((item): item is string => typeof item === "string")
      : undefined;
    return {
      id: index + 1,
      supplier: quote.supplierName,
      area: supplierList.find((supplier) => supplier.id === quote.supplierId)?.area ?? "Supplier",
      status: compatible ? "Verified" : "Partial",
      brand: typeof result.brand === "string" && result.brand ? result.brand : "Unknown brand",
      price: typeof result.price_amount === "number" ? result.price_amount : 0,
      stock: quantity > 0 ? `${quantity} in stock` : "Stock unknown",
      delivery: typeof result.delivery_eta === "string" && result.delivery_eta ? result.delivery_eta : "Delivery unknown",
      confidence: compatible ? baseConfidence : Math.max(45, baseConfidence - 25),
      evidence: evidence ?? quote.summary ?? "No evidence returned.",
      note: compatible ? undefined : "Compatibility needs manual confirmation before reservation.",
    };
  });
}

export default function Home() {
  const [stage, setStage] = useState<Stage>("request");
  const [activeActivity, setActiveActivity] = useState(0);
  const [selectedQuote, setSelectedQuote] = useState<number | null>(null);
  const [reservationReady, setReservationReady] = useState(false);
  const [approvalToken, setApprovalToken] = useState<string | null>(null);
  const [historyAccessToken, setHistoryAccessToken] = useState<string | null>(null);
  const [execution, setExecution] = useState<SourcingExecution | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionMode, setExecutionMode] = useState<"fixture" | "live">("fixture");
  const [operatorToken, setOperatorToken] = useState("");
  const [recipientConsentConfirmed, setRecipientConsentConfirmed] = useState(false);
  const [authorizedCallWindow, setAuthorizedCallWindow] = useState("");
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [liveSuppliers, setLiveSuppliers] = useState<SupplierDraft[]>([
    { id: "live-supplier-1", name: "", area: "", phone: "" },
    { id: "live-supplier-2", name: "", area: "", phone: "" },
    { id: "live-supplier-3", name: "", area: "", phone: "" },
  ]);
  const [form, setForm] = useState({
    vehicle: "2014 Toyota Fielder",
    part: "Front-left wheel bearing",
    chassis: "NKE165-705K9",
    budget: "8000",
    location: "Nairobi CBD",
    timing: "Today",
    countryCode: "KE",
    locale: "en-KE",
  });

  const market = useMemo(() => getSupportedMarket(form.countryCode) ?? SUPPORTED_MARKETS[0], [form.countryCode]);
  const fixtureSuppliers = useMemo(() => suppliersForMarket(market), [market]);
  const activeSuppliers = useMemo<UiSupplier[]>(() => executionMode === "fixture"
    ? fixtureSuppliers
    : liveSuppliers.map((supplier) => ({
        ...supplier,
        fixturePhone: supplier.phone,
        phone: maskPhoneForDisplay(supplier.phone),
      })), [executionMode, fixtureSuppliers, liveSuppliers]);
  const displayQuotes = useMemo(() => execution ? executionQuotes(execution, activeSuppliers) : quotes, [execution, activeSuppliers]);
  const bestVerified = useMemo(
    () => displayQuotes.filter((quote) => quote.status === "Verified").sort((a, b) => a.price - b.price)[0] ?? displayQuotes[0],
    [displayQuotes],
  );
  const displayedActivity = execution?.mode === "live" ? liveCallActivity : callActivity;

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  useEffect(() => {
    let active = true;
    fetch("/api/calls/capabilities", { cache: "no-store" })
      .then(async (response) => {
        const capabilities = await response.json() as { liveAvailable?: boolean };
        if (active) setLiveAvailable(Boolean(capabilities.liveAvailable));
      })
      .catch(() => { if (active) setLiveAvailable(false); });
    return () => { active = false; };
  }, []);

  const updateLiveSupplier = (index: number, field: keyof Omit<SupplierDraft, "id">, value: string) => {
    setLiveSuppliers((current) => current.map((supplier, supplierIndex) =>
      supplierIndex === index ? { ...supplier, [field]: value } : supplier,
    ));
  };

  const updateMarket = (countryCode: string) => {
    const nextMarket = getSupportedMarket(countryCode);
    if (!nextMarket) return;
    setForm((current) => ({
      ...current,
      countryCode: nextMarket.countryCode,
      locale: nextMarket.defaultLocale,
      budget: String(nextMarket.defaultBudget),
      location: nextMarket.defaultLocation,
    }));
  };

  const reviewPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setRequestError(null);
    try {
      const response = await fetch("/api/calls/plan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(executionMode === "live" ? { authorization: `Bearer ${operatorToken}` } : {}),
        },
        body: JSON.stringify({
          executionMode,
          recipientConsentConfirmed: executionMode === "live" && recipientConsentConfirmed,
          authorizedCallWindow: executionMode === "live" ? authorizedCallWindow : "No live call — fixture",
          vehicle: form.vehicle,
          part: form.part,
          fitmentReference: form.chassis,
          budgetAmount: Number(form.budget),
          currency: market.currency,
          deliveryLocation: form.location,
          neededBy: form.timing,
          countryCode: market.countryCode,
          locale: form.locale,
          suppliers: activeSuppliers.map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            area: supplier.area,
            phone: supplier.fixturePhone,
          })),
        }),
      });
      const payload = await response.json() as {
        approvalToken?: string;
        historyAccess?: { requestId: string; token: string };
        error?: string;
      };
      if (!response.ok || !payload.approvalToken) throw new Error(payload.error ?? "Unable to prepare the call plan.");
      if (payload.historyAccess) {
        rememberHistoryAccess(payload.historyAccess);
        setHistoryAccessToken(payload.historyAccess.token);
      }
      setApprovalToken(payload.approvalToken);
      setStage("plan");
      setSelectedQuote(null);
      setReservationReady(false);
      setExecution(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to prepare the call plan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const pollLiveExecution = async (requestId: string, initial: SourcingExecution, accessToken: string) => {
    let current = initial;
    let temporaryFailures = 0;
    for (let attempt = 0; attempt < 120 && !isTerminalExecution(current); attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      const response = await fetch(
        `/api/calls/status/${encodeURIComponent(requestId)}/${encodeURIComponent(current.callId)}`,
        { cache: "no-store", headers: { authorization: `Bearer ${accessToken}` } },
      );
      const payload = await response.json() as { execution?: SourcingExecution; error?: string };
      if (!response.ok || !payload.execution) {
        temporaryFailures += 1;
        if (temporaryFailures < 4) continue;
        throw new Error(payload.error ?? "The call status could not be refreshed. Your run remains saved.");
      }
      temporaryFailures = 0;
      current = payload.execution;
      setExecution(current);
      setActiveActivity((value) => Math.min(liveCallActivity.length - 1, value + 1));
    }
    if (!isTerminalExecution(current)) {
      throw new Error("The calls are still running and remain saved. Refresh their status again shortly.");
    }
    return current;
  };

  const approveCalls = async () => {
    if (!approvalToken || isExecuting) return;
    setStage("calling");
    setActiveActivity(0);
    setRequestError(null);
    setIsExecuting(true);
    const executionRequest = fetch("/api/calls/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(executionMode === "live" ? { authorization: `Bearer ${operatorToken}` } : {}),
      },
      body: JSON.stringify({ approvalToken, approved: true }),
    });
    try {
      const response = await executionRequest;
      const payload = await response.json() as { execution?: SourcingExecution; requestId?: string; error?: string };
      if (!response.ok || !payload.execution) throw new Error(payload.error ?? "Unable to run the approved sourcing plan.");
      let finalExecution = payload.execution;
      setExecution(finalExecution);
      if (finalExecution.mode === "fixture") {
        for (let index = 1; index < callActivity.length; index += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 350));
          setActiveActivity(index);
        }
      } else if (!isTerminalExecution(finalExecution)) {
        if (!payload.requestId) throw new Error("The call run was created without a tracking id.");
        if (!historyAccessToken) throw new Error("The private history credential is unavailable. The saved run was not polled again.");
        finalExecution = await pollLiveExecution(payload.requestId, finalExecution, historyAccessToken);
      }
      if (finalExecution.status === "failed" || finalExecution.status === "canceled") {
        throw new Error(finalExecution.summary ?? `The call run ended with status ${finalExecution.status}.`);
      }
      if (!finalExecution.quotes.length) {
        throw new Error("The calls completed without a usable quote. Review the saved run before trying again.");
      }
      setExecution(finalExecution);
      setStage("results");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to run the approved sourcing plan.");
      setStage("plan");
    } finally {
      setIsExecuting(false);
    }
  };

  const resetDemo = () => {
    setStage("request");
    setSelectedQuote(null);
    setReservationReady(false);
    setApprovalToken(null);
    setHistoryAccessToken(null);
    setExecution(null);
    setRequestError(null);
    setIsExecuting(false);
    setOperatorToken("");
  };

  return (
    <main>
      <SiteHeader badge={`${market.countryName} · ${market.countryCode}`} />

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Phone-powered parts sourcing</p>
          <h1>The right part.<br /><em>One round of calls.</em></h1>
          <p className="hero-description">
            SpareScout calls parts dealers in supported markets, verifies fitment, and turns
            every conversation into a localized quote you can compare.
          </p>
        </div>
        <div className="hero-proof" aria-label="Product metrics">
          <div><strong>17</strong><span>CALL-E markets</span></div>
          <div><strong>100%</strong><span>human-approved</span></div>
          <div><strong>0</strong><span>surprise purchases</span></div>
        </div>
      </section>

      <div className={`mode-banner ${executionMode === "live" ? "live-mode" : ""}`} role="status">
        <span className="mode-icon" aria-hidden="true">◇</span>
        <div>
          <strong>{executionMode === "live" ? "Live pilot mode" : "Safe demo mode"}</strong>
          <span>{executionMode === "live"
            ? "Approving the reviewed plan will place real calls to the three business numbers below."
            : "Switch markets and call languages across the supported CALL-E network. No phone calls or reservations will be made."}</span>
        </div>
        <span className="mode-chip">{executionMode === "live" ? "REAL CALLS" : "DRY RUN"}</span>
      </div>

      <section className="workspace" aria-label="Parts sourcing workspace">
        <div className="request-panel">
          <div className="panel-heading">
            <span className="step-number">01</span>
            <div><p>Build a request</p><h2>What are we finding?</h2></div>
          </div>

          <form onSubmit={reviewPlan}>
            <div className="field-grid">
              <label className="field">
                <span>Calling market</span>
                <select value={form.countryCode} onChange={(event) => updateMarket(event.target.value)}>
                  {SUPPORTED_MARKETS.map((candidate) => (
                    <option value={candidate.countryCode} key={candidate.countryCode}>{candidate.countryName}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Call language</span>
                <select value={form.locale} onChange={(event) => updateField("locale", event.target.value)}>
                  {market.locales.map((locale) => (
                    <option value={locale.code} key={locale.code}>{locale.label}</option>
                  ))}
                </select>
              </label>
              <fieldset className="mode-choice field-wide">
                <legend>Execution mode</legend>
                <label className={executionMode === "fixture" ? "selected" : ""} htmlFor="execution-fixture">
                  <span className="sr-only">Safe fixture execution</span>
                  <input id="execution-fixture" aria-label="Safe fixture execution" type="radio" name="execution-mode" checked={executionMode === "fixture"} onChange={() => setExecutionMode("fixture")} />
                  <span><strong>Safe fixture</strong><small>Structured demonstration; no dialing.</small></span>
                </label>
                <label className={`${executionMode === "live" ? "selected" : ""} ${!liveAvailable ? "disabled" : ""}`} htmlFor="execution-live">
                  <span className="sr-only">Live pilot execution</span>
                  <input id="execution-live" aria-label="Live pilot execution" type="radio" name="execution-mode" checked={executionMode === "live"} disabled={!liveAvailable} onChange={() => setExecutionMode("live")} />
                  <span><strong>Live pilot</strong><small>{liveAvailable ? "Real calls after plan approval." : "Requires trusted server configuration."}</small></span>
                </label>
              </fieldset>
              <label className="field field-wide">
                <span>Vehicle</span>
                <input value={form.vehicle} onChange={(event) => updateField("vehicle", event.target.value)} required />
              </label>
              <label className="field field-wide">
                <span>Part needed</span>
                <input value={form.part} onChange={(event) => updateField("part", event.target.value)} required />
              </label>
              <label className="field field-wide">
                <span>Chassis / VIN</span>
                <input value={form.chassis} onChange={(event) => updateField("chassis", event.target.value)} required />
                <small>Used only to confirm compatibility</small>
              </label>
              <label className="field">
                <span>Budget ceiling</span>
                <div className="input-prefix"><b>{market.currency}</b><input type="number" min="1" value={form.budget} onChange={(event) => updateField("budget", event.target.value)} required /></div>
              </label>
              <label className="field">
                <span>Needed by</span>
                <select value={form.timing} onChange={(event) => updateField("timing", event.target.value)}>
                  <option>Today</option><option>Tomorrow</option><option>This week</option>
                </select>
              </label>
              <label className="field field-wide">
                <span>Delivery area</span>
                <input value={form.location} onChange={(event) => updateField("location", event.target.value)} required />
              </label>
              {executionMode === "live" && (
                <fieldset className="supplier-editor field-wide">
                  <legend>Authorized supplier contacts</legend>
                  <p>Live access requires a private operator credential, direct consent, and numbers pre-approved in the server allowlist.</p>
                  <label className="field">
                    <span>Operator access token</span>
                    <input
                      type="password"
                      value={operatorToken}
                      onChange={(event) => setOperatorToken(event.target.value)}
                      autoComplete="off"
                      minLength={32}
                      placeholder="Private deployment credential"
                      required
                    />
                    <small>Used only for these live requests; never saved to browser history.</small>
                  </label>
                  {liveSuppliers.map((supplier, index) => (
                    <div className="supplier-editor-row" key={supplier.id}>
                      <label><span>Supplier {index + 1}</span><input value={supplier.name} onChange={(event) => updateLiveSupplier(index, "name", event.target.value)} placeholder="Business name" required /></label>
                      <label><span>Area</span><input value={supplier.area} onChange={(event) => updateLiveSupplier(index, "area", event.target.value)} placeholder="City or district" required /></label>
                      <label><span>E.164 phone</span><input type="tel" value={supplier.phone} onChange={(event) => updateLiveSupplier(index, "phone", event.target.value)} placeholder="+12025550101" pattern="\+[1-9][0-9]{7,14}" required /></label>
                    </div>
                  ))}
                  <div className="consent-panel">
                    <label className="field">
                      <span>Authorized calling window</span>
                      <input
                        value={authorizedCallWindow}
                        onChange={(event) => setAuthorizedCallWindow(event.target.value)}
                        placeholder="17 Aug, 3:00–4:00 PM EAT"
                        maxLength={120}
                        required
                      />
                      <small>Calls start immediately after final plan approval. Include the date, time, and time zone.</small>
                    </label>
                    <label className="consent-check">
                      <input
                        type="checkbox"
                        checked={recipientConsentConfirmed}
                        onChange={(event) => setRecipientConsentConfirmed(event.target.checked)}
                        required
                      />
                      <span><strong>Direct consent confirmed</strong>Each listed business agreed to receive this AI-assisted sourcing call during the window above.</span>
                    </label>
                  </div>
                </fieldset>
              )}
            </div>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Preparing signed plan…" : "Review supplier call plan"} <span aria-hidden="true">→</span>
            </button>
            {requestError && <p className="inline-error" role="alert">{requestError}</p>}
            <p className="button-note"><span aria-hidden="true">⌾</span> You will review every call before it starts</p>
          </form>
        </div>

        <aside className="activity-panel" aria-live="polite">
          {stage === "request" && (
            <div className="empty-state">
              <span className="radar" aria-hidden="true"><i /><i /><b>3</b></span>
              <p className="eyebrow">Your supplier network</p>
              <h2>Three dealers are ready to check.</h2>
              <p>Complete the request to preview exactly what SpareScout will ask each supplier.</p>
              <ul className="supplier-mini-list">
                {activeSuppliers.map((supplier, index) => <li key={supplier.id}><span>{supplier.name || `Supplier ${index + 1}`}</span><small>{supplier.area || "Contact details required"}</small></li>)}
              </ul>
            </div>
          )}

          {stage === "plan" && (
            <div className="plan-state">
              <div className="panel-heading compact">
                <span className="step-number">02</span>
                <div><p>Approval gate</p><h2>Review the call plan</h2></div>
              </div>
              <div className="call-script">
                <p>SpareScout will ask each supplier to:</p>
                <ol>
                  <li>Confirm a <strong>{form.part.toLowerCase()}</strong> fits the <strong>{form.vehicle}</strong> using chassis {form.chassis}.</li>
                  <li>Quote brand, condition, total price and available quantity.</li>
                  <li>Check delivery to {form.location} by {form.timing.toLowerCase()}.</li>
                  <li>Ask whether the item can be held—without reserving it.</li>
                </ol>
              </div>
              <div className="call-targets">
                {activeSuppliers.map((supplier) => <div key={supplier.id}><span className="supplier-index">{supplier.name.charAt(0)}</span><span><strong>{supplier.name}</strong><small>{supplier.phone}</small></span><b>Ready</b></div>)}
              </div>
              {executionMode === "live" && (
                <div className="consent-review">
                  <span aria-hidden="true">✓</span>
                  <p><strong>Operator authenticated · recipients allowlisted</strong>Consent attested for: {authorizedCallWindow}</p>
                </div>
              )}
              <div className="guardrail"><span>!</span><p><strong>No commitments</strong>Calls may gather quotes only. Payment, purchase, and reservation are blocked.</p></div>
              <button className="primary-button light" type="button" onClick={approveCalls} disabled={isExecuting}>{executionMode === "live" ? "Approve 3 supplier calls" : "Approve 3 demo calls"} <span>→</span></button>
              {requestError && <p className="inline-error dark" role="alert">{requestError}</p>}
              <button className="text-button" type="button" onClick={() => setStage("request")}>Edit request</button>
            </div>
          )}

          {stage === "calling" && (
            <div className="calling-state">
              <div className="signal-orbit" aria-hidden="true"><span>SS</span><i /><i /><i /></div>
              <p className="eyebrow">{execution?.mode === "live" ? "Live calls in progress" : "Demo calls in progress"}</p>
              <h2>{execution?.mode === "live" ? "Scout is on the line." : "Scout is simulating the workflow."}</h2>
              <div className="progress-track"><span style={{ width: `${((activeActivity + 1) / displayedActivity.length) * 100}%` }} /></div>
              <ul className="activity-list">
                {displayedActivity.slice(0, activeActivity + 1).map((activity, index) => (
                  <li key={activity} className={index === activeActivity ? "active" : "done"}>
                    <span>{index < activeActivity ? "✓" : "●"}</span>{activity}
                  </li>
                ))}
              </ul>
              {requestError && <p className="inline-error dark" role="alert">{requestError}</p>}
            </div>
          )}

          {stage === "results" && (
            <div className="summary-state">
              <p className="eyebrow">Sourcing complete</p>
              <h2>{displayQuotes.filter((quote) => quote.status === "Verified").length} verified options found.</h2>
              <p>Best verified price is <strong>{formatMoney(bestVerified.price, market.currency, form.locale)}</strong>, with evidence attached.</p>
              <div className="summary-stats"><div><b>{displayQuotes.length}/{activeSuppliers.length}</b><span>results</span></div><div><b>{displayQuotes.filter((quote) => quote.status === "Verified").length}</b><span>verified</span></div><div><b>{execution?.mode === "live" ? "Live" : "Fixture"}</b><span>{execution?.mode === "live" ? "CALL-E run" : "safe mode"}</span></div></div>
              <button className="secondary-button" type="button" onClick={resetDemo}>Start another search</button>
            </div>
          )}
        </aside>
      </section>

      {stage === "results" && (
        <section className="results-section" aria-labelledby="results-title">
          <div className="results-heading"><div><p className="eyebrow">03 · Compare verified offers</p><h2 id="results-title">Evidence, not guesswork.</h2></div><div className="legend"><span><i className="verified-dot" />Verified fitment</span><span><i className="partial-dot" />Needs confirmation</span></div></div>
          <div className="quote-grid">
            {displayQuotes.map((quote) => (
              <article className={`quote-card ${selectedQuote === quote.id ? "selected" : ""}`} key={quote.id}>
                {quote.id === bestVerified.id && <span className="best-tag">BEST VERIFIED OFFER</span>}
                <div className="quote-top"><div><p>{quote.area}</p><h3>{quote.supplier}</h3></div><span className={`fitment ${quote.status.toLowerCase()}`}>{quote.status}</span></div>
                <div className="quote-price"><strong>{formatMoney(quote.price, market.currency, form.locale)}</strong><span>{quote.brand} · new</span></div>
                <dl><div><dt>Availability</dt><dd>{quote.stock}</dd></div><div><dt>Delivery</dt><dd>{quote.delivery}</dd></div><div><dt>Confidence</dt><dd>{quote.confidence}%</dd></div></dl>
                <div className="confidence-bar"><span style={{ width: `${quote.confidence}%` }} /></div>
                <details><summary>View call evidence <span>+</span></summary><p>“{quote.evidence}”</p></details>
                {quote.note && <p className="warning-note"><span>!</span>{quote.note}</p>}
                <button type="button" className="select-button" onClick={() => { setSelectedQuote(quote.id); setReservationReady(false); }}>{selectedQuote === quote.id ? "Offer selected ✓" : "Select this offer"}</button>
              </article>
            ))}
          </div>
          <div className="reservation-bar">
            <div><span className="step-number">04</span><p><strong>{selectedQuote ? `${displayQuotes.find((quote) => quote.id === selectedQuote)?.supplier} selected` : "Choose an offer to continue"}</strong><small>A separate approval is always required before a reservation call.</small></p></div>
            <button disabled={!selectedQuote} onClick={() => setReservationReady(true)}>Preview reservation call</button>
          </div>
          {reservationReady && <div className="reservation-message" role="status"><span>✓</span><div><strong>Reservation preview ready</strong><p>Demo complete—no supplier was contacted and nothing was reserved.</p></div></div>}
        </section>
      )}

      <SiteFooter />
    </main>
  );
}
