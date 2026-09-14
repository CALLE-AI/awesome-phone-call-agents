import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "../../server/get-db";
import { getCaseDetail } from "../../server/queries";
import { gateRows } from "../../../domain/gates";
import { isResettableSyntheticCase } from "../../../application/reset-synthetic-case";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  needs_review: "Needs review",
  preview_ready: "Preview ready",
  dispatch_reserved: "Dispatch reserved",
  submission_unknown: "Submission unknown",
  call_active: "Call active",
  terminal_unverified: "Terminal · unverified",
  verification_confirmed: "Verified — vendor initiated",
  verification_denied: "Verified — vendor did NOT initiate",
  needs_human: "Needs human review",
};

const PRIMARY_SCENARIOS = [
  { id: "confirmed", label: "Confirmed — vendor initiated" },
  { id: "denied", label: "Denied — not initiated" },
  { id: "unable-to-verify", label: "Unable to verify" },
  { id: "unreachable", label: "Unreachable / no answer" },
] as const;

const FAILURE_SCENARIOS = [
  { id: "sensitive-data", label: "Sensitive data leaked" },
  { id: "malformed", label: "Malformed result" },
  { id: "in-progress", label: "Still in progress" },
  { id: "acceptance_unknown", label: "Acceptance unknown" },
  { id: "rejected", label: "Provider rejected" },
] as const;

const LIVE_MODE = process.env.CHANGELOCK_MODE === "live";

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const db = await getDb();
  const detail = await getCaseDetail(db, id);
  if (!detail) notFound();

  const lastEval = [...detail.audit].reverse().find((e) => e.type === "result.evaluated");
  const lastDisposition = lastEval?.payload.disposition as string | undefined;
  const gates = gateRows(
    lastEval ? new Set((lastEval.payload.failedGates as string[] | undefined) ?? []) : null,
  );
  const canRun = detail.state === "needs_review" || detail.state === "preview_ready";
  const refreshable = detail.intents.filter(
    (i) => detail.state === "call_active" && i.providerCallId,
  );
  const unknownIntent =
    detail.state === "submission_unknown"
      ? detail.intents.find((i) => i.status === "reserved" && !i.providerCallId)
      : undefined;
  const canReconcileLive = LIVE_MODE && unknownIntent?.providerMode === "live";
  const canResetSynthetic =
    !LIVE_MODE &&
    detail.suggestedScenario !== null &&
    isResettableSyntheticCase(detail.state, detail.request.externalEventId);
  const latestSnapshot = detail.intents.flatMap((i) => i.snapshots).at(-1);

  return (
    <main>
      <div className="case-head">
        <div>
          <div className="muted mono">
            <Link href="/">← Inbox</Link> · {detail.safeCaseCode}
          </div>
          <h1>{detail.vendor.displayName}</h1>
          <span className={`state-badge ${detail.state}`}>
            {STATE_LABEL[detail.state] ?? detail.state}
          </span>
        </div>
        <div className="held-banner">Payment change held — evidence only, never approval</div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="workspace">
        <aside className="trust-rail" aria-label="Trust boundary">
          <div className="rail-stop untrusted">
            <div className="rail-label">Untrusted request</div>
            <div className="rail-body">
              <div>{detail.request.contactName}</div>
              <div className="mono muted">{detail.request.contactPhoneMasked}</div>
              <div className="muted mono">
                {detail.request.sourceSystem} · {detail.request.sourceReference}
              </div>
              <div className="muted rail-note">
                Claims destination: {detail.request.newDestinationLabel}
              </div>
            </div>
          </div>
          <div className="rail-stop trusted">
            <div className="rail-label">Independent callback</div>
            <div className="rail-body">
              {detail.trustedContact ? (
                <>
                  <div>{detail.trustedContact.name}</div>
                  <div className="muted">{detail.trustedContact.role}</div>
                  <div className="mono">{detail.trustedContact.maskedPhone}</div>
                  <div className="muted mono">
                    {detail.trustedContact.source} · verified{" "}
                    {detail.trustedContact.verifiedAt.slice(0, 10)}
                  </div>
                  <div className="dial-arrow">→ the only number ChangeLock will ever dial</div>
                </>
              ) : (
                <div className="empty-note">No trusted contact on vendor record</div>
              )}
            </div>
          </div>
          <div className="rail-stop evidence">
            <div className="rail-label">Evidence only</div>
            <div className="rail-body">
              {lastDisposition ? (
                <div>
                  Disposition: <span className="mono">{lastDisposition}</span>
                </div>
              ) : (
                <div className="muted">No call outcome yet.</div>
              )}
              <div className="muted rail-note">
                The request stays held either way. Confirmed is evidence for an analyst, not an
                approval.
              </div>
            </div>
          </div>
        </aside>

        <section>
          <div className="panel">
            <div className="panel-head">
              <h2>Held change request</h2>
              <span className="held-marker">held</span>
            </div>
            <div className="panel-body">
              <dl className="kv">
                <dt>Event</dt>
                <dd className="mono">{detail.request.externalEventId}</dd>
                <dt>Source</dt>
                <dd className="mono">
                  {detail.request.sourceSystem} · {detail.request.sourceReference}
                </dd>
                <dt>Requested at</dt>
                <dd className="mono">{detail.request.requestedAt}</dd>
                <dt>Claimed destination</dt>
                <dd>{detail.request.newDestinationLabel}</dd>
                <dt>Status</dt>
                <dd>
                  <span className="held-marker">held</span>
                </dd>
              </dl>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Bounded call contract — what the agent may say</h2>
              <span className="mono muted">
                {detail.taskVersion} · {detail.schemaVersion}
              </span>
            </div>
            <div className="panel-body">
              <div className="task-text">{detail.taskText}</div>
              <p className="muted u-mb-0">
                The agent discloses automation, asks only whether the organization initiated the
                change, and is forbidden from requesting bank details, credentials, or OTPs.
                Nothing in this call approves anything.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>{LIVE_MODE ? "Run a verification call" : "Run a deterministic replay scenario"}</h2>
              <span className="mono muted">
                {LIVE_MODE
                  ? "replay fixtures or one real call"
                  : "offline fixture → same parser & gates as live"}
              </span>
            </div>
            <div className="panel-body">
              {detail.state === "needs_review" ? (
                <form
                  method="post"
                  action={`/api/cases/${detail.caseId}/preview`}
                  className="u-mb-16"
                >
                  <button type="submit">Prepare call preview</button>
                  <span className="hint-inline">
                    resolves the trusted contact and freezes the exact call contract — no call is
                    placed
                  </span>
                </form>
              ) : null}
              {canRun ? (
                <form method="post" action={`/api/cases/${detail.caseId}/replay`}>
                  <div className="scenario-grid" role="radiogroup" aria-label="Replay scenario">
                    {PRIMARY_SCENARIOS.map((s) => (
                      <label key={s.id}>
                        <input
                          type="radio"
                          name="scenario"
                          value={s.id}
                          required
                          defaultChecked={detail.suggestedScenario === s.id}
                        />
                        {s.label}
                      </label>
                    ))}
                  </div>
                  <details className="scenario-extra">
                    <summary>Test failure handling</summary>
                    <div className="scenario-grid u-mt-8">
                      {FAILURE_SCENARIOS.map((s) => (
                        <label key={s.id}>
                          <input type="radio" name="scenario" value={s.id} />
                          {s.label}
                        </label>
                      ))}
                    </div>
                  </details>
                  <div className="field">
                    <label htmlFor="typedPhrase">
                      Type the exact authorization phrase:{" "}
                      <span className="mono">VERIFY {detail.safeCaseCode}</span>
                    </label>
                    <input
                      type="text"
                      id="typedPhrase"
                      name="typedPhrase"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={`VERIFY ${detail.safeCaseCode}`}
                      required
                    />
                  </div>
                  <label className="checkbox-field">
                    <input type="checkbox" name="attestedConsentingContact" required />
                    <span>
                      I attest the dialed number belongs to a consenting contact recorded in the
                      vendor master, and this call gathers evidence only.
                    </span>
                  </label>
                  <div className="btn-row">
                    <button type="submit" className="btn-primary">
                      Reserve intent &amp; run scenario
                    </button>
                  </div>
                </form>
              ) : (
                <p className="empty-note">
                  This case is in state <span className="mono">{detail.state}</span> and cannot start
                  a new verification call.
                </p>
              )}
              {LIVE_MODE && canRun ? (
                <form
                  method="post"
                  action={`/api/cases/${detail.caseId}/live`}
                  className="live-form"
                >
                  <p className="live-warning">
                    Live mode is enabled. This places one real external CALL-E call to the trusted
                    contact&apos;s number — an irreversible side effect.
                  </p>
                  <div className="field">
                    <label htmlFor="liveTypedPhrase">
                      Type the exact authorization phrase:{" "}
                      <span className="mono">VERIFY {detail.safeCaseCode}</span>
                    </label>
                    <input
                      type="text"
                      id="liveTypedPhrase"
                      name="typedPhrase"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={`VERIFY ${detail.safeCaseCode}`}
                      required
                    />
                  </div>
                  <label className="checkbox-field">
                    <input type="checkbox" name="attestedConsentingContact" required />
                    <span>
                      I attest the dialed number belongs to a consenting contact recorded in the
                      vendor master, and this call gathers evidence only.
                    </span>
                  </label>
                  <div className="btn-row">
                    <button type="submit" className="btn-primary">
                      Place one real CALL-E call
                    </button>
                  </div>
                </form>
              ) : null}
              {unknownIntent ? (
                <div className="u-mt-12">
                  <p className="live-warning">
                    Call submission was ambiguous — the provider may have created a call. Do not
                    redial; reconcile the authoritative result or escalate.
                  </p>
                  {canReconcileLive ? (
                    <form
                      method="post"
                      action={`/api/cases/${detail.caseId}/reconcile`}
                      className="u-mb-16"
                    >
                      <input type="hidden" name="intentId" value={unknownIntent.id} />
                      <div className="field">
                        <label htmlFor="providerCallId">
                          CALL-E call id from the operator dashboard
                        </label>
                        <input
                          type="text"
                          id="providerCallId"
                          name="providerCallId"
                          autoComplete="off"
                          spellCheck={false}
                          required
                        />
                      </div>
                      <div className="btn-row">
                        <button type="submit" className="btn-primary">
                          Reconcile authoritative result
                        </button>
                      </div>
                    </form>
                  ) : null}
                  <form method="post" action={`/api/cases/${detail.caseId}/escalate`}>
                    <input type="hidden" name="intentId" value={unknownIntent.id} />
                    <button type="submit">Escalate to human review</button>
                  </form>
                </div>
              ) : null}
              {refreshable.length > 0 ? (
                <form
                  method="post"
                  action={`/api/cases/${detail.caseId}/refresh`}
                  className="u-mt-12"
                >
                  <input type="hidden" name="intentId" value={refreshable[0].id} />
                  <button type="submit">Refresh call {refreshable[0].providerCallId}</button>
                </form>
              ) : null}
              {canResetSynthetic ? (
                <form
                  method="post"
                  action={`/api/cases/${detail.caseId}/reset`}
                  className="u-mt-12"
                >
                  <button type="submit">Reset synthetic case</button>
                  <div className="hint-inline">
                    demo maintenance — clears this seeded case&apos;s call history so it can be
                    replayed; the payment change stays held
                  </div>
                </form>
              ) : null}
            </div>
          </div>

          {latestSnapshot ? (
            <div className="panel">
              <div className="panel-head">
                <h2>Latest call result (normalized)</h2>
                <span className="mono muted">
                  {latestSnapshot.verificationMode} ·{" "}
                  {latestSnapshot.confidenceScore === null
                    ? "no confidence"
                    : `confidence ${latestSnapshot.confidenceScore}`}
                </span>
              </div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Provider status</dt>
                  <dd className="mono">{latestSnapshot.providerStatus}</dd>
                  <dt>Structured result</dt>
                  <dd>
                    {latestSnapshot.structuredResult ? (
                      <span className="mono">
                        {Object.entries(latestSnapshot.structuredResult)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </span>
                    ) : (
                      <span className="muted">none (rejected or unreachable)</span>
                    )}
                  </dd>
                </dl>
                {latestSnapshot.evidence.length > 0 ? (
                  <ul className="evidence-list">
                    {latestSnapshot.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel-head">
              <h2>Result policy gates</h2>
              <span className="mono muted">
                {lastEval ? `last eval: ${lastDisposition}` : "no evaluation yet"}
              </span>
            </div>
            <div className="panel-body">
              <ul className="gates">
                {gates.map((g) => (
                  <li key={g.id} className={g.status === "pending" ? "" : g.status}>
                    <span>{g.label}</span>
                  </li>
                ))}
              </ul>
              <p className="muted u-mb-0">
                Confirmed and denied require every gate. Any unsafe, unknown, contradictory, or
                malformed result fails closed to human review.
              </p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Audit timeline</h2>
              <span className="mono muted">hash-linked · privacy-minimized</span>
            </div>
            <div className="panel-body">
              {detail.audit.length === 0 ? (
                <p className="empty-note">No audit events.</p>
              ) : (
                <ul className="audit-list">
                  {detail.audit.map((e, i) => (
                    <li key={i}>
                      <span className="audit-type">{e.type}</span>{" "}
                      <span className="audit-meta">
                        {e.actor} · {e.createdAt} · #{e.eventHash.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
