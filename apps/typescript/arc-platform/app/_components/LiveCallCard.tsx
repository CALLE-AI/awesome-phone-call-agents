"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneCall, RotateCcw, ArrowRight, TriangleAlert } from "lucide-react";

import { DialTarget } from "@/components/calle/DialTarget";
import { readJson } from "@/lib/read-json";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface CallTargetInput {
  name: string;
  type: "station" | "creator";
  channel?: string;
  phone?: string;
  /** Catalogue id. Sent so the SERVER can look up a number in ARC_CONTACTS -
   *  the contact book is never shipped to the browser, so the client cannot
   *  supply the number itself and must name the target instead. */
  externalId?: string;
  contactName?: string;
  audienceSize?: number;
  /** The catalogue's rate estimate for this line. The server builds the
   *  negotiation mandate from it; with none the call runs as a plain enquiry.
   *  It is a reference price we already hold, not a number from the browser
   *  that anything is trusted to. */
  estimatePkr?: number | null;
}

export interface CampaignContextInput {
  advertiser?: string;
  campaignName?: string;
  market?: string;
  flightStart?: string;
  flightEnd?: string;
  audience?: string;
  budgetTotal?: number;
  currency?: string;
}

interface ResultRow {
  verdict: string;
  price: number | null;
  /** What the price covers, as the recipient described it. */
  rateBasis?: string;
  rateConfirmed?: boolean | null;
  /* The negotiation. Absent on a call placed without a mandate. */
  openingPrice?: number | null;
  mandateTarget?: number | null;
  mandateWalkAway?: number | null;
  concessions?: { offered: string; response: string; rateAfter: number | null }[];
  confidenceLabel?: string;
  evidence?: string[];
  reach: number;
  detail: string;
  notes: string;
  summary?: string;
  mock?: boolean;
}

const POLL_MS = 4000;
/* Twenty minutes, and the number is about CALL-E's QUEUE, not our conversations.
   Eight minutes was set against talk time, which runs to roughly three or four
   minutes - and held until the queue itself grew past it, to the better part of
   ten minutes, with one request never dialled at all. A call once cleared the
   eight-minute wall while still queued, so we stopped polling and threw away a
   completed call that had returned a rate.
   The wall is now well past the worst queue we have measured, and it is no
   longer the only safety net: /api/calle/reconcile picks up anything that
   outlives even this. Overridable because the ceiling is the provider's to
   move, not ours. */
const MAX_MS = Number(process.env.NEXT_PUBLIC_CALLE_MAX_WAIT_MS ?? 20 * 60 * 1000);

const PHONE_KEY = "arc_calle_phone";

/** Minutes and seconds past a minute. A queue measured in hundreds of seconds
 *  reads as a number; "9m 20s" reads as a wait. */
function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * What the user is told when a call will not start.
 *
 * `needsPhone` is the one failure we can give instructions for, so it gets
 * them. Everything else gets the reason.
 *
 * This used to answer every other failure with "Check the number is in
 * international format (+92…)". On 2 September that message was shown for a
 * perfectly valid PK mobile number, because the number was never the problem -
 * a route that 404s "Campaign line not found", a provider that times out, a
 * database that will not write, all arrived as advice about formatting. The
 * one person who could have diagnosed it was told to check something that was
 * already correct, and the real reason existed only in a server log.
 *
 * A wrong explanation is worse than a blunt one: it sends the reader to fix
 * the wrong thing.
 */
function startFailureMessage(data: { error?: string; needsPhone?: boolean; inFlight?: boolean }): string {
  if (data.needsPhone) {
    return "Enter the number to call, in international format — e.g. +923001234567.";
  }
  /* Not a failure to start - a refusal to start, and the message already says
     why in full. Prefixing it with "Couldn't start the call" would read as
     something going wrong when the point is that nothing did. */
  if (data.inFlight && data.error) return data.error;
  const reason = (data.error ?? "").trim();
  return reason
    ? `Couldn't start the call: ${reason}`
    : "Couldn't start the call, and the server gave no reason. Check the Vercel function log for /api/calle/confirm.";
}

/**
 * "Get live avails & rate" — starts a real CALL-E call, then polls until it
 * completes. Only simulates when no key is configured (badge shows which). On a
 * failed/timed-out live call it shows an honest failure, never fake data.
 */
/** Verdict tone as a token NAME - section 9. The old map held #0D9488,
 *  #EF4444 and #F59E0B and concatenated alpha onto them. "no" is the outlined
 *  destructive variant rather than a pink fill: a declined station is a fact,
 *  not an alarm. */
const VERDICT_VARIANT: Record<string, "lilac" | "butter" | "destructive"> = {
  yes: "lilac",
  no: "destructive",
  unknown: "butter",
};

export default function LiveCallCard({
  target,
  context,
  campaignId,
  mediaPlanItemId,
}: {
  target: CallTargetInput;
  context?: CampaignContextInput;
  /** Set when the call is placed from a campaign's media plan, so the result
   *  lands on that line instead of being matched by name afterwards. */
  campaignId?: string;
  mediaPlanItemId?: string;
}) {
  /* "stalled" is not "error": the call may well still be running, and saying
     so is different from saying it failed. */
  const [phase, setPhase] = useState<"idle" | "calling" | "done" | "stalled" | "error">("idle");
  /* Set when a status read fails but the CALL is fine. A poll that could not
     be answered says nothing about the conversation, and once it
     was ending the card mid-call with a red panel while the operator was
     still talking. */
  const [waiting, setWaiting] = useState<string | null>(null);
  const [row, setRow] = useState<ResultRow | null>(null);
  const [live, setLive] = useState(false);
  /** The provider's id for the call in flight. On screen because recovering a
   *  call afterwards needs it and nothing else does. */
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  /* CALL-E's own status string, not our phase. "queued" means the request is
     accepted and waiting - nothing is ringing. Treating that as "on the call"
     is what put "On the call with Mast FM 103… 161s" on screen while the
     handset sat silent, and the same contradiction again at 173s. */
  const [callStatus, setCallStatus] = useState("queued");
  /* Seconds spent queued before CALL-E started dialling, captured once. Null
     while still waiting. This has run to several minutes, and once to never -
     so it is shown, not hidden. */
  const [queuedFor, setQueuedFor] = useState<number | null>(null);
  /* Remembered per browser, not per user: this is "a number you can answer
     right now", not a business contact detail, so it does not belong in the
     database. localStorage keeps the demo from becoming a retyping exercise
     without Arc storing anyone's phone number. */
  const [phoneInput, setPhoneInput] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PHONE_KEY);
      if (saved) setPhoneInput(saved);
    } catch { /* private mode - the field just starts empty */ }
  }, []);
  /* Timer bookkeeping.
   *
   * The elapsed counter is driven by a 1s setInterval. It used to be pushed
   * into the same array as the poll timeouts and cleared only on unmount, so:
   *
   *   - when a call finished, the interval kept firing setElapsed every second
   *     for as long as the card stayed mounted, re-rendering a finished card
   *     with a counter that no longer meant anything; and
   *   - "Call again" started a SECOND interval while the first was still
   *     running, each with its own startedAt, so the two fought over `elapsed`
   *     and the number visibly jumped. Every retry added another one.
   *
   * The interval now has its own ref and is stopped on every terminal path.
   * The array holds only timeouts, and is cleared with clearTimeout, which is
   * what it always should have been - the old code passed an interval id to
   * clearTimeout and only worked because browsers share one id namespace. */
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  function stopTicker() {
    if (ticker.current !== null) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
  }

  function stopAll() {
    stopTicker();
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
  }

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      stopAll();
    };
  }, []);

  const cta = target.type === "station" ? "Get live avails & rate" : "Confirm booking by phone";
  const verb = target.type === "station" ? "Availability" : "Interested";

  function fail(msg: string) {
    // Terminal: nothing is still counting up after this.
    stopAll();
    if (cancelled.current) return;
    setError(msg);
    setPhase("error");
  }

  async function start() {
    try {
      if (phoneInput.trim()) localStorage.setItem(PHONE_KEY, phoneInput.trim());
    } catch { /* private mode - remembering is a convenience, never required */ }
    const typed = phoneInput.trim();
    if (typed && !/^\+[1-9]\d{7,14}$/.test(typed)) {
      return fail("Enter a full international number, e.g. +12025550100 (country code required).");
    }
    // "Call again" runs through here, so anything still live from the previous
    // attempt stops before a new ticker starts.
    stopAll();
    setError("");
    setRow(null);
    setElapsed(0);
    setCallStatus("queued");
    setQueuedFor(null);
    setPhase("calling");
    try {
      const res = await fetch("/api/calle/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: { ...target, phone: phoneInput.trim() || target.phone },
          context: context ?? {},
          campaignId,
          mediaPlanItemId,
        }),
      });
      const { ok, data, error: readError } = await readJson<{
        error?: string;
        needsPhone?: boolean;
        inFlight?: boolean;
        done?: boolean;
        row?: ResultRow;
        callId?: string;
      }>(res);
      /* The body was not JSON - a timed-out function or an expired session,
         not a call that failed. Say which, rather than handing the user a
         JSON.parse message. */
      if (readError) return fail(readError);
      if (!ok || !data) {
        // Keep the provider's own words where they are useful - to us.
        if (data?.error) console.warn("CALL-E create rejected:", data.error);
        return fail(startFailureMessage(data ?? {}));
      }

      if (data.done) {
        // Demo mode: simulated result returned immediately. Terminal.
        stopAll();
        setRow(data.row ?? null);
        setLive(false);
        setPhase("done");
        return;
      }
      // Live: poll until the call finishes.
      setLive(true);
      const startedAt = Date.now();
      const tick = () => setElapsed(Math.round((Date.now() - startedAt) / 1000));
      ticker.current = setInterval(tick, 1000);
      /* Shown on the card, not just held in a closure. An id that exists only
         in React state is gone at the next re-render, and it is the one thing
         needed to recover a call afterwards. */
      setCallId(String(data.callId));
      poll(data.callId as string, startedAt);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /* Past the wall we slow down, we do NOT stop. The call is still running at
     CALL-E and it will end; a card that gave up needs a human to run reconcile
     by hand, which is not something to do on camera. */
  const SLOW_POLL_MS = 15_000;

  async function poll(callId: string, startedAt: number) {
    const pastWall = Date.now() - startedAt > MAX_MS;
    const delay = pastWall ? SLOW_POLL_MS : POLL_MS;

    /* Keep polling regardless; only the phase changes. */
    const again = () => {
      if (cancelled.current) return;
      const t = setTimeout(() => poll(callId, startedAt), delay);
      timeouts.current.push(t);
    };

    if (pastWall && phase !== "stalled") {
      /* Tell the server we are letting go, so the call is recorded instead of
         being dropped. Persistence used to happen only on a terminal state,
         which meant giving up on the poll threw the call away entirely. */
      try {
        await fetch("/api/calle/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId, target, context: context ?? {}, finalize: true }),
        });
      } catch {
        /* best effort - the message below is shown either way */
      }
      if (!cancelled.current) setPhase("stalled");
    }
    try {
      const res = await fetch("/api/calle/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, target, context: context ?? {} }),
      });
      const { ok, data, error: readError } = await readJson<{
        error?: string;
        done?: boolean;
        failed?: boolean;
        status?: string;
        row?: ResultRow;
        failure?: { title: string; detail: string; retryable: boolean } | null;
      }>(res);
      /* A single non-JSON poll is not proof the call died - the function may
         simply have been killed at its 30s ceiling while the call carries on.
         Keep polling; only the MAX_MS wall above ends the loop. */
      if (readError) {
        if (cancelled.current) return;
        setWaiting("Waiting for CALL-E — the call is still running.");
        again();
        return;
      }
      /* A status read that did not come back says NOTHING about the
         conversation. This used to call fail(), so one slow read - CALL-E's
         own 15s deadline, or a function killed at its ceiling - painted a red
         panel over a call that was going fine. The only thing that ends this
         card is CALL-E saying the call is over. */
      if (!ok || !data) {
        if (cancelled.current) return;
        setWaiting(
          res.status === 401
            ? "Signed out — sign in again to keep watching this call."
            : "Waiting for CALL-E — the call is still running."
        );
        /* 401 will never fix itself by asking again. Everything else might. */
        if (res.status !== 401) again();
        return;
      }
      setWaiting(null);

      if (!data.done) {
        if (cancelled.current) return;
        const status = data.status ?? "queued";
        setCallStatus(status);
        /* The moment it stops being queued is the moment the phone starts
           ringing. Captured once so the queue figure stays put afterwards. */
        if (status !== "queued") {
          setQueuedFor((prev) =>
            prev === null ? Math.round((Date.now() - startedAt) / 1000) : prev
          );
        }
        again();
        return;
      }
      if (data.failed) {
        /* One sentence used to cover every failure - a busy line, a number the
           carrier does not recognise, and a route it refused all read as "the
           call didn't complete". CALL-E gives a reason per attempt; it is the
           only part of this message worth reading. */
        const f = data.failure;
        return fail(
          f
            ? `${f.title}. ${f.detail}${f.retryable ? "" : " Retrying will not help."}`
            : `The call didn't complete (status: ${data.status}). No result to show.`
        );
      }
      // Terminal: the call is done, so the elapsed ticker stops here.
      stopAll();
      if (cancelled.current) return;
      setRow(data.row ?? null);
      setPhase("done");
    } catch {
      /* Network blip, tab asleep, dev server restarting, a function killed at
         its ceiling. None of these are the call failing, so none of them end
         the card. */
      if (cancelled.current) return;
      setWaiting("Waiting for CALL-E — the call is still running.");
      again();
    }
  }

  const verdictVariant = VERDICT_VARIANT[row?.verdict ?? ""] ?? "butter";

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Phone aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-muted" />
            <span className="text-small font-medium text-text">Verify with a real call</span>
            <Badge variant={live ? "lilac" : "muted"} className="ml-auto">
              {phase === "done" && live ? "LIVE CALL" : phase === "done" ? "SIMULATED" : "CALL-E"}
            </Badge>
          </div>
          <p className="text-small leading-relaxed text-text-muted">
            Arc calls {target.name} to confirm real{" "}
            {target.type === "station" ? "availability & rate" : "rate & deliverables"} — instead of showing an estimate.
          </p>
        </div>

        {phase === "idle" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="calle-phone">Number to call</Label>
              <Input
                id="calle-phone"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Number to call (demo) — e.g. +923001234567"
              />
            </div>
            {/* Which number, before it dials - not "the server's demo
                number" without saying which. */}
            <DialTarget typed={phoneInput} />
            <Button onClick={start} className="w-full">
              {cta}
              <ArrowRight aria-hidden strokeWidth={1.75} />
            </Button>
            <p className="text-small leading-relaxed text-text-muted">
              Enter a number you can answer to hear it ring. Leave blank to use the server&apos;s demo number.
            </p>
          </div>
        )}

        {/* Two different things wearing one label before this: CALL-E's queue
            and an actual conversation. The queue is now named, and its length
            is on screen - a 9-minute wait is a fact the operator needs, not
            something to smooth over with "usually 30-60 seconds". */}
        {phase === "calling" && (
          <div
            className="flex items-start gap-3 rounded-control bg-bone p-4"
            role="status"
            aria-live="polite"
          >
            <PhoneCall
              aria-hidden
              strokeWidth={1.75}
              className="mt-0.5 size-4 shrink-0 text-text motion-safe:animate-[callePulse_1s_ease-in-out_infinite]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-small text-text">
                {!live
                  ? `Dialing ${target.name}…`
                  : queuedFor === null
                    ? `Waiting for CALL-E to dial… ${fmtDuration(elapsed)}`
                    : `On the call with ${target.name}… ${fmtDuration(Math.max(0, elapsed - queuedFor))}`}
              </span>
              <span className="text-small text-text-muted">
                {!live
                  ? "Starting the call…"
                  : queuedFor === null
                    ? "CALL-E holds the request in a queue before the phone rings. This has run to the better part of ten minutes, and once the call was never dialled at all."
                    : `Rang after ${fmtDuration(queuedFor)} in CALL-E's queue.`}
              </span>
            </span>
            <style>{`@keyframes callePulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
          </div>
        )}

        {phase === "done" && row && (
          <div className="flex flex-col gap-3">
            {callId && (
              <span className="select-all font-mono text-small text-text-muted">{callId}</span>
            )}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <Badge variant={verdictVariant} className="capitalize">
                {verb}: {row.verdict}
              </Badge>
              {typeof row.price === "number" && (
                <span className="font-display text-h2 leading-none text-text">
                  PKR {row.price.toLocaleString()}
                </span>
              )}
              {/* What the rate covers, in their words. This used to be
                  hardcoded "per spot" / "per post" - which is how a creator's
                  a story price was once rendered as a post price,
                  with the 18,000 post rate nowhere on screen. A basis we were
                  told beats one we assumed. */}
              <span className="text-small text-text-muted">
                {row.rateBasis || (target.type === "station" ? "per spot" : "rate basis not stated")}
              </span>
              {/* A rate nobody confirmed is still worth showing - it is the
                  wrong-and-certain one that does damage. Marked, not hidden. */}
              {typeof row.price === "number" && row.rateConfirmed !== true && (
                <Badge variant="outline">
                  {row.rateConfirmed === false ? "not confirmed on the call" : "confirmation unknown"}
                </Badge>
              )}
            </div>

            {/* The negotiation, opened up. A quote that shows only the final
                number cannot be told apart from a quote nobody argued about -
                and the argument is the product. Target and walk-away are shown
                beside it so the final price can be read as good or bad rather
                than just large. */}
            {(row.mandateTarget || row.openingPrice || row.concessions?.length) && (
              <div className="flex flex-col gap-2 rounded-md border border-hairline p-3">
                <span className="type-label text-text-muted">How the price moved</span>
                <dl className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <dt className="type-label text-text-muted">Target</dt>
                    <dd className="type-data text-text">
                      {row.mandateTarget ? `PKR ${row.mandateTarget.toLocaleString()}` : "—"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="type-label text-text-muted">Walk-away</dt>
                    <dd className="type-data text-text">
                      {row.mandateWalkAway ? `PKR ${row.mandateWalkAway.toLocaleString()}` : "—"}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="type-label text-text-muted">Agreed</dt>
                    <dd className={cn(
                      "type-data",
                      typeof row.price === "number" && row.mandateWalkAway && row.price > row.mandateWalkAway
                        ? "text-danger"
                        : "text-text"
                    )}>
                      {typeof row.price === "number" ? `PKR ${row.price.toLocaleString()}` : "—"}
                    </dd>
                  </div>
                </dl>

                {typeof row.openingPrice === "number" && (
                  <p className="text-small text-text-muted">
                    They opened at PKR {row.openingPrice.toLocaleString()}.
                  </p>
                )}

                {/* Each offer separately. This is the part that shows the
                    agent traded something for the price rather than just
                    receiving a number. */}
                {row.concessions && row.concessions.length > 0 && (
                  <ol className="flex list-decimal flex-col gap-1.5 pl-4">
                    {row.concessions.map((c, i) => (
                      <li key={`${c.offered}-${i}`} className="text-small text-text-muted">
                        Offered {c.offered}
                        {c.response ? ` — ${c.response}` : ""}
                        {typeof c.rateAfter === "number" && (
                          <strong className="text-text"> → PKR {c.rateAfter.toLocaleString()}</strong>
                        )}
                      </li>
                    ))}
                  </ol>
                )}

                {typeof row.price === "number" && row.mandateWalkAway && row.price > row.mandateWalkAway && (
                  <p className="text-small text-danger">
                    Above our walk-away — not committed. The agent said it would confirm internally.
                  </p>
                )}
              </div>
            )}

            {/* CALL-E's own account of how the call went. On 1 Sep its third
                line read "The bot did not repeat back or clarify the rate
                before moving to later questions" - the exact defect behind a
                confidently wrong rate, sitting unread in the payload. */}
            {row.evidence && row.evidence.length > 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-hairline p-3">
                <span className="type-label text-text-muted">
                  What CALL-E made of the call
                  {row.confidenceLabel ? ` · confidence ${row.confidenceLabel}` : ""}
                </span>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {row.evidence.map((e, i) => (
                    <li key={i} className="text-small text-text-muted">{e}</li>
                  ))}
                </ul>
              </div>
            )}

            {row.detail && <p className="text-small text-text">{row.detail}</p>}

            {row.summary && (
              <blockquote className="rounded-control bg-bone p-4 text-small leading-relaxed text-text-muted">
                “{row.summary}”
              </blockquote>
            )}

            {row.notes && <p className="text-small text-text-muted">Note: {row.notes}</p>}

            <Button variant="outline" size="sm" onClick={start} className="w-fit">
              <RotateCcw aria-hidden strokeWidth={1.75} />
              Call again
            </Button>
          </div>
        )}

        {phase === "stalled" && (
          <div className="flex flex-col gap-3">
            {/* Deliberately not the danger panel: nothing has failed. */}
            <div className="flex items-start gap-3 rounded-control bg-bone p-4" role="status">
              <PhoneCall aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-text-muted" />
              {/* Which of the two it stalled in matters: never dialled is a
                  different thing to tell someone than still talking. */}
              <p className="text-small leading-relaxed text-text">
                {queuedFor === null
                  ? "CALL-E has still not dialled. The request is queued at their end — this card is still watching and will fill in by itself the moment it rings."
                  : "Still on the call — longer than usual, and still running. This card is still watching and will fill in by itself when CALL-E finishes."}
              </p>
            </div>
          </div>
        )}

        {/* A status read that did not come back. Said plainly, and never as a
            timeout: the call is still running, and the word TIMEOUT over a
            live call reads as a system failure to anyone watching. */}
        {waiting && (phase === "calling" || phase === "stalled") && (
          <p className="text-small text-text-muted" role="status">{waiting}</p>
        )}

        {phase === "error" && (
          <div className="flex flex-col gap-3">
            {/* The failure state is the one a demo is most likely to land on,
                so it reads as a stated outcome rather than a broken widget:
                the danger panel matches the Input primitive's error state and
                carries CALL-E's own words, with the retry right beneath. */}
            <div className="flex items-start gap-3 rounded-control bg-danger-bg p-4" role="alert">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
              {/* min-w-0 so it can shrink inside the flex row rather than
                  pushing the panel wider than the card, and whitespace-pre-line
                  because these messages carry a blank line between the
                  provider's words and ours - which HTML otherwise collapses,
                  turning two paragraphs into one run-on. */}
              <p className="min-w-0 text-small leading-relaxed whitespace-pre-line break-words text-danger">
                {error}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="calle-phone-retry">Number to call</Label>
              <Input
                id="calle-phone-retry"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Number to call — e.g. +12025550100"
              />
            </div>
            <DialTarget typed={phoneInput} />
            <Button variant="outline" size="sm" onClick={start} className="w-fit">
              <RotateCcw aria-hidden strokeWidth={1.75} />
              Try again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
