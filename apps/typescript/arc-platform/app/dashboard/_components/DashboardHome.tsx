"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Radio, User, BarChart3, ArrowRight, ChevronRight, Sparkles, Phone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { BrandAnalytics } from "@/lib/analytics";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { deriveCampaignStatus, type DerivedStatus } from "@/lib/campaign-status";

/* ─── Types ─── */
interface Campaign {
  id: string; name: string; status: string; createdAt: Date;
  /* Carried so the badge can be derived rather than trusted. */
  items?: { status: string }[];
  flightStart?: Date | null;
  flightEnd?: Date | null;
}
interface Brand {
  name: string; plan: string; primaryCity: string;
  monthlyBudget: string; aiCreditsUsed: number; aiCreditsLimit: number;
}

/* ─── Sample Data ─── */

/**
 * Illustrative blocks carry this. BRANDING.md section 9: no page may show a
 * number, campaign, invoice or metric that is not read from the database or
 * visibly marked SAMPLE.
 */

/**
 * Avatar and dot colours are token NAMES, not values - BRANDING.md section 9.
 * They resolve in the two maps below, which are the single place that decides
 * what "lilac" or "success" looks like here.
 */
type Tone = "lilac" | "blush" | "butter";
const AVATAR_TONE: Record<Tone, string> = {
  lilac: "bg-lilac text-ink",
  blush: "bg-blush text-ink",
  butter: "bg-butter text-ink",
};

type DotTone = "success" | "lilac" | "warning" | "muted";
const DOT_TONE: Record<DotTone, string> = {
  success: "bg-success",
  lilac: "bg-lilac-deep",
  warning: "bg-warning",
  muted: "bg-text-muted",
};

/* What used to sit here: INFLUENCERS with invented engagement rates attached
   to named people, ACTIVITY with events that never happened ("Payment
   confirmed — PKR 80,000"), and a SPARKLINE of seven made-up numbers. All
   three rendered beside figures read from the database, so nothing on the
   screen told you which was which. The rule now is that a number, a name or an
   event on this page came from our own data or it is not on this page.
   Where there is nothing, there is an empty state rather than a placeholder. */

const QUICK_ACTIONS: { href: string; label: string; Icon: LucideIcon }[] = [
  { href: "/radio", label: "Browse radio stations", Icon: Radio },
  { href: "/influencers", label: "Find influencers", Icon: User },
  { href: "/analytics", label: "View analytics report", Icon: BarChart3 },
];

/* ─── Small helpers ─── */

/* Takes the derived status, not the stored one - otherwise the stat card
   above says 0 active while a row underneath says ACTIVE, which is how this
   looked for a moment while only half of this screen had been converted. */
function StatusBadge({ status }: { status: DerivedStatus }) {
  const dot =
    status.key === "ACTIVE" ? "bg-success"
    : status.key === "SCHEDULED" ? "bg-warning"
    : "bg-text-muted";
  return (
    <span className="flex items-center gap-2 text-small font-medium text-text" title={status.note}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-pill", dot)} />
      {status.label}
    </span>
  );
}

/** White card on --bone. Pastel is reserved for pills, chart fills and the AI
 *  panel, keeping it under the ~15% the density rule allows. */
function Panel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("rounded-card bg-surface p-6 shadow-card", className)}>
      {children}
    </section>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-h3 text-text">{children}</h2>;
}

/** Reach, from the plan's own estimates. */
function fmtReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Real elapsed time. The old feed hardcoded "2 hours ago" forever. */
function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* ── the activity feed ─────────────────────────────────────────────────────
   Four failed attempts at one station are ONE problem, not four events. Shown
   as four rows they carry four rows' worth of weight, which overstates them
   and buries anything that worked. Grouped, with the count kept visible -
   collapsed, never hidden, because "did not connect x4" is the thing a buyer
   needs to see. */

export interface FeedEntry {
  key: string;
  kind: "result" | "failures" | "other";
  targetName: string;
  calls: DashboardCall[];
}

export function groupFeed(calls: DashboardCall[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const c of calls) {
    const failed = c.done && c.outcome === "NOT_CONNECTED";
    const last = out[out.length - 1];
    /* Only CONSECUTIVE failures at the same target collapse. A failure, a
       success, then another failure is a different story from four in a row,
       and flattening them would tell it wrong. */
    if (failed && last?.kind === "failures" && last.targetName === c.targetName) {
      last.calls.push(c);
      continue;
    }
    out.push({
      key: c.calleCallId ?? c.createdAt,
      kind: failed ? "failures" : c.outcome === "RESULT" ? "result" : "other",
      targetName: c.targetName,
      calls: [c],
    });
  }
  return out;
}

export interface DashboardCall {
  calleCallId: string | null;
  targetName: string;
  outcome: string | null;
  status: string;
  pricePkr: number | null;
  rateConfirmed: boolean | null;
  createdAt: string;
  done: boolean;
}

export default function DashboardHome({ brand, firstName, campaigns, stats, recentCalls, calls, reach, todo }: {
  brand: Brand; firstName: string; campaigns: Campaign[]; stats: BrandAnalytics;
  recentCalls: DashboardCall[];
  calls: { placed: number; confirmed: number };
  reach: { total: number; stations: number; creators: number };
  todo: { openLines: { id: string; name: string; externalId: string; campaignId: string; kind: string; callable: boolean }[] };
}) {
  const [completedOpen, setCompletedOpen] = useState(false);
  /* Derived, not read. c.status is written once at launch and never updated
     by anything in the app, so counting it counted button presses. */
  const statusFull = (c: (typeof campaigns)[number]) =>
    deriveCampaignStatus({
      storedStatus: c.status,
      itemStatuses: (c.items ?? []).map(i => i.status),
      flightStart: c.flightStart ?? null,
      flightEnd: c.flightEnd ?? null,
    });
  const activeCount = campaigns.filter(c => statusFull(c).key === "ACTIVE").length;
  const completedCampaigns = campaigns.filter(c => statusFull(c).key === "COMPLETED");
  const feed = groupFeed(recentCalls);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = now.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-8 font-sans">
      {/* ── Greeting ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-h1 text-text">{greeting}, {firstName}.</h1>
          <p className="text-body text-text-muted">Here&apos;s what&apos;s happening with your campaigns.</p>
        </div>
        <span className="type-data text-text-muted">{dateStr}</span>
      </div>

      {/* ── Stat Cards ──
          Active campaigns is computed from the real rows. The other three have
          no source - Campaign carries no reach, spend or engagement - so they
          are marked individually rather than the whole row being written off. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Real. "+1 from last week" needed history the schema does not keep,
            and "3 of 3 campaign limit" needed a plan limit that does not exist,
            so both are dropped rather than marked. */}
        <Panel className="flex flex-col gap-3">
          <span className="type-label text-text-muted">Active campaigns</span>
          <span className="font-display text-display leading-none text-text">{activeCount}</span>
          <span className="text-small text-text-muted">
            of {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"}
          </span>
        </Panel>

        {/* Added up from the plan. It read a flat "4.2M ... across 2 stations +
            4 influencers" for every brand, under a Sample mark, beside a
            sparkline of seven invented numbers. One line in the plan now shows
            one line. */}
        <Panel className="flex flex-col gap-3">
          <span className="type-label text-text-muted">Estimated reach</span>
          <span className="font-display text-display leading-none text-text">
            {reach.total > 0 ? fmtReach(reach.total) : "—"}
          </span>
          <span className="text-small text-text-muted">
            {reach.stations + reach.creators === 0
              ? "No lines planned yet"
              : `Across ${[
                  reach.stations ? `${reach.stations} station${reach.stations === 1 ? "" : "s"}` : null,
                  reach.creators ? `${reach.creators} creator${reach.creators === 1 ? "" : "s"}` : null,
                ].filter(Boolean).join(" + ")}`}
          </span>
        </Panel>

        <Panel className="flex flex-col gap-3">
          <span className="flex items-center justify-between gap-2">
            {/* Was "Spent this month · PKR 285K" with a SAMPLE pill. It reads
                the same sum the analytics page does - one query, one truth -
                and it is committed, not spent: no payment is tied to a
                campaign anywhere in the app. */}
            <span className="type-label text-text-muted">Committed</span>
          </span>
          <span className="font-display text-display leading-none text-text">
            {stats.currency} {stats.committedPkr.toLocaleString()}
          </span>
          <span className="text-small text-text-muted">
            {stats.budgetPkr > 0
              ? `of ${stats.currency} ${stats.budgetPkr.toLocaleString()} approved`
              : "No campaign budgets approved yet"}
          </span>
          <div className="h-1 overflow-hidden rounded-pill bg-hairline">
            <div
              className="h-full rounded-pill bg-lilac-deep"
              style={{ width: `${stats.budgetPkr > 0 ? Math.min(Math.round((stats.committedPkr / stats.budgetPkr) * 100), 100) : 0}%` }}
            />
          </div>
          <span className="text-small text-text-muted">
            {stats.bookedLines} of {stats.totalLines} plan line{stats.totalLines === 1 ? "" : "s"} booked
          </span>
        </Panel>

        {/* Was "Avg engagement rate 6.8% / +0.4% vs last month / Industry avg
            3.1%" - three numbers with no source, on the first screen anyone
            sees. Arc does not measure engagement. It does measure how many
            rates a call actually got someone to confirm, which is the number
            this product exists to produce. */}
        {/* The headline was `calls.confirmed`, which is a zero until a call
            lands - and a zero is the first thing an eye goes to. Same two
            numbers, same truth, but the count of work done leads and the
            outcome follows. */}
        <Panel className="flex flex-col gap-3">
          <span className="type-label text-text-muted">Calls placed</span>
          <span className="font-display text-display leading-none text-text">{calls.placed}</span>
          <span className="text-small text-text-muted">
            {calls.placed === 0
              ? "None yet"
              : calls.confirmed > 0
                ? `${calls.confirmed} rate${calls.confirmed === 1 ? "" : "s"} confirmed on the call`
                : "No rate confirmed on a call yet"}
          </span>
        </Panel>
      </div>

      {/* ── Two-column: table + sidebar ── */}
      <div className="grid items-start gap-6 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
        {/* Campaigns table */}
        <section className="overflow-hidden rounded-card bg-surface shadow-card">
          <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
            <PanelTitle>Active campaigns</PanelTitle>
            <Link
              href="/campaigns"
              className="inline-flex items-center gap-1 rounded-control text-small font-medium text-text outline-none hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              View all
              <ArrowRight aria-hidden strokeWidth={1.75} className="size-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channels</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reach</TableHead>
                  <TableHead>Budget</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    {/* Channels, reach, budget and end date have no column in
                        the Campaign model. An em dash is the honest answer. */}
                    <TableCell className="type-data text-text-muted">—</TableCell>
                    <TableCell><StatusBadge status={statusFull(c)} /></TableCell>
                    <TableCell className="type-data text-text-muted">—</TableCell>
                    <TableCell className="type-data text-text-muted">—</TableCell>
                    <TableCell className="type-data text-text-muted">—</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="inline-flex items-center gap-1 rounded-control text-small font-medium text-text outline-none hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {statusFull(c).key === "DRAFT" ? "Edit" : "View"}
                        <ArrowRight aria-hidden strokeWidth={1.75} className="size-3.5" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <button
            type="button"
            onClick={() => setCompletedOpen(p => !p)}
            aria-expanded={completedOpen}
            className="flex w-full items-center gap-2 border-t border-border px-6 py-3.5 text-left text-small text-text-muted outline-none transition-colors hover:bg-bone focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          >
            <ChevronRight
              aria-hidden
              strokeWidth={2}
              className={cn("size-4 transition-transform motion-reduce:transition-none", completedOpen && "rotate-90")}
            />
            Completed campaigns ({completedCampaigns.length})
          </button>
          {/* Was a hardcoded "(12)" listing Daraz, Packages Mall and Jazz -
              three real companies and nine unnamed others, none of whom have
              ever run a campaign here. */}
          {completedOpen && (
            <p className="border-t border-border px-6 py-3.5 text-small text-text-muted">
              {completedCampaigns.length === 0
                ? "None yet. A campaign appears here once it is marked completed."
                : completedCampaigns.map(c => c.name).join(" · ")}
            </p>
          )}
        </section>

        {/* Chart sits in the left column so the two columns fill together
            rather than leaving a hole under a short table. */}

        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-3">
            <PanelTitle>Quick actions</PanelTitle>
            <Button asChild className="w-full justify-start">
              <Link href="/campaigns/create">
                <Sparkles aria-hidden strokeWidth={1.75} />
                Create new campaign
              </Link>
            </Button>
            {QUICK_ACTIONS.map(a => (
              <Button key={a.href} asChild variant="outline" className="w-full justify-start">
                <Link href={a.href}>
                  <a.Icon aria-hidden strokeWidth={1.75} />
                  {a.label}
                </Link>
              </Button>
            ))}
          </Panel>

          {/* What a buyer actually wants from this screen: what to do next.
              Every line is computed from real state - a plan line with no
              confirmed rate is the job this product exists to finish - and
              when there is nothing to do it says so rather than inventing a
              suggestion. This is where the invented "AI Recommendations"
              panel used to sit; the difference is that these are true. */}
          <Panel className="flex flex-col gap-3">
            <PanelTitle>What needs doing</PanelTitle>
            {todo.openLines.length === 0 ? (
              <p className="text-small text-text-muted">
                {stats.totalLines === 0
                  ? "Nothing yet — build a plan and the lines to call will appear here."
                  : "Every planned line has a confirmed rate. Nothing outstanding."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                <li className="text-small text-text">
                  <strong>
                    {todo.openLines.length} line{todo.openLines.length === 1 ? "" : "s"}
                  </strong>{" "}
                  ha{todo.openLines.length === 1 ? "s" : "ve"} no rate confirmed on a call.
                </li>
                {todo.openLines.slice(0, 4).map((l) => (
                  <li key={l.id}>
                    <Link
                      href={`/campaigns/${l.campaignId}`}
                      className="flex items-center gap-2 rounded-control bg-bone px-3 py-2 text-small text-text outline-none transition-colors hover:bg-lilac focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
                    >
                      <Phone aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
                      <span className="flex-1">
                        {l.callable ? `Call ${l.name}` : `${l.name} — no number on file`}
                      </span>
                      <ArrowRight aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
                    </Link>
                  </li>
                ))}
                {todo.openLines.length > 4 && (
                  <li className="text-small text-text-muted">
                    and {todo.openLines.length - 4} more
                  </li>
                )}
              </ul>
            )}
          </Panel>

          {/* An "AI Recommendations" panel used to sit here: "3 FM stations
              matching your FMCG brief", "Sana Lifestyle (67K) - 92% niche
              match", "Your Eid campaign peaks on Apr 17". There is no
              recommendation engine behind the dashboard - the wizard generates
              plans, this page does not - so all three were written by hand,
              including a percentage match for a named person. Removed rather
              than replaced: an empty AI panel would still be a claim. */}

          {/* A1: real calls, or nothing. The feed here was five invented
              events - "Payment confirmed — PKR 80,000", "Campaign 'Khaadi
              Summer' created" - sitting under a Sample chip beside figures read
              from the database. Calls are the only thing this product does that
              produces a timeline, so calls are the timeline. */}
          <Panel className="flex flex-col gap-4">
            <PanelTitle>Recent activity</PanelTitle>
            {feed.length === 0 ? (
              <p className="text-small text-text-muted">
                No activity yet. Calls placed from a campaign appear here.
              </p>
            ) : (
              <ol className="relative flex flex-col gap-4 pl-5">
                <span aria-hidden className="absolute top-1.5 bottom-1.5 left-1 w-px bg-border" />
                {feed.map((e) => {
                  const head = e.calls[0];
                  const dot: DotTone =
                    e.kind === "result" ? "success" : e.kind === "failures" ? "warning" : !head.done ? "lilac" : "muted";
                  return (
                    <li key={e.key} className="relative flex flex-col gap-1">
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-1.5 -left-[15px] size-2 rounded-pill ring-2 ring-surface",
                          DOT_TONE[dot]
                        )}
                      />
                      {e.kind === "failures" ? (
                        /* Collapsed with the count in front, and every attempt
                           still reachable underneath. */
                        <details className="flex flex-col gap-1">
                          <summary className="cursor-pointer text-small text-text marker:text-text-muted">
                            {e.targetName} — {e.calls.length} attempt{e.calls.length === 1 ? "" : "s"} did not connect
                          </summary>
                          <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                            {e.calls.map((c) => (
                              <li key={c.calleCallId ?? c.createdAt} className="text-small text-text-muted">
                                {c.calleCallId ? (
                                  <Link href={`/calls/${c.calleCallId}`} className="underline underline-offset-2">
                                    {ago(c.createdAt)}
                                  </Link>
                                ) : (
                                  ago(c.createdAt)
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : e.kind === "result" ? (
                        /* The centre of the screen, not one line among six. A
                           rate someone confirmed on a call is the single thing
                           this product exists to produce. */
                        <div className="flex flex-col gap-2 rounded-control bg-bone p-4">
                          <span className="text-small text-text">{head.targetName}</span>
                          {head.pricePkr != null ? (
                            <>
                              <span className="font-display text-h2 leading-none text-text">
                                PKR {head.pricePkr.toLocaleString()}
                              </span>
                              <span className="flex flex-wrap items-center gap-2">
                                {head.rateConfirmed === true ? (
                                  <Badge variant="lilac">confirmed on the call</Badge>
                                ) : (
                                  <Badge variant="outline">
                                    {head.rateConfirmed === false ? "not confirmed" : "confirmation unknown"}
                                  </Badge>
                                )}
                                {head.calleCallId && (
                                  <Link
                                    href={`/calls/${head.calleCallId}#confirmation`}
                                    className="text-small text-lilac-deep underline underline-offset-2"
                                  >
                                    heard here
                                  </Link>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className="text-small text-text-muted">Answered, no rate given</span>
                          )}
                          <span className="text-small text-text-muted">{ago(head.createdAt)}</span>
                        </div>
                      ) : (
                        <>
                          <span className="text-small text-text">
                            {!head.done ? `Calling ${head.targetName}` : `${head.targetName} answered, nothing settled`}
                          </span>
                          <span className="text-small text-text-muted">{ago(head.createdAt)}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
