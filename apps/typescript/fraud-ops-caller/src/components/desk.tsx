"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Phone,
  PhoneCall,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MOCK_CASES, queueRows, type QueueRow } from "@/lib/cases";
import { buildCalleTaskPrompt, nvcFrameForCase } from "@/lib/nvc";
import { demoSlaHours, maskE164, toolsForIntent } from "@/lib/plan-view";
import { evaluateGate } from "@/lib/policy";
import { DISPOSITIONS, type FraudOpsCase, type FraudOpsOutcome } from "@/lib/types";
import { validateCase } from "@/lib/validate";
import { cn } from "@/lib/utils";

const LIVE_CONFIRM_PHRASE = "I understand this places a real phone call";

const INTENT_LABEL: Record<FraudOpsCase["intent"], string> = {
  kyc_chase: "KYC chase",
  evidence_collection: "Evidence",
  collections: "Collections",
  merchant_outreach: "Merchant",
};

const QUEUE = queueRows();

function formatMoney(amount?: number, currency?: string): string | null {
  if (amount === undefined || !currency) return null;
  try {
    return new Intl.NumberFormat("en-HK", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function elapsedLabel(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Desk() {
  const [selectedKey, setSelectedKey] = useState(QUEUE[0]?.key ?? "");
  const [callingCaseId, setCallingCaseId] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<{ caseId: string; message: string } | null>(
    null
  );
  const [outcomes, setOutcomes] = useState<Record<string, FraudOpsOutcome>>({});
  const [showJsonFor, setShowJsonFor] = useState<string | null>(null);
  const [liveAvailable, setLiveAvailable] = useState(false);
  const [authConfigured, setAuthConfigured] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [opsSecret, setOpsSecret] = useState("");
  const [livePhraseFor, setLivePhraseFor] = useState<string | null>(null);
  const [livePhrase, setLivePhrase] = useState("");
  const startedAt = useRef<number | null>(null);

  const row = QUEUE.find((item) => item.key === selectedKey) ?? QUEUE[0] ?? null;
  const isInvestigation = Boolean(row && row.cases.length > 1);

  useEffect(() => {
    if (!callingCaseId) return;
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      if (startedAt.current) setElapsedMs(Date.now() - startedAt.current);
    }, 200);
    return () => {
      window.clearInterval(timer);
      startedAt.current = null;
    };
  }, [callingCaseId]);

  useEffect(() => {
    fetch("/api/calls/config")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.liveAvailable === true) setLiveAvailable(true);
        if (data && data.authConfigured === true) setAuthConfigured(true);
      })
      .catch(() => {
        setLiveAvailable(false);
        setAuthConfigured(false);
      });
    fetch("/api/auth/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.authorized === true) setAuthed(true);
      })
      .catch(() => {
        setAuthed(false);
      });
  }, []);

  async function unlockOperator() {
    setError(null);
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: opsSecret }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Unlock failed");
      }
      setAuthed(true);
      setOpsSecret("");
    } catch (err) {
      setAuthed(false);
      setError({
        caseId: row?.cases[0]?.case_id ?? "auth",
        message: err instanceof Error ? err.message : "Unlock failed",
      });
    }
  }

  async function onConfirm(fraudCase: FraudOpsCase, mode: "demo" | "live") {
    if (callingCaseId) return;
    if (!authed) {
      setError({ caseId: fraudCase.case_id, message: "Unlock the desk with the operator secret." });
      return;
    }
    if (mode === "live" && livePhrase !== LIVE_CONFIRM_PHRASE) {
      setError({ caseId: fraudCase.case_id, message: "Type the live confirm phrase exactly." });
      return;
    }
    setError(null);
    setElapsedMs(0);
    setCallingCaseId(fraudCase.case_id);
    try {
      let liveGrant: string | undefined;
      if (mode === "live") {
        const grantRes = await fetch("/api/calls/authorize", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ caseId: fraudCase.case_id }),
        });
        const grantData = await grantRes.json();
        if (!grantRes.ok || typeof grantData.liveGrant !== "string") {
          throw new Error(grantData.error ?? `HTTP ${grantRes.status}`);
        }
        liveGrant = grantData.liveGrant;
      }
      const res = await fetch("/api/calls/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId: fraudCase.case_id,
          mode,
          confirmLive: mode === "live" ? livePhrase : undefined,
          liveGrant,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (!data.outcome) {
        throw new Error("Call succeeded without an outcome");
      }
      setOutcomes((prev) => ({ ...prev, [fraudCase.case_id]: data.outcome }));
      setShowJsonFor(null);
      setLivePhraseFor(null);
      setLivePhrase("");
    } catch (err) {
      setError({
        caseId: fraudCase.case_id,
        message: err instanceof Error ? err.message : "Call failed",
      });
    } finally {
      setCallingCaseId(null);
      setElapsedMs(0);
    }
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border/80 bg-card/40">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Phone className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                CALL-E · Fraud ops
              </p>
              <h1 className="text-lg font-semibold tracking-tight">
                Fraud Ops Caller
              </h1>
              <p className="text-sm text-muted-foreground">
                Risk case fires → agent dials → structured outcome writes back.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">4 intents · one runtime</Badge>
            <Badge variant="secondary">CALL-E plan-first</Badge>
            <Badge variant="outline">{liveAvailable ? "live ready" : "demo"}</Badge>
            <Badge variant={authed ? "secondary" : "outline"}>
              {authed ? "operator unlocked" : "locked"}
            </Badge>
          </div>
        </div>
        {!authConfigured ? (
          <p className="mx-auto w-full max-w-[1400px] px-4 pb-4 text-xs text-muted-foreground">
            Set <span className="font-mono">OPS_RUN_SECRET</span> on the server. The confirm
            phrase is not access control.
          </p>
        ) : !authed ? (
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs text-muted-foreground">
              Operator secret
              <input
                type="password"
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                value={opsSecret}
                onChange={(e) => setOpsSecret(e.target.value)}
              />
            </label>
            <Button size="sm" disabled={!opsSecret} onClick={() => void unlockOperator()}>
              Unlock desk
            </Button>
          </div>
        ) : null}
      </header>

      <main
        className={cn(
          "mx-auto grid w-full max-w-[1400px] flex-1 grid-cols-1 gap-4 px-4 py-4",
          isInvestigation
            ? "lg:grid-cols-[260px_minmax(0,1fr)]"
            : "lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]"
        )}
      >
        <QueueList
          rows={QUEUE}
          selectedKey={selectedKey}
          outcomes={outcomes}
          onSelect={setSelectedKey}
        />

        {row && isInvestigation ? (
          <InvestigationPane
            row={row}
            outcomes={outcomes}
            callingCaseId={callingCaseId}
            elapsedMs={elapsedMs}
            error={error}
            showJsonFor={showJsonFor}
            onToggleJson={setShowJsonFor}
            liveAvailable={liveAvailable}
            livePhraseFor={livePhraseFor}
            livePhrase={livePhrase}
            setLivePhraseFor={setLivePhraseFor}
            setLivePhrase={setLivePhrase}
            onConfirm={onConfirm}
            authed={authed}
          />
        ) : row ? (
          <>
            <CasePack
              fraudCase={row.cases[0]}
              calling={callingCaseId === row.cases[0].case_id}
              dialLocked={Boolean(callingCaseId)}
              elapsedMs={elapsedMs}
              error={error?.caseId === row.cases[0].case_id ? error.message : null}
              liveAvailable={liveAvailable}
              livePhraseFor={livePhraseFor}
              livePhrase={livePhrase}
              setLivePhraseFor={setLivePhraseFor}
              setLivePhrase={setLivePhrase}
              onConfirm={onConfirm}
              authed={authed}
            />
            <OutcomePane
              fraudCase={row.cases[0]}
              outcome={outcomes[row.cases[0].case_id]}
              calling={callingCaseId === row.cases[0].case_id}
              elapsedMs={elapsedMs}
              showJson={showJsonFor === row.cases[0].case_id}
              onToggleJson={() =>
                setShowJsonFor((id) =>
                  id === row.cases[0].case_id ? null : row.cases[0].case_id
                )
              }
            />
          </>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Select a case</CardTitle>
              <CardDescription>
                Pick KYC, evidence, collections, or merchant from the queue.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </main>

      <footer className="mt-auto border-t border-border/80 bg-card/30">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-4 text-xs leading-relaxed text-muted-foreground lg:flex-row lg:items-start lg:justify-between">
          <div className="flex gap-2">
            <Shield className="mt-0.5 size-3.5 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Hard rails.</span> No
              PAN, CVV, or full national ID on the call. Never invent fees. Never
              allege merchant guilt. HOLD if identity fails. Quiet hours and
              attempt caps apply.
            </p>
          </div>
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>
              <span className="font-medium text-foreground">Evidence rails.</span>{" "}
              Do not share the other party’s statement. No leading or coaching.
              Passwords and PAN are not evidence. Share link is voluntary. If
              there is ongoing danger → <span className="font-mono">unsafe_escalate</span>{" "}
              and a human immediately.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function QueueList({
  rows,
  selectedKey,
  outcomes,
  onSelect,
}: {
  rows: QueueRow[];
  selectedKey: string;
  outcomes: Record<string, FraudOpsOutcome>;
  onSelect: (key: string) => void;
}) {
  return (
    <section aria-label="Case queue" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Queue</h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} rows · {MOCK_CASES.length} cases
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {rows.map((item) => {
          const active = item.key === selectedKey;
          const doneCount = item.cases.filter((c) => outcomes[c.case_id]).length;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={cn(
                "min-w-[220px] rounded-xl border px-3 py-3 text-left transition-colors lg:min-w-0",
                active
                  ? "border-primary bg-card ring-2 ring-ring/40"
                  : "border-border bg-card/50 hover:bg-card"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant={active ? "default" : "secondary"}>
                  {INTENT_LABEL[item.intent]}
                </Badge>
                {doneCount ? (
                  <span className="text-[11px] text-muted-foreground">
                    {doneCount}/{item.cases.length} in
                  </span>
                ) : null}
              </div>
              <p className="mt-2 font-mono text-xs">
                {item.cases.length > 1
                  ? item.cases.map((c) => c.case_id.replace("case_demo_", "")).join(" · ")
                  : item.title}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {item.summary}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function InvestigationPane({
  row,
  outcomes,
  callingCaseId,
  elapsedMs,
  error,
  showJsonFor,
  onToggleJson,
  liveAvailable,
  livePhraseFor,
  livePhrase,
  setLivePhraseFor,
  setLivePhrase,
  onConfirm,
  authed,
}: {
  row: QueueRow;
  outcomes: Record<string, FraudOpsOutcome>;
  callingCaseId: string | null;
  elapsedMs: number;
  error: { caseId: string; message: string } | null;
  showJsonFor: string | null;
  onToggleJson: (id: string | null) => void;
  liveAvailable: boolean;
  livePhraseFor: string | null;
  livePhrase: string;
  setLivePhraseFor: (id: string | null) => void;
  setLivePhrase: (value: string) => void;
  onConfirm: (fraudCase: FraudOpsCase, mode: "demo" | "live") => void;
  authed: boolean;
}) {
  const lead = row.cases[0];
  return (
    <section aria-label="Evidence investigation" className="flex min-w-0 flex-col gap-4">
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Evidence collection</Badge>
            <Badge variant="outline">{lead.pack_fired}</Badge>
            {lead.safety_sensitive ? (
              <Badge variant="destructive">safety_sensitive</Badge>
            ) : null}
          </div>
          <CardTitle>Both parties · one investigation</CardTitle>
          <CardDescription>
            {lead.incident_summary_plain ?? lead.reason_plain}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          Place a call per party. Outcomes stay side by side and must never quote
          the counterpart. Share links are party-specific and voluntary.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {row.cases.map((fraudCase) => (
          <div key={fraudCase.case_id} className="flex min-w-0 flex-col gap-3">
            <CasePack
              fraudCase={fraudCase}
              calling={callingCaseId === fraudCase.case_id}
              dialLocked={Boolean(callingCaseId)}
              elapsedMs={elapsedMs}
              error={error?.caseId === fraudCase.case_id ? error.message : null}
              compact
              liveAvailable={liveAvailable}
              livePhraseFor={livePhraseFor}
              livePhrase={livePhrase}
              setLivePhraseFor={setLivePhraseFor}
              setLivePhrase={setLivePhrase}
              onConfirm={onConfirm}
              authed={authed}
            />
            <OutcomePane
              fraudCase={fraudCase}
              outcome={outcomes[fraudCase.case_id]}
              calling={callingCaseId === fraudCase.case_id}
              elapsedMs={elapsedMs}
              showJson={showJsonFor === fraudCase.case_id}
              compact
              onToggleJson={() =>
                onToggleJson(
                  showJsonFor === fraudCase.case_id ? null : fraudCase.case_id
                )
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function CasePack({
  fraudCase,
  calling,
  dialLocked,
  elapsedMs,
  error,
  liveAvailable,
  livePhraseFor,
  livePhrase,
  setLivePhraseFor,
  setLivePhrase,
  onConfirm,
  authed,
  compact,
}: {
  fraudCase: FraudOpsCase;
  calling: boolean;
  dialLocked: boolean;
  elapsedMs: number;
  error: string | null;
  liveAvailable: boolean;
  livePhraseFor: string | null;
  livePhrase: string;
  setLivePhraseFor: (id: string | null) => void;
  setLivePhrase: (value: string) => void;
  onConfirm: (fraudCase: FraudOpsCase, mode: "demo" | "live") => void;
  authed: boolean;
  compact?: boolean;
}) {
  const gate = useMemo(() => evaluateGate(fraudCase), [fraudCase]);
  const caseIssues = validateCase(fraudCase);

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{INTENT_LABEL[fraudCase.intent]}</Badge>
          <Badge variant="outline">{fraudCase.pack_fired}</Badge>
          {fraudCase.contact.role === "complainant" ||
          fraudCase.contact.role === "respondent" ? (
            <Badge variant="secondary">{fraudCase.contact.role}</Badge>
          ) : null}
        </div>
        <CardTitle className="font-mono text-sm sm:text-base">
          {fraudCase.case_id}
        </CardTitle>
        <CardDescription>{fraudCase.reason_plain}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        {caseIssues.length > 0 ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Case failed schema: {caseIssues.join(", ")}
          </p>
        ) : null}

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Field
            label="Contact"
            value={`${fraudCase.contact.name} · ${fraudCase.contact.role}`}
          />
          <Field
            label="Phone"
            value={
              fraudCase.contact.phone_e164.includes("*")
                ? fraudCase.contact.phone_e164
                : maskE164(fraudCase.contact.phone_e164)
            }
            mono
          />
          {!compact ? <Field label="Locale" value={fraudCase.contact.locale} /> : null}
          <Field
            label="Attempt"
            value={`${fraudCase.policy.attempt_n} / ${fraudCase.policy.max_attempts}`}
          />
          {fraudCase.counterpart_case_id ? (
            <Field label="Counterpart" value={fraudCase.counterpart_case_id} mono />
          ) : null}
          {formatMoney(fraudCase.context.amount_due, fraudCase.context.currency) ? (
            <Field
              label="Amount due"
              value={
                formatMoney(fraudCase.context.amount_due, fraudCase.context.currency) ??
                ""
              }
            />
          ) : null}
          {fraudCase.context.days_late !== undefined ? (
            <Field label="Days late" value={`${fraudCase.context.days_late} DPD`} />
          ) : null}
          {fraudCase.context.merchant_name ? (
            <Field label="Merchant" value={fraudCase.context.merchant_name} />
          ) : null}
          {fraudCase.context.missing_docs?.length ? (
            <Field
              label={fraudCase.intent === "evidence_collection" ? "Ask for" : "Missing docs"}
              value={fraudCase.context.missing_docs.join(", ")}
            />
          ) : null}
        </dl>

        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Deep links
          </p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(fraudCase.deep_links).map(([key, href]) =>
              href ? (
                <a
                  key={key}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 truncate font-mono text-xs text-foreground underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="text-muted-foreground">{key}</span>
                  <span className="truncate">{href}</span>
                </a>
              ) : null
            )}
          </div>
        </div>

        {gate ? (
          <div className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <p className="font-medium">
              {gate.automate ? "Automate: yes" : "Automate: blocked"}
            </p>
            <p className="mt-1 text-muted-foreground">{gate.reasons.join(" · ")}</p>
          </div>
        ) : null}

        <PlanPanel fraudCase={fraudCase} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            size="lg"
            className="h-10 px-4"
            disabled={dialLocked || caseIssues.length > 0 || !gate.automate || !authed}
            onClick={() => onConfirm(fraudCase, "demo")}
          >
            {calling ? (
              <>
                <PhoneCall className="size-4 animate-pulse" />
                On call {elapsedLabel(elapsedMs)}
              </>
            ) : (
              <>
                <PhoneCall className="size-4" />
                Confirm demo call
              </>
            )}
          </Button>
          {liveAvailable ? (
            <Button
              size="lg"
              variant="outline"
              disabled={dialLocked || caseIssues.length > 0 || !gate.automate || !authed}
              onClick={() => setLivePhraseFor(fraudCase.case_id)}
            >
              Confirm live call
            </Button>
          ) : null}
        </div>
        {livePhraseFor === fraudCase.case_id ? (
          <div className="flex flex-col gap-2">
            <label className="text-xs text-muted-foreground">
              Type exactly: {LIVE_CONFIRM_PHRASE}
              <input
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-xs"
                value={livePhrase}
                onChange={(e) => setLivePhrase(e.target.value)}
              />
            </label>
            <Button
              disabled={livePhrase !== LIVE_CONFIRM_PHRASE || dialLocked || !authed}
              onClick={() => onConfirm(fraudCase, "live")}
            >
              Place live call
            </Button>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OutcomePane({
  fraudCase,
  outcome,
  calling,
  elapsedMs,
  showJson,
  onToggleJson,
  compact,
}: {
  fraudCase: FraudOpsCase;
  outcome?: FraudOpsOutcome;
  calling: boolean;
  elapsedMs: number;
  showJson: boolean;
  onToggleJson: () => void;
  compact?: boolean;
}) {
  if (!outcome && !calling) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Outcome</CardTitle>
          <CardDescription>
            {compact
              ? `Waiting for the ${fraudCase.contact.role} call.`
              : "Confirm a demo call to write disposition, quotes, next action, and a recording placeholder back to the case."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (calling) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Calling {fraudCase.contact.name}…</CardTitle>
          <CardDescription>
            Stub dial in progress for {INTENT_LABEL[fraudCase.intent]}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-4">
            <PhoneCall className="size-5 animate-pulse" />
            <div>
              <p className="font-mono text-lg">{elapsedLabel(elapsedMs)}</p>
              <p className="text-xs text-muted-foreground">
                recording_id reserved as rec_pending_calle_swap
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!outcome) return null;

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{outcome.disposition}</Badge>
          <Badge variant="outline">{outcome.recording_id}</Badge>
        </div>
        <CardTitle>Outcome · {fraudCase.contact.role}</CardTitle>
        <CardDescription className="font-mono text-xs">{outcome.call_id}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <Field label="Next action" value={outcome.next_action} />
        <div>
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Quotes
          </p>
          <ul className="space-y-1 text-sm">
            {outcome.quotes.map((quote) => (
              <li key={quote} className="border-l-2 border-border pl-3">
                “{quote}”
              </li>
            ))}
          </ul>
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {outcome.fields.ptp_date ? (
            <Field label="PTP date" value={outcome.fields.ptp_date} mono />
          ) : null}
          {outcome.fields.missing_docs?.length ? (
            <Field label="Docs still open" value={outcome.fields.missing_docs.join(", ")} />
          ) : null}
          {outcome.fields.contact_role ? (
            <Field label="Contact role" value={outcome.fields.contact_role} />
          ) : null}
          {outcome.fields.callback_at ? (
            <Field label="Callback" value={outcome.fields.callback_at} mono />
          ) : null}
          {outcome.fields.handoff_reason ? (
            <Field label="Handoff" value={outcome.fields.handoff_reason} />
          ) : null}
        </div>
        <div>
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Transcript snippet
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted/70 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {outcome.transcript_snippet}
          </pre>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">ended_at {outcome.ended_at}</p>
          <Button variant="ghost" size="sm" onClick={onToggleJson}>
            {showJson ? "Hide JSON" : "Show JSON"}
          </Button>
        </div>
        {showJson ? (
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(outcome, null, 2)}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PlanPanel({ fraudCase }: { fraudCase: FraudOpsCase }) {
  const opening = nvcFrameForCase(fraudCase);
  const tools = toolsForIntent(fraudCase.intent, fraudCase.safety_sensitive);
  const sla = demoSlaHours(fraudCase);
  const task = buildCalleTaskPrompt(fraudCase);
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Call plan · {maskE164(fraudCase.contact.phone_e164)}
      </p>
      <dl className="mt-2 grid gap-1.5">
        <dt className="text-xs text-muted-foreground">Observation</dt>
        <dd>{opening.observation}</dd>
        <dt className="text-xs text-muted-foreground">Feeling</dt>
        <dd>{opening.feeling}</dd>
        <dt className="text-xs text-muted-foreground">Need</dt>
        <dd>{opening.need}</dd>
        <dt className="text-xs text-muted-foreground">Request</dt>
        <dd>{opening.request}</dd>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Hostility: never scold. Absorb → Separate → Pivot → Bound. Two-strike → senior specialist.
      </p>
      <p className="mt-1 font-mono text-xs">Tools: {tools.join(", ")}</p>
      {sla !== null ? (
        <p className="mt-1 text-xs">Demo follow-up SLA: {sla}h</p>
      ) : null}
      <p className="mt-1 font-mono text-xs">
        Dispositions: {DISPOSITIONS[fraudCase.intent].join(", ")}
      </p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
        {task}
      </pre>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className={cn("mt-0.5 text-sm", mono && "font-mono text-xs sm:text-sm")}>
        {value}
      </dd>
    </div>
  );
}
