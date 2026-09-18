"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneCall, RotateCcw, ArrowRight, TriangleAlert } from "lucide-react";

import type { CallTargetInput, CampaignContextInput } from "./LiveCallCard";
import { CheckForUpdates } from "@/components/calle/CheckForUpdates";
import { DialTarget } from "@/components/calle/DialTarget";
import { readJson } from "@/lib/read-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface PlanRow {
  name: string;
  type: "station" | "creator";
  channel: string;
  verdict: string;
  price: number | null;
  rateBasis?: string;
  /** The provider's call id. Carried onto the row so it is on screen and
   *  selectable rather than living only in the polling closure. */
  callId?: string;
  rateConfirmed?: boolean | null;
  confidenceLabel?: string;
  evidence?: string[];
  reach: number;
  detail: string;
  score: number;
  summary?: string;
  mock?: boolean;
}

const money = (v: number | null, cur = "PKR") =>
  typeof v === "number" ? `${cur} ${v.toLocaleString()}` : "—";
const POLL_MS = 4000;
const MAX_MS = 3 * 60 * 1000;

/**
 * "Call the shortlist" — starts a call per target, then polls each to completion
 * and ranks them. Simulates only when no key is set; failed calls show honestly.
 */
/** Verdict tone as a token NAME - section 9. Was four hex values with alpha
 *  concatenated on. Mirrors LiveCallCard so one verdict reads the same in
 *  both places. */
const VERDICT_VARIANT: Record<string, "lilac" | "butter" | "destructive" | "muted"> = {
  yes: "lilac",
  no: "destructive",
  unknown: "butter",
};

/** One row of the batch route's preview: what this target would dial. */
interface PreviewTarget {
  name: string;
  phone: string | null;
  numberSource: string;
  note?: string;
  sharesWith: string[];
  /** Set when another target holds this number first, so this one has to wait
   *  - two calls to one handset at the same moment come back 486 Busy. */
  queuedBehind: string | null;
}

export default function BatchCallPanel({
  targets,
  context,
}: {
  targets: CallTargetInput[];
  context: CampaignContextInput;
}) {
  const [phase, setPhase] = useState<"idle" | "calling" | "done" | "error">("idle");
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  /* Targets that resolved to a number another target was already calling.
     They are reported rather than dialled - see the batch route. */
  const [shared, setShared] = useState<{ phone: string; called: string; alsoResolvedTo: string[] }[]>([]);
  /* What each target would dial, resolved by the SAME code the call uses -
     see the preview branch in app/api/calle/batch/route.ts. The panel used to
     send the shortlist blind and learn afterwards which numbers it had used,
     including that two targets had collapsed onto one and one of them had been
     dropped. */
  const [plan, setPlan] = useState<PreviewTarget[] | null>(null);
  /* Per-target overrides, keyed by name. A target sent with `phone` set wins
     over the contact book, so editing here changes what is dialled. */
  const [edited, setEdited] = useState<Record<string, string>>({});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cur = context.currency ?? "PKR";

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /* Resolve on mount so the numbers are on screen BEFORE anything is dialled,
     which is the whole point - they were previously only knowable afterwards. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/calle/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targets, context, preview: true }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.targets)) setPlan(data.targets);
      } catch { /* the panel still works without it; the call path resolves anyway */ }
    })();
    return () => { alive = false; };
  }, [targets, context]);

  /* Targets carrying whatever the user typed. */
  const withEdits = () =>
    targets.map(t => {
      const typed = (edited[t.name] ?? "").trim();
      return typed ? { ...t, phone: typed } : t;
    });

  function failedRow(t: CallTargetInput, label: string): PlanRow {
    return {
      name: t.name,
      type: t.type,
      channel: t.channel ?? "",
      verdict: label,
      price: null,
      reach: t.audienceSize ?? 0,
      detail: "",
      score: 0,
    };
  }

  function pollOne(callId: string, target: CallTargetInput): Promise<PlanRow> {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const step = async () => {
        if (Date.now() - startedAt > MAX_MS) return resolve(failedRow(target, "timeout"));
        try {
          const res = await fetch("/api/calle/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callId, target, context: context ?? {} }),
          });
          const { ok, data, error: readError } = await readJson<{
            done?: boolean;
            failed?: boolean;
            row?: PlanRow;
          }>(res);
          /* A non-JSON body means the poll function was killed, not that the
             call failed - keep polling until MAX_MS says otherwise. */
          if (readError) {
            const retry = setTimeout(step, POLL_MS);
            timers.current.push(retry);
            return;
          }
          if (!ok || !data) return resolve(failedRow(target, "error"));
          if (!data.done) {
            const t = setTimeout(step, POLL_MS);
            timers.current.push(t);
            return;
          }
          if (data.failed || !data.row) return resolve(failedRow(target, "failed"));
          resolve(data.row as PlanRow);
        } catch {
          resolve(failedRow(target, "error"));
        }
      };
      step();
    });
  }

  function finalize(all: PlanRow[]) {
    all.sort((a, b) => b.score - a.score);
    setRows(all);
    setPhase("done");
  }

  async function run() {
    setPhase("calling");
    setError("");
    setRows([]);
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await fetch("/api/calle/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: withEdits(), context }),
      });
      const { ok, data, error: readError } = await readJson<{
        error?: string;
        mode?: string;
        rows?: PlanRow[];
        items?: { name: string; target: CallTargetInput; callId?: string; error?: string }[];
        shared?: { phone: string; called: string; alsoResolvedTo: string[] }[];
      }>(res);
      if (readError || !ok || !data) {
        setError(readError || data?.error || "Batch failed.");
        setPhase("error");
        return;
      }

      if (data.mode === "mock") {
        setLive(false);
        finalize(data.rows as PlanRow[]);
        return;
      }

      // Live: poll each created call.
      setLive(true);
      setShared(Array.isArray(data.shared) ? data.shared : []);
      const items = (data.items ?? []) as {
        name: string;
        target: CallTargetInput;
        callId?: string;
        error?: string;
      }[];
      setProgress({ done: 0, total: items.length });
      const collected: PlanRow[] = [];
      let done = 0;
      await Promise.all(
        items.map(async (it) => {
          const row = it.callId
            ? await pollOne(it.callId, it.target).then(r => ({ ...r, callId: it.callId }))
            : failedRow(it.target, "no phone");
          collected.push(row);
          done += 1;
          setProgress({ done, total: items.length });
        })
      );
      finalize(collected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const verdictVariant = (v: string) => VERDICT_VARIANT[v] ?? "muted";

  const available = rows.filter((r) => r.verdict === "yes");
  const estSpend = available.reduce((s, r) => s + (typeof r.price === "number" ? r.price : 0), 0);

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-3">
          <Phone aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-small font-medium text-text">Verify the whole shortlist by phone</span>
            <span className="text-small text-text-muted">
              Arc calls all {targets.length}{" "}
              contacts and returns verified availability, rate &amp; reach — ranked.
            </span>
          </div>
          <Badge variant={live ? "lilac" : "muted"}>
            {phase === "done" && live ? "LIVE CALLS" : phase === "done" ? "SIMULATED" : "CALL-E"}
          </Badge>
        </div>

        {phase === "idle" && (
          <div className="flex flex-col gap-3">
            {/* Every target, with the number it would dial, editable before
                anything rings. This panel used to show one number field for
                the whole shortlist and nothing about which target got what. */}
            {plan ? (
              <ul className="flex flex-col gap-2">
                {plan.map(t => (
                  <li key={t.name} className="flex flex-wrap items-center gap-2 rounded-control bg-bone px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-small text-text">{t.name}</span>
                    <input
                      value={edited[t.name] ?? t.phone ?? ""}
                      onChange={e => setEdited(p => ({ ...p, [t.name]: e.target.value }))}
                      placeholder="+92…"
                      aria-label={`Number to dial for ${t.name}`}
                      className="type-data w-44 rounded-control border border-border bg-surface px-2 py-1 text-text outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                    />
                    {t.phone == null && <Badge variant="outline">No number</Badge>}
                    {t.queuedBehind && (
                      <Badge variant="butter">After {t.queuedBehind}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <DialTarget typed="" />
            )}
            <Button onClick={run} className="w-full">
              Call all {targets.length} &amp; verify rates
              <ArrowRight aria-hidden strokeWidth={1.75} />
            </Button>
          </div>
        )}

        {shared.length > 0 && (
          <div className="flex items-start gap-3 rounded-control bg-butter px-4 py-3" role="status">
            <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-ink" />
            <p className="text-small leading-relaxed text-ink">
              {shared.map(s => (
                <span key={s.phone} className="block">
                  {s.alsoResolvedTo.length + 1} targets share {s.phone}. Arc called{" "}
                  <strong className="font-medium">{s.called}</strong> —{" "}
                  {s.alsoResolvedTo.join(", ")} {s.alsoResolvedTo.length === 1 ? "has" : "have"} to
                  wait, because two calls to one handset at the same moment come back busy. Call{" "}
                  {s.alsoResolvedTo.length === 1 ? "it" : "them"} again once this call ends, or give{" "}
                  {s.alsoResolvedTo.length === 1 ? "it" : "each"} its own number above.
                </span>
              ))}
            </p>
          </div>
        )}

        {phase === "calling" && (
          <div className="flex items-center gap-3 rounded-control bg-bone p-4" role="status" aria-live="polite">
            <PhoneCall
              aria-hidden
              strokeWidth={1.75}
              className="size-4 shrink-0 text-text motion-safe:animate-[callePulse_1s_ease-in-out_infinite]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-small text-text">
              {live ? `Calling… ${progress.done}/${progress.total} finished` : "Starting calls…"}
            </span>
              {/* Measured: CALL-E queues roughly 14 seconds before it even
                  starts, then the phone rings. Without this the wait reads as
                  the app having hung. */}
              <span className="text-small text-text-muted">
                Calls usually take 30-60 seconds to connect
              </span>
            </span>
            <style>{`@keyframes callePulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
          </div>
        )}

        {phase === "done" && (
          <div className="flex flex-col gap-4">
            {/* Calls this panel gave up on at the wall can still land later.
                The rows here came from its own polling, so this reports what
                settled rather than redrawing the table - the settled result is
                on the campaign's plan. */}
            <CheckForUpdates />

            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Available" value={`${available.length}/${rows.length}`} />
              <Stat label="Est. spend" value={money(estSpend, cur)} />
              <Stat label="Budget" value={money(context.budgetTotal ?? 0, cur)} />
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Avail</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Reach</TableHead>
                    <TableHead className="text-right">Fit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    /* The top row is the ranked pick, so it carries the one
                       tint in the table rather than a whole extra column. */
                    <TableRow key={r.name} className={i === 0 ? "bg-lilac/40" : undefined}>
                      <TableCell className="type-data text-text-muted">{i + 1}</TableCell>
                      <TableCell>
                        <span className="flex flex-col gap-0.5">
                          <span className="max-w-44 truncate font-medium text-text">{r.name}</span>
                          {r.detail && <span className="text-small text-text-muted">{r.detail}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="text-text-muted">
                        <span className="capitalize">{r.type}</span>
                        {r.callId && (
                          <span className="block select-all font-mono text-small text-text-muted">
                            {r.callId}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={verdictVariant(r.verdict)}>{r.verdict}</Badge>
                      </TableCell>
                      <TableCell className="type-data text-right text-text">
                        {money(r.price, cur)}
                        {/* Without this the column is a list of numbers that
                            do not necessarily buy the same thing. */}
                        {r.rateBasis && (
                          <span className="block text-small font-normal text-text-muted">{r.rateBasis}</span>
                        )}
                        {/* A rate the recipient never confirmed reads exactly
                            like one they did, which is how a misheard 8,000
                            got onto a plan. It says so here or it is a lie by
                            omission. */}
                        {typeof r.price === "number" && r.rateConfirmed !== true && (
                          <span className="block text-small font-normal text-warning">
                            {r.rateConfirmed === false ? "unconfirmed" : "confirmation unknown"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="type-data text-right text-text">{r.reach.toLocaleString()}</TableCell>
                      <TableCell className="type-data text-right text-text">{r.score}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* CALL-E's own account of each call, which we used to discard.
                On 1 Sep it reported "The bot did not repeat back or clarify
                the rate before moving to later questions" - the reason a
                wrong rate looked clean - and nothing was reading it. Kept
                below the table rather than inside it: it is prose, and a
                ranked table is not the place to hide prose. */}
            {rows.some(r => r.evidence && r.evidence.length > 0) && (
              <div className="flex flex-col gap-3 rounded-md border border-hairline p-4">
                <span className="type-label text-text-muted">What CALL-E made of these calls</span>
                {rows.filter(r => r.evidence && r.evidence.length > 0).map(r => (
                  <div key={r.name} className="flex flex-col gap-1">
                    <span className="text-small font-medium text-text">
                      {r.name}
                      {r.confidenceLabel ? (
                        <span className="font-normal text-text-muted"> · confidence {r.confidenceLabel}</span>
                      ) : null}
                    </span>
                    <ul className="flex list-disc flex-col gap-1 pl-4">
                      {r.evidence!.map((e, i) => (
                        <li key={i} className="text-small text-text-muted">{e}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            <Button variant="outline" size="sm" onClick={run} className="w-fit">
              <RotateCcw aria-hidden strokeWidth={1.75} />
              Re-run calls
            </Button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-3 rounded-control bg-danger-bg p-4" role="alert">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
              <p className="text-small leading-relaxed text-danger">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={run} className="w-fit">
              <RotateCcw aria-hidden strokeWidth={1.75} />
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-bone p-4">
      <span className="font-display text-h2 leading-none text-text">{value}</span>
      <span className="type-label text-text-muted">{label}</span>
    </div>
  );
}
