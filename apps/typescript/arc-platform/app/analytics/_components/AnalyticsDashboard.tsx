import Link from "next/link";
import { Radio as RadioIcon, Users, Wallet, Megaphone, Handshake } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatFlightDate } from "@/lib/flight";
import type { BrandAnalytics } from "@/lib/analytics";

/**
 * Unified Analytics, reporting only what the database holds.
 *
 * What used to be here and is now gone rather than marked: a 30-day reach
 * chart with no time series behind it, a best-performing-time-slots chart with
 * no traffic data, an average-engagement card with no source, a report
 * generator that produced no file, date and metric filters that filtered
 * nothing, and the entire attribution section - funnel, models, ROAS,
 * attributed revenue - which needed conversion tracking that does not exist.
 * Section 9 records what each would need to come back.
 *
 * Nothing on this page is illustrative, so nothing carries a SAMPLE pill.
 * Every figure is a sum of stored values.
 *
 * "Combined audience" is the plan's own figure and is NOT measured delivery,
 * nor reach: it is the sum of each line's audience - a station's daily
 * listeners, a creator's followers - taken from the catalogue. It answers
 * "how big are the audiences on this plan", not "how many people did this
 * campaign reach", and nothing here can answer the second question yet.
 *
 * It was called "Planned reach" until 2 Sep 2026, when the campaign generator
 * stopped inventing a per-flight reach figure it had no source for. Rows saved
 * before that date still hold the old model-estimated reach, so the column
 * mixes two quantities and campaigns either side of that date are not
 * comparable. See README, "What is real, and what is simulated".
 */

interface PlanLine {
  id: string;
  name: string;
  kind: "STATION" | "CREATOR";
  city: string | null;
  channel: string | null;
  spots: number | null;
  bookedTotalPkr: number | null;
  bookedAt: Date | null;
  status: string;
}

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  currency: string | null;
  budgetTotal: number | null;
  estTotalReach: number | null;
  flightStart: Date | null;
  flightEnd: Date | null;
  items: PlanLine[];
}

const STATUS_VARIANT: Record<string, "muted" | "lilac" | "butter" | "outline"> = {
  DRAFT: "muted", ACTIVE: "lilac", PAUSED: "butter", COMPLETED: "outline", CANCELLED: "outline",
};

const LINE_STATUS: Record<string, { variant: "lilac" | "butter" | "muted" | "outline"; label: string }> = {
  SELECTED:  { variant: "muted",   label: "On plan" },
  CALLING:   { variant: "butter",  label: "Calling" },
  CONFIRMED: { variant: "lilac",   label: "Quoted" },
  DECLINED:  { variant: "outline", label: "Declined" },
  BOOKED:    { variant: "lilac",   label: "Booked" },
};

function fmtReach(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

function Stat({
  label, value, caption, Icon,
}: {
  label: string; value: string; caption?: string; Icon: typeof Users;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-3">
        <span className="flex items-center gap-2">
          <Icon aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
          <span className="type-label text-text-muted">{label}</span>
        </span>
        <span className="font-display text-display leading-none text-text">{value}</span>
        {caption && <span className="text-small text-text-muted">{caption}</span>}
      </CardContent>
    </Card>
  );
}

export default function AnalyticsDashboard({
  stats,
  campaigns,
}: {
  stats: BrandAnalytics;
  campaigns: CampaignRow[];
}) {
  const cur = stats.currency;
  const pct = stats.budgetPkr > 0 ? Math.round((stats.committedPkr / stats.budgetPkr) * 100) : 0;
  const lines = campaigns.flatMap(c => c.items.map(i => ({ ...i, campaignName: c.name })));
  const bookedLines = lines.filter(l => l.bookedAt);

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-h1 text-text">Unified Analytics</h1>
        <p className="text-body text-text-muted">
          Cross-channel performance across Radio, Influencer &amp; Digital — all in one view
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Committed, not spent: this is the sum of what was booked. No
            payment is tied to a campaign anywhere in the app. */}
        <Card size="sm">
          <CardContent className="flex flex-col gap-3">
            <span className="flex items-center gap-2">
              <Wallet aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
              <span className="type-label text-text-muted">Committed of budget</span>
            </span>
            <span className="font-display text-h1 leading-none text-text">
              {cur} {stats.committedPkr.toLocaleString()}
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-small text-text-muted">
                  of {cur} {stats.budgetPkr.toLocaleString()} approved
                </span>
                <span className="type-data text-text">{pct}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-pill bg-bone">
                <div className="h-full rounded-pill bg-lilac-deep" style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
            <span className="text-small text-text-muted">
              {stats.bookedLines} of {stats.totalLines} plan line{stats.totalLines === 1 ? "" : "s"} booked
            </span>
          </CardContent>
        </Card>

        <Stat
          label="Active campaigns"
          value={String(stats.activeCampaigns)}
          caption={`${stats.totalCampaigns} in total`}
          Icon={Megaphone}
        />

        {/* The plan's own figure, and the label says what it is: audience
            size, not reach and not delivery. */}
        <Stat
          label="Combined audience"
          value={fmtReach(stats.plannedReach)}
          caption="Listeners and followers on the plan, not measured delivery"
          Icon={Users}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Campaigns</CardTitle>
          <CardDescription>
            Engagement and ROI are not shown: nothing measures delivery yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Combined audience</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Committed</TableHead>
                <TableHead>Flight</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map(c => {
                const committed = c.items.reduce((s, i) => s + (i.bookedTotalPkr ?? 0), 0);
                const ccy = c.currency ?? cur;
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="max-w-52 truncate font-medium text-text underline-offset-4 hover:underline"
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[c.status] ?? "muted"}>{c.status.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="type-data text-right text-text">
                      {c.estTotalReach == null ? "—" : fmtReach(c.estTotalReach)}
                    </TableCell>
                    <TableCell className="type-data text-right text-text">
                      {c.budgetTotal == null ? "—" : `${ccy} ${c.budgetTotal.toLocaleString()}`}
                    </TableCell>
                    <TableCell className="type-data text-right text-text">
                      {committed === 0 ? "—" : `${ccy} ${committed.toLocaleString()}`}
                    </TableCell>
                    <TableCell className="text-small text-text-muted">
                      {c.flightStart && c.flightEnd
                        ? `${formatFlightDate(c.flightStart)} – ${formatFlightDate(c.flightEnd)}`
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* One table, not two. Radio and Creator performance were separate
          blocks reporting CPM and CPE, both of which need measured reach. What
          is left is the same shape for both kinds, and splitting one row
          across two tables reads worse than keeping it together. */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Booked lines</CardTitle>
            <CardDescription>Every station and creator with a booking against it</CardDescription>
          </div>
          <Badge variant={bookedLines.length ? "lilac" : "muted"}>
            {bookedLines.length} of {lines.length} booked
          </Badge>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {lines.length === 0 ? (
            <p className="text-body text-text-muted">No plan lines yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="text-right">Spots</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map(l => {
                  const st = LINE_STATUS[l.status] ?? LINE_STATUS.SELECTED;
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          {l.kind === "STATION" ? (
                            <RadioIcon aria-label="Station" strokeWidth={1.75} className="size-3.5 shrink-0 text-text-muted" />
                          ) : (
                            <Handshake aria-label="Creator" strokeWidth={1.75} className="size-3.5 shrink-0 text-text-muted" />
                          )}
                          <span className="max-w-44 truncate font-medium text-text">{l.name}</span>
                        </span>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-text-muted">{l.campaignName}</TableCell>
                      <TableCell className="text-text-muted capitalize">{l.channel ?? "—"}</TableCell>
                      <TableCell className="text-text-muted">{l.city ?? "—"}</TableCell>
                      <TableCell className="type-data text-right text-text">{l.spots ?? "—"}</TableCell>
                      <TableCell className="type-data text-right text-text">
                        {l.bookedTotalPkr == null ? "—" : `${cur} ${l.bookedTotalPkr.toLocaleString()}`}
                      </TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
