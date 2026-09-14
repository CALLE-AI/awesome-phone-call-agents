"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import {
  clearPendingIntent,
  loadPendingIntent,
  savePendingIntent,
} from "@/lib/dispatch/pending-intent";
import {
  createDispatchDecision,
  saveDispatchDecision,
} from "@/lib/dispatch/decision";
import { screenForEmergency } from "@/lib/dispatch/safety";
import type {
  DispatchApiResponse,
  DispatchDecision,
  DispatchRequest,
  Urgency,
  Vendor,
  VendorCallResult,
  WorkOrder,
} from "@/lib/dispatch/types";
import { validateDispatchRequest } from "@/lib/dispatch/validation";
import { buildDispatchActivity } from "@/lib/dispatch/activity";
import { canReturnToPrepare, invalidateCallApproval } from "@/lib/dispatch/workflow";

type Phase = "prepare" | "preview" | "review";
type Readiness = "checking" | "ready" | "configuration_required" | "unavailable";

const initialWorkOrder: WorkOrder = {
  title: "",
  issue: "",
  property: "",
  location: "",
  urgency: "soon",
  disclosure:
    "Share the property name, unit or service area, issue description, and requested service window only.",
  maximumAuthorizedAction: "information_only",
};

const initialVendors: Vendor[] = [
  {
    id: "vendor-1",
    name: "",
    trade: "",
    phone: "",
    authorized: false,
    selected: true,
  },
  {
    id: "vendor-2",
    name: "",
    trade: "",
    phone: "",
    authorized: false,
    selected: true,
  },
];

function maskPhone(phone: string) {
  if (!phone) return "Number not entered";
  if (phone.length < 7) return phone.replace(/\d(?=\d{2})/g, "•");
  return `${phone.slice(0, 2)}${"•".repeat(Math.max(4, phone.length - 6))}${phone.slice(-4)}`;
}

function inputId(vendorId: string, field: string) {
  return `${vendorId}-${field}`;
}

function formatEta(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function formatPrice(result: VendorCallResult) {
  if (result.priceAmount !== null) {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: result.currency || "USD",
      maximumFractionDigits: 0,
    }).format(result.priceAmount);
  }
  return result.priceType === "quote_required" ? "Quote required" : "Not provided";
}

export function DispatchWorkspace() {
  const [phase, setPhase] = useState<Phase>("prepare");
  const [workOrder, setWorkOrder] = useState<WorkOrder>(initialWorkOrder);
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
  const [dispatchId, setDispatchId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Array<{ field: string; message: string }>>([]);
  const [apiResponse, setApiResponse] = useState<DispatchApiResponse | null>(null);
  const [isCalling, setIsCalling] = useState(false);
  const [readiness, setReadiness] = useState<Readiness>("checking");
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState<DispatchDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const safety = useMemo(() => screenForEmergency(workOrder.issue), [workOrder.issue]);
  const selectedVendors = vendors.filter((vendor) => vendor.selected);
  const hasUnknownOutcome = Boolean(
    apiResponse?.results?.some((result) => result.status === "unknown"),
  );
  const readinessLabel =
    readiness === "ready"
      ? "CALL-E configured"
      : readiness === "configuration_required"
        ? "Setup required"
        : readiness === "checking"
          ? "Checking readiness"
          : "Readiness unavailable";
  const activity = buildDispatchActivity({
    phase,
    readiness,
    vendorCount: selectedVendors.length,
    safetySafe: safety.safe,
    confirmed,
    isCalling,
    responseStatus: apiResponse?.status ?? null,
  });

  useEffect(() => {
    const restored = loadPendingIntent(window.localStorage);
    if (!restored) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setWorkOrder(restored.request.workOrder);
      setVendors(restored.request.vendors);
      setDispatchId(restored.request.dispatchId);
      setConfirmed(false);
      setApiResponse(restored.response);
      setPhase(restored.phase);
      setRecoveryNotice(
        "Recovered an unfinished dispatch. Review it and confirm again before any call.",
      );
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as { status?: string };
        setReadiness(
          body.status === "ready" ? "ready" : "configuration_required",
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReadiness("unavailable");
      });
    return () => controller.abort();
  }, []);

  function updateWorkOrder<K extends keyof WorkOrder>(field: K, value: WorkOrder[K]) {
    setWorkOrder((current) => ({ ...current, [field]: value }));
    setErrors((current) => current.filter((error) => error.field !== `workOrder.${field}`));
    invalidatePreview();
  }

  function updateVendor(id: string, patch: Partial<Vendor>) {
    setVendors((current) =>
      current.map((vendor) => (vendor.id === id ? { ...vendor, ...patch } : vendor)),
    );
    setErrors([]);
    invalidatePreview();
  }

  function invalidatePreview() {
    const invalidated = invalidateCallApproval({
      dispatchId,
      confirmed,
      hasResponse: Boolean(apiResponse),
    });
    setDispatchId(invalidated.dispatchId);
    setConfirmed(invalidated.confirmed);
    if (invalidated.clearPendingIntent) {
      clearPendingIntent(window.localStorage);
    }
    if (invalidated.clearResponse) {
      setApiResponse(null);
      setDecision(null);
    }
  }

  function returnToPrepare() {
    if (!canReturnToPrepare(isCalling)) return;
    setConfirmed(false);
    setPhase("prepare");
  }

  function addVendor() {
    if (vendors.length >= 5) return;
    setVendors((current) => [
      ...current,
      {
        id: `vendor-${current.length + 1}`,
        name: "",
        trade: "",
        phone: "",
        authorized: false,
        selected: true,
      },
    ]);
    invalidatePreview();
  }

  function removeVendor(id: string) {
    setVendors((current) => current.filter((vendor) => vendor.id !== id));
    invalidatePreview();
  }

  function preparePreview(event: FormEvent) {
    event.preventDefault();
    const nextDispatchId = dispatchId || crypto.randomUUID();
    const previewRequest: DispatchRequest = {
      workOrder,
      vendors,
      confirmedRealCalls: true,
      dispatchId: nextDispatchId,
    };
    const validation = validateDispatchRequest(previewRequest);

    if (!safety.safe) {
      setErrors([{ field: "workOrder.issue", message: safety.message || "Emergency refused." }]);
      return;
    }
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setDispatchId(nextDispatchId);
    setErrors([]);
    setConfirmed(false);
    setApiResponse(null);
    setPhase("preview");
    setRecoveryNotice(null);
    savePendingIntent(window.localStorage, {
      version: 1,
      phase: "preview",
      request: previewRequest,
      response: null,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function placeCalls() {
    if (!confirmed || isCalling) return;
    setIsCalling(true);
    setApiResponse(null);

    const request: DispatchRequest = {
      workOrder,
      vendors,
      confirmedRealCalls: true,
      dispatchId,
    };

    savePendingIntent(window.localStorage, {
      version: 1,
      phase: "preview",
      request,
      response: null,
    });

    try {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await response.json()) as DispatchApiResponse;
      setApiResponse(body);
      if (body.results?.length) {
        setPhase("review");
        savePendingIntent(window.localStorage, {
          version: 1,
          phase: "review",
          request,
          response: body,
        });
      }
    } catch {
      setApiResponse({
        code: "network_error",
        message:
          "The dispatch request could not reach the server. No successful call is being claimed.",
      });
    } finally {
      setIsCalling(false);
    }
  }

  function resetDispatch() {
    if (apiResponse?.results?.some((result) => result.status === "unknown")) return;
    clearPendingIntent(window.localStorage);
    setWorkOrder(initialWorkOrder);
    setVendors(initialVendors);
    setDispatchId("");
    setConfirmed(false);
    setErrors([]);
    setApiResponse(null);
    setRecoveryNotice(null);
    setDecision(null);
    setDecisionNote("");
    setPhase("prepare");
  }

  function recordDecision(kind: DispatchDecision["kind"], vendorId?: string) {
    if (!apiResponse?.results) return;
    const nextDecision = createDispatchDecision({
      dispatchId,
      kind,
      vendorId,
      results: apiResponse.results,
      note: decisionNote,
    });
    saveDispatchDecision(window.localStorage, nextDecision);
    setDecision(nextDecision);
  }

  return (
    <main className="app-shell">
      <div className="console-frame">
        <aside className="icon-rail" aria-label="Bellwrench navigation">
          <a className="brand-mark" href="#top" aria-label="Bellwrench dispatch desk">BW</a>
          <nav aria-label="Primary navigation">
            <a className="icon-link active" href="#top" aria-label="Dispatch workspace">⌂</a>
            <a className="icon-link" href="#roster-heading" aria-label="Vendor roster">♧</a>
            <a className="icon-link" href="#activity-heading" aria-label="Dispatch activity">◫</a>
          </nav>
          <div className="icon-rail-bottom">
            <span className={`rail-status ${readiness}`} title={readinessLabel} />
            <span className="icon-link" aria-hidden="true">⚙</span>
          </div>
        </aside>

        <div className="console-body">
          <header className="topbar">
            <a className="brand" href="#top" aria-label="Bellwrench dispatch desk">
              <span>
                <strong>Bellwrench</strong>
                <small>Evidence-backed dispatch</small>
              </span>
            </a>
            <nav className="top-tabs" aria-label="Dispatch phases">
              {(["prepare", "preview", "review"] as Phase[]).map((step) => (
                <button
                  className={phase === step ? "active" : ""}
                  type="button"
                  key={step}
                  onClick={() => {
                    if (step === "prepare") returnToPrepare();
                    if (step === "preview" && dispatchId) setPhase("preview");
                    if (step === "review" && apiResponse?.results) setPhase("review");
                  }}
                  disabled={
                    (step === "prepare" && isCalling) ||
                    (step === "preview" && !dispatchId) ||
                    (step === "review" && !apiResponse?.results)
                  }
                  aria-current={phase === step ? "step" : undefined}
                >
                  {step === "prepare" ? "Request" : step === "preview" ? "Authorize" : "Evidence"}
                </button>
              ))}
            </nav>
            <div className="topbar-meta">
              <span className={`live-dot ${readiness}`} aria-hidden="true" />
              <span>{readinessLabel}</span>
              <span className="approval-pill">Human approval</span>
            </div>
          </header>

          <div className="workspace" id="top">
        <aside className="rail" aria-label="Dispatch progress">
          <div className="rail-kicker">Active workflow</div>
          <h1>Vendor dispatch</h1>
          <p>Turn one maintenance request into comparable, transcript-backed vendor responses.</p>

          <ol className="steps">
            {(["prepare", "preview", "review"] as Phase[]).map((step, index) => {
              const phaseIndex = ["prepare", "preview", "review"].indexOf(phase);
              const state = index === phaseIndex ? "current" : index < phaseIndex ? "done" : "upcoming";
              return (
                <li className={`step ${state}`} key={step}>
                  <span className="step-index">{state === "done" ? "✓" : `0${index + 1}`}</span>
                  <span>
                    <strong>{step === "prepare" ? "Prepare" : step === "preview" ? "Authorize" : "Review"}</strong>
                    <small>
                      {step === "prepare"
                        ? "Work order + roster"
                        : step === "preview"
                          ? "Inspect call scope"
                          : "Compare real evidence"}
                    </small>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="rail-proof">
            <span className="proof-label">Hard boundary</span>
            <strong>No booking. No spend.</strong>
            <p>Bellwrench gathers facts. A person decides what happens next.</p>
          </div>
        </aside>

        <section className="desk" aria-live="polite">
          {recoveryNotice && (
            <div className="recovery-notice" role="status">
              <span aria-hidden="true">↺</span>
              <p><strong>Dispatch recovered.</strong> {recoveryNotice}</p>
            </div>
          )}
          {phase === "prepare" && (
            <form onSubmit={preparePreview}>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Dispatch  /  New request</span>
                  <h2>Build a call-ready work order.</h2>
                </div>
                <div className="deadline-chip">
                  <span>Hackathon deadline</span>
                  <strong>14 Sep · 11:45 pm SGT</strong>
                </div>
              </div>

              <div className={`safety-banner ${safety.safe ? "safe" : "blocked"}`}>
                <span className="safety-icon" aria-hidden="true">{safety.safe ? "✓" : "!"}</span>
                <div>
                  <strong>{safety.safe ? "Non-emergency screening active" : "Dispatch blocked"}</strong>
                  <p>
                    {safety.safe
                      ? "Life-safety language stops this workflow before any CALL-E client is created."
                      : safety.message}
                  </p>
                </div>
              </div>

              <section className="form-section" aria-labelledby="work-order-heading">
                <div className="form-section-title">
                  <span>01</span>
                  <div>
                    <h3 id="work-order-heading">Work order</h3>
                    <p>Give the caller enough context to ask useful questions—nothing more.</p>
                  </div>
                </div>

                <div className="field-grid">
                  <label className="field field-wide">
                    <span>Short title</span>
                    <input
                      value={workOrder.title}
                      onChange={(event) => updateWorkOrder("title", event.target.value)}
                      placeholder="e.g. Slow bathroom drain"
                      aria-invalid={errors.some((error) => error.field === "workOrder.title")}
                    />
                  </label>
                  <label className="field">
                    <span>Property</span>
                    <input
                      value={workOrder.property}
                      onChange={(event) => updateWorkOrder("property", event.target.value)}
                      placeholder="Property or site name"
                    />
                  </label>
                  <label className="field">
                    <span>Unit / service area</span>
                    <input
                      value={workOrder.location}
                      onChange={(event) => updateWorkOrder("location", event.target.value)}
                      placeholder="Unit, room, or floor"
                    />
                  </label>
                  <label className="field field-wide">
                    <span>What is happening?</span>
                    <textarea
                      value={workOrder.issue}
                      onChange={(event) => updateWorkOrder("issue", event.target.value)}
                      placeholder="Describe the observed issue, impact, and any safe workaround already available."
                      rows={4}
                      aria-invalid={!safety.safe || errors.some((error) => error.field === "workOrder.issue")}
                    />
                    <small>Do not include tenant names, medical details, access codes, or unnecessary personal data.</small>
                  </label>
                </div>

                <fieldset className="urgency-field">
                  <legend>Response window</legend>
                  <div className="segmented">
                    {(["routine", "soon", "urgent"] as Urgency[]).map((urgency) => (
                      <label key={urgency}>
                        <input
                          type="radio"
                          name="urgency"
                          value={urgency}
                          checked={workOrder.urgency === urgency}
                          onChange={() => updateWorkOrder("urgency", urgency)}
                        />
                        <span>{urgency === "routine" ? "This week" : urgency === "soon" ? "24–48 hours" : "Same day"}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <label className="field disclosure-field">
                  <span>Disclosure budget</span>
                  <textarea
                    value={workOrder.disclosure}
                    onChange={(event) => updateWorkOrder("disclosure", event.target.value)}
                    rows={2}
                  />
                  <small>The live caller must refuse requests outside this boundary.</small>
                </label>
              </section>

              <section className="form-section" aria-labelledby="roster-heading">
                <div className="form-section-title roster-title">
                  <span>02</span>
                  <div>
                    <h3 id="roster-heading">Authorized vendor roster</h3>
                    <p>Only add businesses your organization is permitted to contact.</p>
                  </div>
                  <button className="text-button" type="button" onClick={addVendor} disabled={vendors.length >= 5}>
                    + Add vendor
                  </button>
                </div>

                <div className="vendor-list">
                  {vendors.map((vendor, index) => (
                    <article className={`vendor-card ${vendor.selected ? "selected" : ""}`} key={vendor.id}>
                      <label className="select-vendor">
                        <input
                          type="checkbox"
                          checked={vendor.selected}
                          onChange={(event) => updateVendor(vendor.id, { selected: event.target.checked })}
                        />
                        <span aria-hidden="true" />
                        Call vendor {index + 1}
                      </label>
                      {vendors.length > 1 && (
                        <button
                          className="remove-button"
                          type="button"
                          onClick={() => removeVendor(vendor.id)}
                          aria-label={`Remove vendor ${index + 1}`}
                        >
                          Remove
                        </button>
                      )}
                      <div className="vendor-fields">
                        <label className="field">
                          <span>Business name</span>
                          <input
                            id={inputId(vendor.id, "name")}
                            value={vendor.name}
                            onChange={(event) => updateVendor(vendor.id, { name: event.target.value })}
                            placeholder="Authorized business"
                            disabled={!vendor.selected}
                          />
                        </label>
                        <label className="field">
                          <span>Trade</span>
                          <input
                            value={vendor.trade}
                            onChange={(event) => updateVendor(vendor.id, { trade: event.target.value })}
                            placeholder="Plumbing, HVAC, electrical…"
                            disabled={!vendor.selected}
                          />
                        </label>
                        <label className="field">
                          <span>Phone · E.164</span>
                          <input
                            value={vendor.phone}
                            onChange={(event) => updateVendor(vendor.id, { phone: event.target.value })}
                            placeholder="+14155550100"
                            inputMode="tel"
                            autoComplete="off"
                            disabled={!vendor.selected}
                          />
                        </label>
                        <label className="authorization-check">
                          <input
                            type="checkbox"
                            checked={vendor.authorized}
                            onChange={(event) => updateVendor(vendor.id, { authorized: event.target.checked })}
                            disabled={!vendor.selected}
                          />
                          <span>I confirm we are authorized to call this vendor.</span>
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {errors.length > 0 && (
                <div className="error-summary" role="alert">
                  <strong>Fix {errors.length} item{errors.length === 1 ? "" : "s"} before previewing.</strong>
                  <ul>{errors.map((error) => <li key={`${error.field}-${error.message}`}>{error.message}</li>)}</ul>
                </div>
              )}

              <div className="action-bar">
                <div>
                  <span>{selectedVendors.length} vendor{selectedVendors.length === 1 ? "" : "s"} selected</span>
                  <small>Previewing never places a call.</small>
                </div>
                <button className="primary-button" type="submit">
                  Preview dispatch <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>
          )}

          {phase === "preview" && (
            <div className="preview-screen">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Dispatch  /  Authorization</span>
                  <h2>Inspect the call before it leaves.</h2>
                </div>
                <button className="text-button" type="button" onClick={returnToPrepare} disabled={isCalling}>
                  ← Edit request
                </button>
              </div>

              <div className="preview-grid">
                <section className="call-brief">
                  <div className="brief-heading">
                    <span className="brief-number">{String(selectedVendors.length).padStart(2, "0")}</span>
                    <div>
                      <span className="eyebrow">Real outbound calls</span>
                      <h3>{workOrder.title}</h3>
                      <p>{workOrder.property} · {workOrder.location}</p>
                    </div>
                  </div>
                  <div className="brief-body">
                    <div className="brief-row"><span>Caller identity</span><strong>Bellwrench for the property operator</strong></div>
                    <div className="brief-row"><span>Purpose</span><strong>Collect availability, ETA, price status, constraints</strong></div>
                    <div className="brief-row"><span>Maximum action</span><strong>Information only—no booking or spend</strong></div>
                    <div className="brief-row"><span>Disclosure</span><strong>{workOrder.disclosure}</strong></div>
                  </div>
                </section>

                <aside className="schema-card">
                  <span className="eyebrow">Structured result</span>
                  <h3>Every answer lands in the same shape.</h3>
                  <ul>
                    <li><span>01</span> Availability</li>
                    <li><span>02</span> Earliest ETA</li>
                    <li><span>03</span> Price or quote status</li>
                    <li><span>04</span> Service constraints</li>
                    <li><span>05</span> Transcript-backed evidence</li>
                  </ul>
                </aside>
              </div>

              <section className="recipient-section">
                <div className="form-section-title">
                  <span>03</span>
                  <div>
                    <h3>Recipients</h3>
                    <p>Numbers are masked here. The server receives the exact E.164 value only at execution.</p>
                  </div>
                </div>
                <div className="recipient-list">
                  {selectedVendors.map((vendor) => (
                    <div className="recipient" key={vendor.id}>
                      <span className="recipient-avatar">{vendor.name.slice(0, 2).toUpperCase()}</span>
                      <span><strong>{vendor.name}</strong><small>{vendor.trade}</small></span>
                      <code>{maskPhone(vendor.phone)}</code>
                      <span className="authorized-badge">Authorized</span>
                    </div>
                  ))}
                </div>
              </section>

              <div className="consent-panel">
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span className="consent-box" aria-hidden="true" />
                  <span>
                    <strong>I intend to place these real phone calls now.</strong>
                    <small>I reviewed the recipients, disclosure budget, purpose, and no-booking boundary.</small>
                  </span>
                </label>
              </div>

              {apiResponse && !apiResponse.results?.length && (
                <div className="error-summary" role="alert">
                  <strong>{apiResponse.code === "configuration_required" ? "CALL-E setup required" : "Dispatch did not start"}</strong>
                  <p>{apiResponse.message}</p>
                </div>
              )}

              <div className="action-bar danger-action">
                <div>
                  <span>External side effect</span>
                  <small>Calls may take several minutes. Keep this page open.</small>
                </div>
                <button
                  className="primary-button call-button"
                  type="button"
                  disabled={!confirmed || isCalling || readiness !== "ready"}
                  onClick={placeCalls}
                >
                  {isCalling ? "CALL-E is calling…" : `Place ${selectedVendors.length} real call${selectedVendors.length === 1 ? "" : "s"}`}
                  {!isCalling && <span aria-hidden="true">↗</span>}
                </button>
              </div>
            </div>
          )}

          {phase === "review" && apiResponse?.results && (
            <div className="review-screen">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Dispatch  /  Evidence review</span>
                  <h2>Compare what vendors actually said.</h2>
                </div>
                <span className={`result-status ${apiResponse.status}`}>{apiResponse.status}</span>
              </div>

              <div className="review-notice">
                <span aria-hidden="true">i</span>
                <p><strong>No work has been assigned.</strong> {apiResponse.message}</p>
              </div>

              <div className="results-list">
                {apiResponse.results.map((result, index) => (
                  <article className={`result-card ${result.status}`} key={result.vendorId}>
                    <header>
                      <div className="rank">{String(index + 1).padStart(2, "0")}</div>
                      <div>
                        <h3>{result.vendorName}</h3>
                        <p>{result.summary || (result.failureCode ? `Outcome code: ${result.failureCode}` : "No verified summary returned.")}</p>
                      </div>
                      <span className={`outcome-badge ${result.status}`}>
                        {result.status === "verified"
                          ? result.availability
                          : result.status === "incomplete"
                            ? "Evidence incomplete"
                            : result.status === "unknown"
                              ? "Outcome unknown"
                              : "Call failed"}
                      </span>
                    </header>
                    {result.status === "verified" ? (
                      <>
                        <div className="metrics">
                          <div><span>Earliest ETA</span><strong>{formatEta(result.earliestEta)}</strong></div>
                          <div><span>Price status</span><strong>{formatPrice(result)}</strong></div>
                          <div><span>Confidence</span><strong>{result.completionConfidence || "Not provided"}</strong></div>
                          <div><span>CALL-E run</span><strong>{result.callId}</strong></div>
                        </div>
                        <details>
                          <summary>Evidence & constraints</summary>
                          <div className="evidence-grid">
                            <div><strong>Evidence</strong><ul>{result.evidence.length ? result.evidence.map((item) => <li key={item}>{item}</li>) : <li>No evidence returned.</li>}</ul></div>
                            <div><strong>Constraints</strong><ul>{result.constraints.length ? result.constraints.map((item) => <li key={item}>{item}</li>) : <li>None stated.</li>}</ul></div>
                          </div>
                        </details>
                      </>
                    ) : (
                      <div className={`nonverified-result ${result.status}`}>
                        <strong>
                          {result.status === "unknown"
                            ? "A call may exist. Do not create a new dispatch identity."
                            : result.status === "incomplete"
                              ? "Returned fields did not pass every verification gate."
                              : "The call definitively failed or was canceled."}
                        </strong>
                        <p>
                          No availability, ETA, or price is inferred from this outcome.
                          {result.callId ? ` CALL-E run: ${result.callId}.` : " No call ID is available."}
                          {result.failureCode ? ` Code: ${result.failureCode}.` : ""}
                        </p>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              <div className="action-bar">
                <div className="decision-panel">
                  <span>Human decision point</span>
                  <small>Record an evidence-based choice. This does not book work or accept vendor terms.</small>
                  <label htmlFor="decision-note">Operator note (optional)</label>
                  <textarea
                    id="decision-note"
                    value={decisionNote}
                    maxLength={500}
                    onChange={(event) => setDecisionNote(event.target.value)}
                    placeholder="Reason for the decision or next manual step"
                  />
                  <div className="decision-actions">
                    {apiResponse.results
                      .filter((result) => result.status === "verified")
                      .map((result) => (
                        <button
                          className="secondary-button"
                          type="button"
                          key={result.vendorId}
                          onClick={() => recordDecision("vendor_selected", result.vendorId)}
                        >
                          Select {result.vendorName}
                        </button>
                      ))}
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => recordDecision("no_dispatch")}
                    >
                      Record no dispatch
                    </button>
                  </div>
                  {decision && (
                    <div className="decision-record" role="status">
                      <strong>Decision recorded · no booking made</strong>
                      <span>
                        {decision.kind === "vendor_selected"
                          ? `${decision.vendorName} selected for manual follow-up.`
                          : "No vendor selected for dispatch."}
                      </span>
                      <small>{new Date(decision.recordedAt).toLocaleString()}</small>
                    </div>
                  )}
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetDispatch}
                  disabled={hasUnknownOutcome || !decision}
                >
                  {hasUnknownOutcome
                    ? "Resolve CALL-E run first"
                    : decision
                      ? "Start another dispatch"
                      : "Record a decision first"}
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="activity-panel" aria-labelledby="activity-heading">
          <div className="activity-heading">
            <div>
              <span className="eyebrow">Live desk</span>
              <h2 id="activity-heading">Dispatch activity</h2>
            </div>
            <span className={`live-dot ${readiness}`} aria-hidden="true" />
          </div>
          <p className="activity-intro">Only real workflow state appears here. No simulated calls or vendor answers.</p>
          <div className="activity-search" aria-hidden="true">⌕ &nbsp; Current dispatch</div>
          <div className="activity-list">
            {activity.map((item, index) => (
              <div className="activity-item" key={item.label}>
                <span className={`activity-marker ${item.tone}`}>{String(index + 1).padStart(2, "0")}</span>
                <span><small>{item.label}</small><strong>{item.value}</strong></span>
              </div>
            ))}
          </div>
          <div className="help-card">
            <span>Operating boundary</span>
            <strong>Facts first. Human decision last.</strong>
            <p>Bellwrench can collect evidence. It cannot book work, accept terms, or spend money.</p>
          </div>
          <div className="connection-card">
            <span className={`live-dot ${readiness}`} aria-hidden="true" />
            <span><small>CALL-E connection</small><strong>{readinessLabel}</strong></span>
          </div>
        </aside>
          </div>

          <footer>
            <span>Bellwrench / CALL-E operations console</span>
            <span>Real calls · Structured outcomes · Human control</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
