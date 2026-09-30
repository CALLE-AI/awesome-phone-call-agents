"use client";

import { useState } from "react";
import { Check, MapPin, Radio, Star, Camera, Music2, CirclePlay } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useWizard } from "./WizardContext";
import type { StationRec, InfluencerMatch } from "./WizardContext";
import { StepHeader, StepActions } from "./WizardChrome";
import AddFromDirectory from "./AddFromDirectory";

/**
 * Platform identity is an icon plus its name, not a brand colour. lucide v1
 * dropped brand marks, and the old PLATFORM_COLOR hex (#E1306C etc) was raw
 * brand colour concatenated with alpha suffixes - the pattern BRANDING.md
 * section 9 rules out. Neutral icons keep the screen inside the token system.
 */
const PLATFORM_ICON: Record<string, LucideIcon> = {
  instagram: Camera,
  tiktok: Music2,
  youtube: CirclePlay,
};

function ScoreBar({ score }: { score: number | null }) {
  /* Nothing scored this line - the buyer added it from the directory. A bar
     at zero would read as "Arc rated your own choice 0 out of 100", which is
     a claim, and a false one. Say what happened instead. */
  if (score == null) {
    return (
      <span className="type-data w-fit rounded-pill bg-hairline px-2.5 py-1 text-text-muted">
        You added this — not scored by Arc
      </span>
    )
  }
  // The bar may be pastel; the number may not - pastels are fills, never text.
  const bar = score >= 85 ? "bg-success" : score >= 70 ? "bg-lilac-deep" : "bg-warning";
  const num = score >= 85 ? "text-success" : score >= 70 ? "text-text" : "text-warning";
  return (
    <div className="flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-pill bg-hairline">
        <div
          className={cn("h-full rounded-pill transition-[width] duration-700 ease-out motion-reduce:transition-none", bar)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn("type-data min-w-7 text-right", num)}>{score}</span>
    </div>
  );
}

function SelectMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-pill border-2 transition-colors motion-reduce:transition-none",
        selected ? "border-ink bg-ink text-paper" : "border-border text-transparent"
      )}
    >
      <Check strokeWidth={3} className="size-3.5" />
    </span>
  );
}

function MetaPill({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="gap-1.5 normal-case tracking-normal">
      {Icon ? <Icon aria-hidden strokeWidth={1.75} /> : null}
      {children}
    </Badge>
  );
}

function StationCard({ station }: { station: StationRec }) {
  const { state, dispatch } = useWizard();
  const isSelected = state.selections.selectedStationIds.includes(station.stationId);

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => dispatch({ type: "TOGGLE_STATION", id: station.stationId })}
      className={cn(
        "flex w-full flex-col gap-4 rounded-card bg-surface p-6 text-left shadow-card transition-colors motion-reduce:transition-none",
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        isSelected && "bg-lilac/40 ring-2 ring-lilac-deep"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-display text-h3 text-text">{station.stationName}</h3>
            <span className="type-data text-text-muted">{station.frequency}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <MetaPill icon={MapPin}>{station.city}</MetaPill>
          </div>
        </div>
        <SelectMark selected={isSelected} />
      </div>

      <div className="flex flex-col gap-2">
        {station.audienceMatchScore != null && (
          <span className="type-label text-text-muted">Audience Match</span>
        )}
        <ScoreBar score={station.audienceMatchScore} />
      </div>

      <p className="text-small text-text-muted">{station.audienceProfile}</p>

      <div className="flex flex-wrap gap-2">
        {station.recommendedSlots.map(slot => (
          <Badge key={slot} variant="lilac">{slot}</Badge>
        ))}
      </div>

      <div className="flex items-end justify-between border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          {/* The catalogue's own figure, not a campaign projection. Labelled
              for what it is: how many people listen to this station in a day,
              not how many this flight will reach. */}
          <span className="type-label text-text-muted">Listeners / day</span>
          <span className="type-data text-success">
            {station.estimatedDailyListeners == null
              ? "not on file"
              : `${(station.estimatedDailyListeners / 1e6).toFixed(1)}M`}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="type-label text-text-muted">Campaign Cost</span>
          {/* Most of the catalogue has no rate on file. Saying so is the
              product's argument, not a gap in it - finding out what they
              charge is what the call is for. A zero here would read as free. */}
          <span className={`type-data ${station.estimatedCostPKR == null ? "text-text-muted" : "text-text"}`}>
            {station.estimatedCostPKR == null
              ? "Rate not on file — verify by call"
              : `PKR ${station.estimatedCostPKR.toLocaleString()}`}
          </span>
        </div>
      </div>

      {station.rationale && station.rationale !== "..." && (
        <p className="text-small text-text-muted italic">{station.rationale}</p>
      )}
    </button>
  );
}

function InfluencerCard({ inf }: { inf: InfluencerMatch }) {
  const { state, dispatch } = useWizard();
  const isSelected = state.selections.selectedInfluencerIds.includes(inf.id);
  const Icon = PLATFORM_ICON[inf.platform] ?? Camera;

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => dispatch({ type: "TOGGLE_INFLUENCER", id: inf.id })}
      className={cn(
        "flex w-full flex-col gap-4 rounded-card bg-surface p-6 text-left shadow-card transition-colors motion-reduce:transition-none",
        "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        isSelected && "bg-lilac/40 ring-2 ring-lilac-deep"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-pill bg-bone text-text">
            <Icon aria-hidden strokeWidth={1.75} className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="font-medium text-text">{inf.displayName}</span>
            <span className="type-data text-text-muted">@{inf.username}</span>
          </div>
        </div>
        <SelectMark selected={isSelected} />
      </div>

      <div className="flex flex-col gap-2">
        {inf.matchScore != null && (
          <span className="type-label text-text-muted">Match Score</span>
        )}
        <ScoreBar score={inf.matchScore} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="lilac" className="capitalize">{inf.platform}</Badge>
        <MetaPill icon={MapPin}>{inf.city}</MetaPill>
        <MetaPill>{inf.niche}</MetaPill>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <StatMini
          label={inf.audienceBasis ? inf.audienceBasis.replace(/^\w/, (c) => c.toUpperCase()) : "Audience"}
          value={
            inf.estimatedFollowers == null
              ? "not on file"
              : inf.estimatedFollowers >= 1000
                ? `${(inf.estimatedFollowers / 1000).toFixed(0)}K`
                : String(inf.estimatedFollowers)
          }
        />
        <StatMini label="Platform" value={inf.platform} />
        <StatMini label="Niche" value={inf.niche ?? "not on file"} />
      </dl>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <span className="text-small text-text-muted">{inf.city ?? ""}</span>
        <span className={`type-data ${inf.estimatedCostPKR == null ? "text-text-muted" : "text-text"}`}>
          {inf.estimatedCostPKR == null
            ? "Rate not on file — verify by call"
            : `PKR ${inf.estimatedCostPKR.toLocaleString()}`}
        </span>
      </div>

      {inf.matchRationale && inf.matchRationale !== "..." && (
        <p className="text-small text-text-muted italic">{inf.matchRationale}</p>
      )}
    </button>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label text-text-muted">{label}</dt>
      <dd className="type-data text-text">{value}</dd>
    </div>
  );
}

export default function StepSelect() {
  const { state, dispatch } = useWizard();
  const [tab, setTab] = useState<"radio" | "influencer">("radio");
  const stations = state.generated?.stationRecommendations ?? [];
  const influencers = state.generated?.influencerMatches ?? [];
  const selectedStations = state.selections.selectedStationIds.length;
  const selectedInfluencers = state.selections.selectedInfluencerIds.length;
  const hasRadio = state.brief.channels.includes("radio");
  const hasInfluencer = state.brief.channels.includes("influencer");
  const canContinue = (!hasRadio || selectedStations > 0) && (!hasInfluencer || selectedInfluencers > 0);

  // Totals
  /* A line with no rate on file contributes nothing to the total and is
     COUNTED instead. Adding it as zero would quietly understate the plan and
     present a guess as a budget. */
  const pickedStations = stations.filter(s => state.selections.selectedStationIds.includes(s.stationId));
  const pickedInfluencers = influencers.filter(i => state.selections.selectedInfluencerIds.includes(i.id));
  const stationCost = pickedStations.reduce((sum, s) => sum + (s.estimatedCostPKR ?? 0), 0);
  const influencerCost = pickedInfluencers.reduce((sum, i) => sum + (i.estimatedCostPKR ?? 0), 0);
  const unpricedCount =
    pickedStations.filter(s => s.estimatedCostPKR == null).length +
    pickedInfluencers.filter(i => i.estimatedCostPKR == null).length;

  return (
    <div className="flex flex-col gap-8">
      <StepHeader
        title="Select Stations & Influencers"
        subtitle="Arc AI ranked these by audience fit. Select all you want to include in your campaign."
        current="select"
      />

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-card bg-surface px-6 py-4 shadow-card">
        {hasRadio && (
          <div className="flex items-center gap-2">
            <Radio aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
            <span className="text-small text-text-muted">
              <strong className="type-data text-text">{selectedStations}</strong> stations · PKR {stationCost.toLocaleString()}
            </span>
          </div>
        )}
        {hasInfluencer && (
          <div className="flex items-center gap-2">
            <Star aria-hidden strokeWidth={1.75} className="size-4 text-text-muted" />
            <span className="text-small text-text-muted">
              <strong className="type-data text-text">{selectedInfluencers}</strong> influencers · PKR {influencerCost.toLocaleString()}
            </span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-small text-text-muted">Total est. cost:</span>
          <span className="type-data text-success">PKR {(stationCost + influencerCost).toLocaleString()}</span>
          {/* The total is only the priced lines. Saying how many are missing
              is the difference between an estimate and an understatement. */}
          {unpricedCount > 0 && (
            <span className="text-small text-text-muted">
              + {unpricedCount} line{unpricedCount === 1 ? "" : "s"} with no rate on file
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      {hasRadio && hasInfluencer && (
        <Tabs value={tab} onValueChange={v => setTab(v as "radio" | "influencer")}>
          <TabsList className="w-full">
            <TabsTrigger value="radio" className="flex-1">
              <Radio aria-hidden strokeWidth={1.75} />
              FM Stations
              {selectedStations > 0 ? <Badge variant="lilac">{selectedStations}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value="influencer" className="flex-1">
              <Star aria-hidden strokeWidth={1.75} />
              Influencers
              {selectedInfluencers > 0 ? <Badge variant="lilac">{selectedInfluencers}</Badge> : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {/* Station list */}
      {(tab === "radio" || !hasInfluencer) && hasRadio && (
        <div className="flex flex-col gap-4">
          {/* An empty list used to render an empty div, while Continue stayed
              disabled because it needs a ticked station. Blank screen, no
              reason, no way on. */}
          {stations.length === 0 && (
            <div className="flex flex-col gap-2 rounded-card bg-surface p-6 shadow-card">
              <span className="font-medium text-text">Arc did not match any stations</span>
              <span className="text-small text-text-muted">
                That is a result, not a failure - it found nothing it could argue for against this
                brief. Choose the stations yourself below.
              </span>
            </div>
          )}
          {stations.map(station => <StationCard key={station.stationId} station={station} />)}
          <AddFromDirectory kind="station" />
        </div>
      )}

      {/* Influencer grid */}
      {(tab === "influencer" || !hasRadio) && hasInfluencer && (
        <div className="flex flex-col gap-4">
          {influencers.length === 0 && (
            <div className="flex flex-col gap-2 rounded-card bg-surface p-6 shadow-card">
              <span className="font-medium text-text">Arc did not match any creators</span>
              <span className="text-small text-text-muted">
                That is a result, not a failure - it found nothing it could argue for against this
                brief. Choose the creators yourself below.
              </span>
            </div>
          )}
          {influencers.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {influencers.map(inf => <InfluencerCard key={inf.id} inf={inf} />)}
            </div>
          )}
          <AddFromDirectory kind="creator" />
        </div>
      )}

      <StepActions
        backLabel="Back"
        onBack={() => dispatch({ type: "SET_STEP", step: "scripts" })}
        primaryLabel={canContinue ? "Review & Launch Campaign" : "Select at least one option to continue"}
        onPrimary={() => dispatch({ type: "SET_STEP", step: "review" })}
        primaryDisabled={!canContinue}
      />
    </div>
  );
}
