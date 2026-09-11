"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ClipboardList, Mic, Radio, Star, Phone, Lightbulb, Rocket,
  MapPin, ChevronDown, ChevronUp, ArrowLeft,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { flightEndISO } from "@/lib/flight";
import { useWizard, useResolvedScript } from "./WizardContext";
import type { RadioScript } from "./WizardContext";
import BatchCallPanel from "@/app/_components/BatchCallPanel";
import { StepHeader } from "./WizardChrome";
import { advertiserName } from "@/lib/advertiser";

const BudgetDonut = dynamic(() => import("./BudgetDonut"), { ssr: false });

/**
 * The legend swatches mirror BudgetDonut's wedge fills, which now come from
 * lib/tokens. These are Tailwind classes rather than imported values because
 * BudgetDonut is dynamically imported - a static import of its palette would
 * defeat that - and because a swatch is a DOM element, where a class is the
 * right tool.
 */
const DONUT_TONES = ["bg-lilac-deep", "bg-blush-deep", "bg-butter-deep"];

const LANG_VARIANT: Record<string, "lilac" | "blush" | "butter"> = {
  urdu: "lilac", english: "butter", bilingual: "blush",
};
const LANG_LABEL: Record<string, string> = {
  urdu: "اردو / Urdu", english: "English", bilingual: "Bilingual",
};
const SECTION_RULE = {
  hook: "bg-lilac-deep", body: "bg-blush-deep", cta: "bg-butter-deep",
} as const;

function Section({
  title, icon: Icon, children, defaultOpen = true,
}: { title: string; icon: LucideIcon; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-card bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left outline-none transition-colors hover:bg-bone focus-visible:outline-solid focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
      >
        <span className="flex items-center gap-3">
          <Icon aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
          <span className="font-display text-h3 text-text">{title}</span>
        </span>
        {open
          ? <ChevronUp aria-hidden strokeWidth={2} className="size-4 shrink-0 text-text-muted" />
          : <ChevronDown aria-hidden strokeWidth={2} className="size-4 shrink-0 text-text-muted" />}
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </section>
  );
}

function ReviewScriptMini({ script }: { script: RadioScript }) {
  const { state } = useWizard();
  const resolved = useResolvedScript(script, state.editedScripts);
  return (
    <div className="flex flex-col gap-3 rounded-control bg-bone p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={LANG_VARIANT[script.language]}>{LANG_LABEL[script.language]}</Badge>
        <span className="type-data text-text-muted">{script.duration}s · {resolved.title}</span>
      </div>
      {([
        ["HOOK", resolved.hook, SECTION_RULE.hook],
        ["BODY", resolved.body, SECTION_RULE.body],
        ["CTA", resolved.callToAction, SECTION_RULE.cta],
      ] as const).map(([label, text, rule]) => (
        <div key={label} className="flex gap-3">
          <span aria-hidden className={cn("w-1 shrink-0 rounded-pill", rule)} />
          <div className="flex flex-col gap-1">
            <span className="type-label text-text-muted">{label}</span>
            <p className="text-small text-text">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LineItem({ title, sub, amount }: { title: React.ReactNode; sub: React.ReactNode; amount: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-control bg-bone px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-small font-medium text-text">{title}</span>
        <span className="type-data flex items-center gap-1 text-text-muted">{sub}</span>
      </div>
      <span className="type-data shrink-0 text-text">{amount}</span>
    </div>
  );
}

export default function StepReview() {
  const { state, dispatch } = useWizard();
  const router = useRouter();
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gen = state.generated;
  const brief = state.brief;
  const { selectedScriptIds, selectedStationIds, selectedInfluencerIds } = state.selections;

  /* Derived once: the launch payload stores it and CALL-E reads it out on the
     call, and those two must never disagree. */
  const flightEnd = flightEndISO(brief.startDate, brief.duration);

  const selectedScripts = (gen?.scripts ?? []).filter(s => selectedScriptIds.includes(s.id));
  const selectedStations = (gen?.stationRecommendations ?? []).filter(s => selectedStationIds.includes(s.stationId));
  const selectedInfluencers = (gen?.influencerMatches ?? []).filter(i => selectedInfluencerIds.includes(i.id));

  /* Null rates are excluded from the sum and counted separately. Treating a
     missing rate as zero would present a guess as a budget, and understate the
     plan by however many lines nobody has priced yet. */
  const stationCost = selectedStations.reduce((s, st) => s + (st.estimatedCostPKR ?? 0), 0);
  const influencerCost = selectedInfluencers.reduce((s, i) => s + (i.estimatedCostPKR ?? 0), 0);
  const unpriced = [
    ...selectedStations.filter(st => st.estimatedCostPKR == null),
    ...selectedInfluencers.filter(i => i.estimatedCostPKR == null),
  ];
  const platformFee = Math.round((stationCost + influencerCost) * 0.1);
  const totalCost = stationCost + influencerCost + platformFee;
  /* Audience size, not campaign reach: station daily listeners plus creator
     followers. Reach for a flight is not a number we hold - see StationRec. */
  const totalAudience = [
    ...selectedStations.map(s => s.estimatedDailyListeners),
    ...selectedInfluencers.map(i => i.estimatedFollowers),
  ].reduce((a: number, b) => a + (b ?? 0), 0);

  const pieData = [
    { name: "Radio", value: stationCost },
    { name: "Influencer", value: influencerCost },
    { name: "Platform Fee", value: platformFee },
  ].filter(d => d.value > 0);

  async function handleLaunch() {
    setLaunching(true);
    setError(null);
    try {
      /* The POST used to carry { name, status } only, so everything computed
         above - the selected scripts, stations and creators, the three cost
         lines and the totals - was discarded the instant the campaign existed.
         It is sent now. Payload only; no call logic is touched. */
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: brief.productName || "Untitled Campaign",
          /* Not ACTIVE. Approving a plan buys nothing: no line is booked and
             no rate has been confirmed on a call. The badge is derived from
             item state anyway (lib/campaign-status.ts), so this is only the
             stored starting point - but it should not be a lie either. */
          status: "PLANNED",

          budgetTotal: brief.totalBudget,
          currency: brief.budgetCurrency,
          durationDays: brief.duration,
          flightStart: brief.startDate || null,
          flightEnd,

          estStationCost: stationCost,
          estInfluencerCost: influencerCost,
          estPlatformFee: platformFee,
          estTotalCost: totalCost,
          estTotalReach: totalAudience,

          brief,

          items: [
            ...selectedStations.map(st => ({
              kind: "STATION" as const,
              externalId: st.stationId,
              name: st.stationName,
              channel: "radio",
              city: st.city,
              estCostPkr: st.estimatedCostPKR,
              estReach: st.estimatedDailyListeners,
              matchScore: st.audienceMatchScore,
              rationale: st.rationale,
              recommendedSlots: st.recommendedSlots,
            })),
            ...selectedInfluencers.map(inf => ({
              kind: "CREATOR" as const,
              /* username, not id. `id` is a per-generation handle ("inf_1")
                 that means nothing outside the response it came in; the
                 catalogue keys creators by username, and so does
                 ARC_CONTACTS. Storing `id` here made the persisted plan item
                 unresolvable on the campaign-detail path, so a call placed
                 from there could never find a number - while the same
                 creator called from this page could. */
              externalId: inf.username,
              name: inf.displayName,
              channel: inf.platform,
              city: inf.city,
              estCostPkr: inf.estimatedCostPKR,
              estReach: inf.estimatedFollowers,
              matchScore: inf.matchScore,
              rationale: inf.matchRationale,
              recommendedSlots: [],
            })),
          ],

          /* Scripts are sent as the brand actually edited them, not as the
             model first wrote them. */
          scripts: selectedScripts.map(sc => {
            const edits = state.editedScripts[sc.id] ?? {};
            const r = { ...sc, ...edits };
            return {
              externalId: r.id,
              language: r.language,
              durationSec: r.duration,
              title: r.title,
              hook: r.hook,
              body: r.body,
              callToAction: r.callToAction,
              voiceDirection: r.voiceDirection,
              bestTimeSlots: r.bestTimeSlots,
              targetSegment: r.targetSegment,
            };
          }),
        }),
      });
      if (!res.ok) throw new Error("Failed to create campaign");
      const { id } = await res.json();
      /* Not SET_DRAFT_ID. This marks the brief FINISHED, which is what stops
         the draft being written back to localStorage - and therefore what
         stops the dashboard offering to resume a brief that is now a live
         campaign, and stops Resume + Launch creating a second one. */
      dispatch({ type: "LAUNCHED", id });
      setLaunched(true);
      setTimeout(() => router.push("/campaigns"), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Launch failed. Please try again.");
    } finally {
      setLaunching(false);
    }
  }

  if (launched) {
    return (
      <div className="flex min-h-96 flex-col items-center justify-center gap-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-pill bg-lilac">
          <Rocket aria-hidden strokeWidth={1.75} className="size-7 text-ink" />
        </span>
        <h2 className="font-display text-h1 text-text">Campaign Launched!</h2>
        <p className="text-body text-text-muted">
          {brief.productName} is live. Redirecting to your dashboard…
        </p>
        <div className="mt-2 h-1 w-52 overflow-hidden rounded-pill bg-hairline">
          <div className="h-full rounded-pill bg-lilac-deep motion-safe:animate-[reviewProgress_2s_linear_forwards] motion-reduce:w-full" />
        </div>
        <style>{`@keyframes reviewProgress { from { width: 0% } to { width: 100% } }`}</style>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        title="Review & Launch"
        subtitle="Your campaign is ready. Review everything below then hit Launch."
        current="review"
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left: accordion sections */}
        <div className="flex flex-col gap-4">
          <Section title="Campaign Brief" icon={ClipboardList}>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ["Product", brief.productName],
                ["Goal", brief.campaignGoal],
                ["Cities", brief.targetCities.join(", ")],
                ["Budget", `${brief.budgetCurrency} ${brief.totalBudget.toLocaleString()}`],
                ["Duration", `${brief.duration} days`],
                ["Tone", brief.tone],
                ["Gender", brief.gender],
                ["Age Range", `${brief.ageMin}–${brief.ageMax}`],
              ].map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1">
                  <dt className="type-label text-text-muted">{k}</dt>
                  <dd className="text-small font-medium text-text capitalize">{v}</dd>
                </div>
              ))}
            </dl>
            {brief.productDescription && (
              <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
                <span className="type-label text-text-muted">Description</span>
                <p className="text-small text-text-muted">{brief.productDescription}</p>
              </div>
            )}
          </Section>

          {selectedScripts.length > 0 && (
            <Section title={`Radio Scripts (${selectedScripts.length})`} icon={Mic}>
              <div className="flex flex-col gap-3">
                {selectedScripts.map(s => <ReviewScriptMini key={s.id} script={s} />)}
              </div>
            </Section>
          )}

          {selectedStations.length > 0 && (
            <Section title={`FM Stations (${selectedStations.length})`} icon={Radio}>
              <div className="flex flex-col gap-2">
                {selectedStations.map(st => (
                  <LineItem
                    key={st.stationId}
                    title={<>{st.stationName} <span className="type-data font-normal text-text-muted">{st.frequency}</span></>}
                    sub={<><MapPin aria-hidden strokeWidth={1.75} className="size-3" />{st.city ?? "city not on file"}
                      {st.estimatedDailyListeners == null ? "" : ` · ${(st.estimatedDailyListeners / 1e6).toFixed(1)}M listeners/day`}</>}
                    amount={st.estimatedCostPKR == null
                      ? "Rate not on file — verify by call"
                      : `PKR ${st.estimatedCostPKR.toLocaleString()}`}
                  />
                ))}
              </div>
            </Section>
          )}

          {selectedInfluencers.length > 0 && (
            <Section title={`Influencers (${selectedInfluencers.length})`} icon={Star}>
              <div className="flex flex-col gap-2">
                {selectedInfluencers.map(inf => (
                  <LineItem
                    key={inf.id}
                    title={inf.displayName}
                    sub={<>@{inf.username} · {inf.platform}
                      {inf.estimatedFollowers == null ? "" : ` · ${(inf.estimatedFollowers / 1000).toFixed(0)}K ${inf.audienceBasis ?? "followers"}`}</>}
                    amount={inf.estimatedCostPKR == null
                      ? "Rate not on file — verify by call"
                      : `PKR ${inf.estimatedCostPKR.toLocaleString()}`}
                  />
                ))}
              </div>
            </Section>
          )}

          {(selectedStations.length + selectedInfluencers.length) > 0 && (
            <Section title="Verify by phone (CALL-E)" icon={Phone}>
              {/* CALL-E integration - untouched. Props are byte-identical to
                  the previous version; only the Section wrapper is restyled. */}
              <BatchCallPanel
                targets={[
                  ...selectedStations.map((st) => ({
                    name: st.stationName,
                    type: "station" as const,
                    channel: "radio",
                    /* The id is what ARC_CONTACTS is keyed by. Without it every
                       station falls back to one demo number and the fan-out
                       collapses to a single call. */
                    externalId: st.stationId,
                    contactName: "the ad sales desk",
                    audienceSize: st.estimatedDailyListeners ?? undefined,
                    /* Without this buildMandate returns null and the call goes
                       out with no target price, no walk-away and no levers.
                       PlanCalling was fixed for the campaign page; this panel
                       is the third place a call is built and it was missed -
                       a call went out from here against a
                       line estimated at 6,000 with no mandate at all. */
                    estimatePkr: st.estimatedCostPKR ?? undefined,
                  })),
                  ...selectedInfluencers.map((inf) => ({
                    name: inf.displayName,
                    type: "creator" as const,
                    channel: inf.platform,
                    externalId: inf.username,
                    contactName: `${inf.displayName} or their manager`,
                    audienceSize: inf.estimatedFollowers ?? undefined,
                    estimatePkr: inf.estimatedCostPKR ?? undefined,
                  })),
                ]}
                context={{
                  /* Dash-aware, same rule as campaign detail. The wizard cannot
                     reach the brand record from the client, so a product name
                     with no dash is still used whole here - see lib/advertiser.ts. */
                  advertiser: advertiserName(state.brief.productName ?? ""),
                  campaignName: state.brief.productName,
                  market: state.brief.primaryCity,
                  audience: state.brief.targetAudience,
                  budgetTotal: state.brief.totalBudget,
                  currency: state.brief.budgetCurrency,
                  /* Without these buildTask falls back to "a 30-day flight
                     starting within the next two weeks" - too vague for a
                     station to quote against. */
                  flightStart: state.brief.startDate || undefined,
                  flightEnd: flightEnd ?? undefined,
                }}
              />
            </Section>
          )}

          {gen?.bestLaunchTiming && (
            <Section title="AI Recommendations" icon={Lightbulb} defaultOpen={false}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5 rounded-control bg-bone p-4">
                  <span className="type-label text-success">Best Launch Timing</span>
                  <p className="text-small text-text">{gen.bestLaunchTiming}</p>
                </div>
                {gen.riskFactors && (
                  <div className="flex flex-col gap-1.5 rounded-control bg-bone p-4">
                    <span className="type-label text-warning">Risk Factors</span>
                    <p className="text-small text-text">{gen.riskFactors}</p>
                  </div>
                )}
              </div>
            </Section>
          )}
        </div>

        {/* Right: budget summary + donut */}
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-5 rounded-card bg-surface p-6 shadow-card">
            <h3 className="font-display text-h3 text-text">Budget Summary</h3>

            {pieData.length > 0 && (
              <div className="flex justify-center">
                <BudgetDonut data={pieData} />
              </div>
            )}

            <div className="flex flex-col gap-3">
              {pieData.map((d, i) => (
                <div key={d.name} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={`size-2.5 shrink-0 rounded-pill ${DONUT_TONES[i % DONUT_TONES.length]}`}
                    />
                    <span className="text-small text-text-muted">{d.name}</span>
                  </span>
                  <span className="type-data text-text">PKR {d.value.toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-5">
              {/* The total covers only the lines that have a rate. Anything
                  else is named rather than silently added as zero: a budget
                  that quietly omits four unpriced stations is worse than one
                  that admits it does not know yet. */}
              {unpriced.length > 0 && (
                <div className="flex items-start gap-2 rounded-control bg-surface-muted p-3">
                  <span className="text-small text-text-muted">
                    <strong className="font-medium text-text">
                      {unpriced.length} line{unpriced.length === 1 ? "" : "s"} have no rate on file
                    </strong>{" "}
                    and are not in this total — {unpriced.map(u => "stationName" in u ? u.stationName : u.displayName).join(", ")}.
                    Arc will phone them for a real rate.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <span className="text-small text-text-muted">
                  Total Cost{unpriced.length > 0 ? " (priced lines only)" : ""}
                </span>
                <span className="type-data text-h3 text-text">PKR {totalCost.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-small text-text-muted">Budget Remaining</span>
                <span className={cn("type-data", totalCost > brief.totalBudget ? "text-danger" : "text-success")}>
                  PKR {(brief.totalBudget - totalCost).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-small text-text-muted">Combined audience</span>
                <span className="type-data text-text">
                  {totalAudience >= 1e6 ? `${(totalAudience / 1e6).toFixed(1)}M` : `${(totalAudience / 1000).toFixed(0)}K`}
                </span>
              </div>
            </div>

            {gen?.generationTimeMs && (
              /* "Generated by Arc AI" was printed over the offline sample plan
                 too - a canned plan credited to a model that never ran, and
                 the only tell was that it took 0.2s instead of 25. The label
                 now follows the path that actually produced it.

                 It does not guess at WHY. The first wording said "no AI key
                 configured", which was wrong the one time it mattered: the key
                 was set and the API was rejecting it. The reason the API gave
                 is printed instead. */
              <div className="flex flex-col gap-1.5 rounded-control bg-bone px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-small text-text-muted">
                    {gen.source === "sample"
                      ? "Sample plan — the model was not reached, this was not generated"
                      : "Generated by Arc AI in"}
                  </span>
                  <span className="type-data text-text-muted">
                    {gen.source === "sample" ? "offline" : `${(gen.generationTimeMs / 1000).toFixed(1)}s`}
                  </span>
                </div>
                {gen.source === "sample" && gen.sampleReason && (
                  <p className="text-small text-text-muted opacity-80">{gen.sampleReason}</p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded-control bg-danger-bg px-4 py-3 text-small text-danger">{error}</p>
            )}

            <div className="flex flex-col gap-2">
              <Button onClick={handleLaunch} disabled={launching} loading={launching} size="lg" className="w-full">
                {launching ? null : <Rocket aria-hidden strokeWidth={1.75} />}
                {launching ? "Launching…" : "Launch Campaign"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => dispatch({ type: "SET_STEP", step: "select" })}
                className="w-full"
              >
                <ArrowLeft aria-hidden strokeWidth={1.75} />
                Edit Selections
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
