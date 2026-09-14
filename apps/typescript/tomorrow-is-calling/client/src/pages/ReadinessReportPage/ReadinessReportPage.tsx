import { StatusBadge } from "../../components/StatusBadge/StatusBadge";
import type { CallEResponse } from "../../services/callEApi";
import type { TransportRequest } from "../../types/transport";
import "./ReadinessReportPage.css";

type Props = {
  request: TransportRequest;
  result?: CallEResponse;
  onNew: () => void;
  onOverview: () => void;
};

type StructuredOutcome = {
  reached?: boolean;
  identity_confirmed?: boolean;
  transport_details_confirmed?: boolean;
  completion_timing?: string;
  human_help_needed?: boolean;
  customer_questions?: string[];
  special_instructions?: string[];
  blockers?: string[];
  summary?: string;
};

function getStructuredOutcome(result?: CallEResponse): StructuredOutcome | undefined {
  if (!result) return undefined;
  const recipientResult = result.recipients?.find((recipient) => recipient.structured_result)?.structured_result;
  const candidate = recipientResult ?? result.structured_result;
  return candidate && typeof candidate === "object" ? (candidate as StructuredOutcome) : undefined;
}

function cleanList(value?: string[]) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

export function ReadinessReportPage({ request, result, onNew, onOverview }: Props) {
  const outcome = getStructuredOutcome(result);
  const reached = outcome?.reached;
  const identityConfirmed = outcome?.identity_confirmed;
  const detailsConfirmed = outcome?.transport_details_confirmed;
  const completionTiming = outcome?.completion_timing?.trim();
  const humanHelp = outcome?.human_help_needed;
  const questions = cleanList(outcome?.customer_questions);
  const instructions = cleanList(outcome?.special_instructions);
  const blockers = cleanList(outcome?.blockers);
  const summary = outcome?.summary?.trim() || result?.summary?.trim();
  const hasStructuredOutcome = Boolean(outcome);

  const statusTone = humanHelp || blockers.length ? "attention" : "ready";
  const statusLabel = humanHelp || blockers.length ? "Follow-up required" : "Call complete";

  return (
    <main className="page report">
      <p className="eyebrow">Customer follow-up outcome</p>
      <div className="report__title">
        <div>
          <h1>Call outcome <span>{request.reference}</span></h1>
          <p>{request.customer.fullName} · {request.vehicle.year} {request.vehicle.make} {request.vehicle.model}</p>
        </div>
        <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
      </div>

      <section className="report-metrics">
        <div><b>{reached === undefined ? "—" : reached ? "Yes" : "No"}</b><span>Customer reached</span></div>
        <div><b>{identityConfirmed === undefined ? "—" : identityConfirmed ? "Yes" : "No"}</b><span>Identity confirmed</span></div>
        <div><b>{detailsConfirmed === undefined ? "—" : detailsConfirmed ? "Yes" : "No"}</b><span>Transport details confirmed</span></div>
        <div><b>{humanHelp === undefined ? "—" : humanHelp ? "Yes" : "No"}</b><span>Human follow-up</span></div>
      </section>

      {hasStructuredOutcome ? (
        <>
          <section className="projection">
            <p className="section-label">Conversation summary</p>
            <div>
              <p>{summary || "CALL-E completed the call but did not return a narrative summary."}</p>
              {completionTiming && <p><b>Timing discussed:</b> {completionTiming}</p>}
            </div>
          </section>

          <section>
            <p className="section-label">Confirmed information</p>
            <div className="risk-list">
              <article className="risk-item"><div><StatusBadge tone={reached ? "ready" : "critical"}>{reached ? "Confirmed" : "Not reached"}</StatusBadge><h3>Customer reached</h3></div><p>{reached ? "Yes" : "No"}</p></article>
              <article className="risk-item"><div><StatusBadge tone={identityConfirmed ? "ready" : "critical"}>{identityConfirmed ? "Confirmed" : "Unconfirmed"}</StatusBadge><h3>Identity confirmed</h3></div><p>{identityConfirmed ? "Yes" : "No"}</p></article>
              <article className="risk-item"><div><StatusBadge tone={detailsConfirmed ? "ready" : "attention"}>{detailsConfirmed ? "Confirmed" : "Needs review"}</StatusBadge><h3>Transport details</h3></div><p>{detailsConfirmed ? "Customer confirmed the transport details discussed on the call." : "Transport details were not fully confirmed."}</p></article>
            </div>
          </section>

          <section>
            <p className="section-label">Customer questions</p>
            <div className="risk-list">
              {questions.length ? questions.map((question, index) => (
                <article className="risk-item" key={`${question}-${index}`}>
                  <div><StatusBadge tone="attention">Question</StatusBadge><h3>Customer question</h3></div>
                  <p>{question}</p>
                </article>
              )) : (
                <article className="risk-item">
                  <div><StatusBadge tone="ready">None</StatusBadge><h3>No questions reported</h3></div>
                  <p>CALL-E did not record any customer questions during this call.</p>
                </article>
              )}
            </div>
          </section>

          <section>
            <p className="section-label">Special instructions</p>
            <div className="risk-list">
              {instructions.length ? instructions.map((instruction, index) => (
                <article className="risk-item" key={`${instruction}-${index}`}>
                  <div><StatusBadge tone="attention">Noted</StatusBadge><h3>Driver / coordinator note</h3></div>
                  <p>{instruction}</p>
                </article>
              )) : (
                <article className="risk-item">
                  <div><StatusBadge tone="ready">None</StatusBadge><h3>No new instructions</h3></div>
                  <p>No additional instructions were captured during the call.</p>
                </article>
              )}
            </div>
          </section>

          <section>
            <p className="section-label">Unresolved items</p>
            <div className="risk-list">
              {blockers.length ? blockers.map((blocker, index) => (
                <article className="risk-item" key={`${blocker}-${index}`}>
                  <div><StatusBadge tone="critical">Pending</StatusBadge><h3>Blocker</h3></div>
                  <p>{blocker}</p>
                </article>
              )) : (
                <article className="risk-item">
                  <div><StatusBadge tone="ready">Clear</StatusBadge><h3>No blockers reported</h3></div>
                  <p>CALL-E did not return any unresolved blockers for this call.</p>
                </article>
              )}
            </div>
          </section>

          <section className="projection">
            <p className="section-label">Next action</p>
            <div>
              <p>{humanHelp ? "Route this request to a human transport coordinator for follow-up." : "Continue the transport workflow using the confirmed call outcome."}</p>
              <p><b>Human escalation:</b> {humanHelp ? "Required" : "Not required"}</p>
              <p><b>Call ID:</b> {result?.id ?? "Unavailable"}</p>
            </div>
          </section>
        </>
      ) : (
        <section className="projection">
          <p className="section-label">Live outcome unavailable</p>
          <div>
            <p>The call completed, but CALL-E did not return a structured outcome in the response available to this page.</p>
            {result?.summary && <p><b>CALL-E summary:</b> {result.summary}</p>}
            <p><b>Call ID:</b> {result?.id ?? "Unavailable"}</p>
          </div>
        </section>
      )}

      <div className="form-actions">
        <button className="button button--primary" onClick={onNew}>Create another request</button>
        <button className="button button--quiet" onClick={onOverview}>Return to transport queue</button>
      </div>
    </main>
  );
}
