"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Download, Smartphone, CreditCard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PLANS, PLAN_ORDER, type PlanKey } from "@/lib/config/pricing";

interface Props {
  plan:             string;
  brandId:          string;
  brandName:        string;
  stripeCustomerId: string | null;
  aiCreditsUsed:    number;
  aiCreditsLimit:   number;
  planExpiresAt:    string | null;
  activeCampaigns:  number;
  /** Sample invoices are shown only in a demo workspace, and only under a
   *  label saying so. See lib/demo-workspace.ts. */
  showSampleInvoices?: boolean;
}

/** Invented. Marked SAMPLE at the section header - section 9. There is no
 *  invoice table; plan and AI credits below ARE read from the database. */
/* Not real. Rendered only in a demo workspace, and only under a label that
   says so - see isDemoWorkspace. These used to render for everyone, with
   working PDF links, indistinguishable from invoices that had been paid. */
const SAMPLE_INVOICES = [
  { id: "ARC-2026-047", date: "Apr 1, 2026",  desc: "Growth Plan — April",             amount: 40000,  status: "paid" },
  { id: "ARC-2026-031", date: "Mar 1, 2026",  desc: "Growth Plan — March",             amount: 40000,  status: "paid" },
  { id: "ARC-2026-018", date: "Feb 1, 2026",  desc: "Growth Plan + Radio City FM 89",  amount: 94000,  status: "paid" },
];

/** Plan tone as a token name - PLANS carries a raw hex per plan (section 9),
 *  and this is the one place that decides what a plan looks like. */
const PLAN_VARIANT: Record<string, "muted" | "lilac" | "butter"> = {
  STARTER: "muted", GROWTH: "lilac", ENTERPRISE: "butter",
};

function PlanBadge({ planKey }: { planKey: PlanKey }) {
  return <Badge variant={PLAN_VARIANT[planKey] ?? "muted"}>{PLANS[planKey].name}</Badge>;
}

function UsageMeter({ label, used, limit, upgradeMsg }: { label: string; used: number; limit: number; upgradeMsg?: string }) {
  const isUnlimited = limit === Infinity;
  const pct = isUnlimited ? 100 : Math.min((used / limit) * 100, 100);
  const isAlmostFull = !isUnlimited && pct >= 80;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-small text-text">{label}</span>
        <span className={`type-data ${isAlmostFull ? "text-warning" : "text-text-muted"}`}>
          {isUnlimited ? "Unlimited" : `${used} / ${limit} used`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-bone">
        <div
          className={`h-full rounded-pill ${isAlmostFull ? "bg-butter-deep" : "bg-lilac-deep"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {!isUnlimited && upgradeMsg && (
        <span className={`text-small ${isAlmostFull ? "text-warning" : "text-text-muted"}`}>
          {isAlmostFull ? upgradeMsg : `${limit - used} remaining`}
        </span>
      )}
    </div>
  );
}

export default function BillingPortal({
  plan, brandId, stripeCustomerId, aiCreditsUsed, aiCreditsLimit, planExpiresAt, activeCampaigns,
  showSampleInvoices = false,
}: Props) {
  const currentPlanKey = (PLAN_ORDER.includes(plan as PlanKey) ? plan : "STARTER") as PlanKey;
  const currentPlan = PLANS[currentPlanKey];
  const currentPlanIdx = PLAN_ORDER.indexOf(currentPlanKey);

  const [cycle, setCycle]                       = useState<"monthly" | "annual">("monthly");
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  function priceFor(key: PlanKey) {
    return cycle === "monthly" ? PLANS[key].monthly_pkr : Math.round(PLANS[key].annual_pkr / 12);
  }
  const annualSavings = currentPlan.monthly_pkr * 12 - currentPlan.annual_pkr;

  /* Was the literal "May 10, 2026". planExpiresAt is a real column; when it
     is null there is no renewal date to state. */
  /* A plan column that defaults to STARTER says nothing about whether anyone
     bought anything. A Stripe customer or an expiry date does. */
  const hasSubscription = Boolean(stripeCustomerId) || Boolean(planExpiresAt);

  const nextBilling = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <>
      {/* Settings' layout owns the page's h1. This is the section within it,
          so it takes the same heading level as Brand's. */}
      <header>
        <h2 className="font-display text-h3 text-text">Billing &amp; Subscription</h2>
      </header>

      {/* ── Current plan ── */}
      {/* `plan` is a column with @default(STARTER), so EVERY brand has one from
          the moment it is created. A new account with no card, no payment and
          zero campaigns was being shown "STARTER · PKR 8,000 / month · Cancel
          subscription · No renewal date on file" - a subscription nobody had
          bought, priced, and offered for cancellation.

          A default is not a purchase. Evidence of one is a Stripe customer or
          an expiry date; with neither, the card says what is true and shows no
          price and nothing to cancel. Same rule the sample invoices already
          follow. */}
      <Card>
        {!hasSubscription ? (
          <CardContent className="flex flex-col gap-2">
            <span className="font-medium text-text">No subscription</span>
            <span className="text-small text-text-muted">
              Billing is not live yet. Nothing has been charged, and there is no plan on this
              account - what you see in Arc is not limited by one.
            </span>
          </CardContent>
        ) : (
        <CardContent className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-3">
            <PlanBadge planKey={currentPlanKey} />
            <div className="flex items-baseline gap-2">
              <span className="font-display text-display leading-none text-text">
                PKR {currentPlan.monthly_pkr.toLocaleString()}
              </span>
              <span className="text-body text-text-muted">/ month</span>
            </div>
            {/* "· Billed Monthly" and a hardcoded renewal date used to sit
                here. The cycle is not stored, and the date is only shown when
                planExpiresAt holds one. */}
            {nextBilling ? (
              <span className="text-small text-text-muted">
                Next billing date: <span className="font-medium text-text">{nextBilling}</span>
              </span>
            ) : (
              <span className="text-small text-text-muted">No renewal date on file</span>
            )}
          </div>

          <div className="flex flex-col items-end gap-3">
            <Button asChild>
              <Link href="/checkout?plan=growth&cycle=monthly">Manage Plan</Link>
            </Button>
            {!confirmingCancel ? (
              <Button variant="ghost" size="sm" onClick={() => setConfirmingCancel(true)}>
                Cancel subscription
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-small text-danger">Confirm cancel?</span>
                <Button variant="destructive" size="sm">Yes, cancel</Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmingCancel(false)}>No</Button>
              </div>
            )}
          </div>
        </CardContent>
        )}
      </Card>

      {/* ── Billing cycle ── */}
      <Card size="sm">
        <CardHeader>
          <CardTitle>Billing Cycle</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div role="group" aria-label="Billing cycle" className="flex gap-2">
            {(["monthly", "annual"] as const).map(c => (
              <Button
                key={c}
                size="sm"
                variant={cycle === c ? "default" : "outline"}
                aria-pressed={cycle === c}
                onClick={() => setCycle(c)}
              >
                {c === "monthly" ? "Monthly" : "Annual"}
              </Button>
            ))}
          </div>
          {cycle === "annual" && (
            <span className="rounded-control bg-butter px-3 py-1.5 text-small font-medium text-ink">
              Save 20% — PKR {annualSavings.toLocaleString()} / year
            </span>
          )}
        </CardContent>
      </Card>

      {/* ── Plan comparison ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((key, idx) => {
          const p = PLANS[key];
          const isCurrent = key === currentPlanKey;
          const isHigher  = idx > currentPlanIdx;
          const isLower   = idx < currentPlanIdx;
          const price     = priceFor(key);

          return (
            <Card key={key} size="sm" className={isCurrent ? "ring-2 ring-ring" : undefined}>
              <CardHeader className="gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PlanBadge planKey={key} />
                  {isCurrent && <Badge variant="outline">Current plan</Badge>}
                  {key === "GROWTH" && !isCurrent && <Badge variant="butter">Most popular</Badge>}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-display text-h2 leading-none text-text">PKR {price.toLocaleString()}</span>
                    <span className="text-small text-text-muted">/mo</span>
                  </span>
                  {cycle === "annual" && <span className="text-small text-text-muted">billed annually</span>}
                </div>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col gap-2 border-y border-hairline py-4">
                  {p.features.slice(0, 4).map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <Check aria-hidden strokeWidth={2} className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
                      <span className="text-small text-text-muted">{f}</span>
                    </li>
                  ))}
                  {p.features.length > 4 && (
                    <li className="text-small text-text-muted">+{p.features.length - 4} more features</li>
                  )}
                </ul>

                {isCurrent ? (
                  <span className="py-2 text-center text-small text-text-muted">Active plan</span>
                ) : isHigher ? (
                  <Button asChild className="w-full">
                    <Link href={`/checkout?plan=${p.id}&cycle=${cycle}`}>
                      Upgrade
                      <ArrowRight aria-hidden strokeWidth={1.75} />
                    </Link>
                  </Button>
                ) : isLower ? (
                  <Button variant="outline" className="w-full">Downgrade</Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Payment method ── */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* A "Visa ending in 4242, expires 12/27, Default" card used to sit
              here for every brand. Nothing fetches payment methods; the only
              real signal is whether a Stripe customer record exists, so that
              is what it states. Inventing a card number on a billing page is
              the one place a made-up figure could cost someone money. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-bone p-4">
            <span className="flex items-center gap-3">
              <CreditCard aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-small font-medium text-text">
                  {stripeCustomerId ? "Card on file with Stripe" : "No card on file"}
                </span>
                <span className="text-small text-text-muted">
                  {stripeCustomerId
                    ? "Card details are held by Stripe and managed at checkout"
                    : "Added the first time you check out"}
                </span>
              </span>
            </span>
            <Button asChild variant="outline" size="sm">
              <Link href="/checkout?plan=growth&cycle=monthly">
                {stripeCustomerId ? "Update" : "Add"}
              </Link>
            </Button>
          </div>

          {/* Every merchant number, account number, IBAN and Swift code that
              used to live here was a literal in this file, presented as
              instructions for where to send money. A SAMPLE pill is not
              enough protection for that: a pill explains a figure, it does
              not stop someone acting on one. They are removed outright.
              Restore this section only with Arc's real accounts. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-bone p-4">
            <span className="flex items-center gap-3">
              <Smartphone aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-text-muted" />
              <span className="flex flex-col">
                <span className="text-small font-medium text-text">Pakistan payment methods</span>
                <span className="text-small text-text-muted">
                  JazzCash · Easypaisa — pay in PKR from your mobile wallet
                </span>
              </span>
            </span>
            <Badge variant="muted">Not configured</Badge>
          </div>
          <p className="text-small text-text-muted">
            Payment details aren&apos;t configured yet.
          </p>
        </CardContent>
      </Card>

      {/* ── Invoice history ── */}
      {!showSampleInvoices ? (
        <Card>
          <CardHeader>
            <CardTitle>Invoice History</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-small text-text-muted">
              No invoices yet. They will appear here once billing is live on this
              workspace.
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader className="flex flex-wrap items-center gap-3">
          <CardTitle>Invoice History</CardTitle>
          <Badge variant="butter">Sample data</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 overflow-x-auto">
          {/* A muted chip beside the title was not enough. The rows say "Paid",
              carry invoice numbers and download real PDFs; at a glance they
              are indistinguishable from invoices someone actually settled. If
              it is going to be shown at all it has to announce itself. */}
          <p className="rounded-control bg-butter px-4 py-3 text-small text-ink" role="note">
            These invoices are sample data for the demo workspace. Nothing here was
            billed, paid or issued, and the PDFs are marked SAMPLE too. Arc has no
            invoice records — the plan and AI credits below are real.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead><span className="sr-only">Download</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_INVOICES.map(inv => (
                <TableRow key={inv.id}>
                  <TableCell className="text-text-muted">{inv.date}</TableCell>
                  <TableCell className="type-data text-text-muted">{inv.id}</TableCell>
                  <TableCell className="text-text">{inv.desc}</TableCell>
                  <TableCell className="type-data text-right text-text">PKR {inv.amount.toLocaleString()}</TableCell>
                  <TableCell><Badge variant="outline">Paid</Badge></TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="icon-sm">
                      <a href={`/api/invoices/${inv.id}/pdf`} download aria-label={`Download invoice ${inv.id}`}>
                        <Download aria-hidden strokeWidth={1.75} />
                      </a>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* ── Usage ── */}
      <Card>
        <CardHeader>
          <CardTitle>Current Usage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* AI credits and active campaigns are real. Seats and stations per
              booking were literal 1 and 2 for every brand - Arc stores
              neither, so the meters that reported them are gone rather than
              guessing. */}
          <UsageMeter
            label="AI Script Generation"
            used={aiCreditsUsed}
            limit={currentPlanKey === "STARTER" ? aiCreditsLimit : Infinity}
            upgradeMsg={currentPlanKey === "STARTER" ? "Upgrade to Growth for unlimited scripts" : undefined}
          />
          <UsageMeter
            label="Active Campaigns"
            used={activeCampaigns}
            limit={currentPlan.limits.active_campaigns}
            upgradeMsg={currentPlanKey === "STARTER" ? "1 slot remaining — upgrade for unlimited" : undefined}
          />

          {currentPlanKey === "STARTER" ? (
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-control bg-lilac p-5">
              <span className="flex flex-col gap-1">
                <span className="text-body font-medium text-ink">Ready to grow?</span>
                <span className="text-small text-ink/80">
                  Upgrade to Growth for unlimited scripts, influencer access &amp; analytics
                </span>
              </span>
              <Button asChild>
                <Link href="/checkout?plan=growth&cycle=monthly">
                  Upgrade
                  <ArrowRight aria-hidden strokeWidth={1.75} />
                </Link>
              </Button>
            </div>
          ) : (
            <span className="flex items-center gap-2 text-small text-text-muted">
              <Check aria-hidden strokeWidth={2} className="size-4" />
              All {currentPlan.name} features active — no limits on this plan
            </span>
          )}
        </CardContent>
      </Card>
    </>
  );
}
