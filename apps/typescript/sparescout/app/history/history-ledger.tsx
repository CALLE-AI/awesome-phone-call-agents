"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  forgetHistoryAccess,
  readRememberedHistoryAccess,
  shouldRefreshHistoryRun,
  type RememberedHistoryAccess,
} from "../../lib/history-store";

type Supplier = { id: string; name: string; phone: string; area: string | null };
type Quote = {
  supplierId: string;
  supplierName: string;
  status: string;
  result: unknown;
  summary: string | null;
  evidence: unknown;
  createdAt: string;
};
type Run = {
  id: string;
  mode: string;
  status: string;
  taskCompleted: boolean | null;
  completionConfidence: { score: number; label: string | null } | null;
  summary: string | null;
  evidence: unknown;
  createdAt: string;
  completedAt: string | null;
  quotes: Quote[];
};
type HistoryRequest = {
  id: string;
  status: string;
  executionMode: string;
  recipientConsentConfirmed: boolean;
  authorizedCallWindow: string;
  vehicle: string;
  part: string;
  fitmentReference: string;
  budgetAmount: number;
  currency: string;
  deliveryLocation: string;
  neededBy: string;
  countryCode: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  suppliers: Supplier[];
  runs: Run[];
};
type LedgerItem = {
  access: RememberedHistoryAccess;
  request?: HistoryRequest;
  error?: string;
  notice?: string;
  deleteError?: string;
  deleting?: boolean;
};

function label(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function resultValue(result: unknown, key: string): unknown {
  return result && typeof result === "object" ? (result as Record<string, unknown>)[key] : undefined;
}

function evidenceLines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 4) : [];
}

function formatMoney(amount: unknown, request: HistoryRequest): string {
  if (typeof amount !== "number") return "Price not returned";
  try {
    return new Intl.NumberFormat(request.locale, { style: "currency", currency: request.currency }).format(amount);
  } catch {
    return `${request.currency} ${amount.toLocaleString()}`;
  }
}

async function fetchHistory(access: RememberedHistoryAccess): Promise<HistoryRequest> {
  const response = await fetch(`/api/sourcing/requests/${encodeURIComponent(access.requestId)}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${access.token}` },
  });
  const payload = await response.json() as { request?: HistoryRequest; error?: string };
  if (!response.ok || !payload.request) throw new Error(payload.error ?? "This request could not be reopened.");
  return payload.request;
}

async function loadItem(access: RememberedHistoryAccess): Promise<LedgerItem> {
  try {
    let request = await fetchHistory(access);
    const activeRun = request.runs.find(shouldRefreshHistoryRun);
    if (!activeRun) return { access, request };

    const response = await fetch(
      `/api/calls/status/${encodeURIComponent(request.id)}/${encodeURIComponent(activeRun.id)}`,
      { cache: "no-store", headers: { authorization: `Bearer ${access.token}` } },
    );
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      return { access, request, notice: payload.error ?? "The latest live status could not be refreshed." };
    }
    request = await fetchHistory(access);
    return { access, request };
  } catch (error) {
    return { access, error: error instanceof Error ? error.message : "This request could not be reopened." };
  }
}

export function HistoryLedger() {
  const [items, setItems] = useState<LedgerItem[] | null>(null);

  const refresh = useCallback(async () => {
    const access = readRememberedHistoryAccess();
    setItems(access.length ? await Promise.all(access.map(loadItem)) : []);
  }, []);

  useEffect(() => {
    let active = true;
    const access = readRememberedHistoryAccess();
    void Promise.all(access.map(loadItem)).then((loaded) => { if (active) setItems(loaded); });
    return () => { active = false; };
  }, []);

  const forget = (requestId: string) => {
    forgetHistoryAccess(requestId);
    setItems((current) => current?.filter((item) => item.access.requestId !== requestId) ?? []);
  };

  const deleteRecord = async (access: RememberedHistoryAccess) => {
    const confirmed = window.confirm(
      "Permanently delete this request, its supplier details, call evidence, and quotes from SpareScout? This cannot be undone.",
    );
    if (!confirmed) return;
    setItems((current) => current?.map((item) => item.access.requestId === access.requestId
      ? { ...item, deleting: true, deleteError: undefined }
      : item) ?? []);
    try {
      const response = await fetch(`/api/sourcing/requests/${encodeURIComponent(access.requestId)}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${access.token}` },
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? "The durable record could not be deleted.");
      forgetHistoryAccess(access.requestId);
      setItems((current) => current?.filter((item) => item.access.requestId !== access.requestId) ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The durable record could not be deleted.";
      setItems((current) => current?.map((item) => item.access.requestId === access.requestId
        ? { ...item, deleting: false, deleteError: message }
        : item) ?? []);
    }
  };

  if (items === null) return <section className="history-loading" aria-live="polite">Opening your private ledger…</section>;
  if (!items.length) {
    return (
      <section className="history-empty">
        <span aria-hidden="true">◇</span>
        <h2>No requests are saved in this browser yet.</h2>
        <p>Complete the safe sourcing demo and SpareScout will add its durable, masked audit record here.</p>
        <Link className="inline-cta" href="/">Start a sourcing request <span>→</span></Link>
      </section>
    );
  }

  return (
    <section className="history-ledger" aria-live="polite">
      <div className="history-toolbar">
        <p>{items.length} locally authorized {items.length === 1 ? "request" : "requests"}</p>
        <button type="button" onClick={() => void refresh()}>Refresh saved records</button>
      </div>
      {items.map((item) => item.request ? (
        <article className="history-card" key={item.access.requestId}>
          <div className="history-card-head">
            <div>
              <p className="section-kicker">{item.request.countryCode} · {item.request.executionMode} workflow</p>
              <h2>{item.request.part}</h2>
              <p>{item.request.vehicle} · fitment {item.request.fitmentReference}</p>
            </div>
            <span className={`history-status ${item.request.status}`}>{label(item.request.status)}</span>
          </div>
          <dl className="history-facts">
            <div><dt>Budget</dt><dd>{formatMoney(item.request.budgetAmount, item.request)}</dd></div>
            <div><dt>Delivery</dt><dd>{item.request.deliveryLocation}</dd></div>
            <div><dt>Needed</dt><dd>{item.request.neededBy}</dd></div>
            <div><dt>Created</dt><dd>{new Date(item.request.createdAt).toLocaleString(item.request.locale)}</dd></div>
          </dl>
          <div className="history-suppliers">
            {item.request.suppliers.map((supplier) => (
              <span key={supplier.id}><strong>{supplier.name}</strong>{supplier.area ?? "Area not supplied"} · {supplier.phone}</span>
            ))}
          </div>
          {item.request.executionMode === "live" && (
            <p className="history-consent"><strong>Consent attested</strong>Authorized calling window: {item.request.authorizedCallWindow}</p>
          )}
          {item.notice && <p className="history-notice" role="status">{item.notice} The last durable status is shown below.</p>}
          {item.deleteError && <p className="history-notice" role="alert">{item.deleteError}</p>}
          {!item.request.runs.length ? (
            <p className="history-pending">Plan saved. No approved call run has been recorded.</p>
          ) : item.request.runs.map((run) => (
            <section className="history-run" key={run.id}>
              <div><p className="section-kicker">{run.mode} run · {label(run.status)}</p><strong>{run.summary ?? "No run summary returned."}</strong></div>
              <div className="history-quotes">
                {run.quotes.map((quote) => {
                  const evidence = evidenceLines(quote.evidence);
                  return (
                    <details key={`${run.id}:${quote.supplierId}`}>
                      <summary><span><strong>{quote.supplierName}</strong>{label(quote.status)}</span><b>{formatMoney(resultValue(quote.result, "price_amount"), item.request!)}</b></summary>
                      <p>{quote.summary ?? "No supplier summary returned."}</p>
                      {evidence.length > 0 && <ul>{evidence.map((line) => <li key={line}>{line}</li>)}</ul>}
                    </details>
                  );
                })}
              </div>
            </section>
          ))}
          <div className="history-card-foot">
            <small>Request {item.request.id}</small>
            <div className="history-card-actions">
              <button type="button" onClick={() => forget(item.request!.id)}>Forget on this device</button>
              <button className="history-delete" type="button" disabled={item.deleting} onClick={() => void deleteRecord(item.access)}>
                {item.deleting ? "Deleting record…" : "Delete durable record"}
              </button>
            </div>
          </div>
        </article>
      ) : (
        <article className="history-card history-error" key={item.access.requestId}>
          <h2>Saved request unavailable</h2>
          <p>{item.error}</p>
          <button type="button" onClick={() => forget(item.access.requestId)}>Forget on this device</button>
        </article>
      ))}
      <p className="source-note">“Forget” removes this browser’s credential only. “Delete durable record” permanently removes the request and its related server-side records. Remaining records are pruned after 30 days.</p>
    </section>
  );
}
