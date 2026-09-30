"use client";

import { useState } from "react";
import { BadgeCheck, MapPin, Star, Users, Languages, Gem, Radio as RadioIcon } from "lucide-react";

import type { Station } from "../../_data";
import BookingSidebar, { type BrandCampaign } from "./BookingSidebar";
import ScheduleGrid from "./ScheduleGrid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TunerStrip, type TunerSegment, type TunerTone } from "@/components/ui/tuner-strip";

/** Same map as the directory card, so a slot reads identically in both. */
const AVAILABILITY_TONE: Record<Station["slots"][number]["availability"], TunerTone> = {
  available: "lilac",
  limited: "butter",
  full: "muted",
};
const AGE_TONES: TunerTone[] = ["lilac", "blush", "butter", "muted"];
const CITY_TONES = ["bg-lilac-deep", "bg-blush-deep", "bg-butter-deep", "bg-hairline"];

/**
 * The daypart strip, going further than the directory card's version. There it
 * shows which parts of the day are open. Here each segment also carries the
 * station's real rate for that slot and how many spots are left, so the strip
 * is the rate card - all of it straight from station.slots.
 */
function daypartSegments(station: Station): TunerSegment[] {
  return station.slots.map(slot => ({
    id: slot.id,
    label: slot.time,
    caption: `PKR ${(slot.priceBase / 1000).toFixed(0)}K${slot.slotsLeft ? ` · ${slot.slotsLeft} left` : ""}`,
    weight: Math.max(1, slot.endHour - slot.startHour),
    tone: AVAILABILITY_TONE[slot.availability] ?? "lilac",
  }));
}

function ShareBar({ label, pct, tone }: { label: string; pct: number; tone: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-small text-text">{label}</span>
        <span className="type-data text-text-muted">{pct}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-bone">
        <div className={`h-full rounded-pill ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StationProfile({
  station,
  campaigns,
  initialTab = "overview",
}: {
  station: Station;
  campaigns: BrandCampaign[];
  /** Which tab opens first. Lets a link land on Schedule or Reviews. */
  initialTab?: "overview" | "audience" | "schedule";
}) {
  const [tab, setTab] = useState<string>(initialTab);

  const ageSegments: TunerSegment[] = station.demographics.age.map((band, i) => ({
    id: `${station.id}-${band.label}`,
    label: band.label,
    caption: `${band.value}%`,
    weight: band.value,
    tone: AGE_TONES[i % AGE_TONES.length],
  }));

  const facts = [
    { Icon: RadioIcon, text: `${(station.dailyListeners / 1e6).toFixed(1)}M Listeners` },
    { Icon: MapPin,    text: station.city },
    { Icon: Users,     text: `${station.ageRange} · ${station.genderFemale}% female` },
    { Icon: Languages, text: station.language.join(" / ") },
    { Icon: Gem,       text: station.socioeconomic },
  ];

  return (
    <>
      {/* The 180px station-colour banner with its decorative circles, blurred
          avatar and pulsing "Live Now" badge is gone. Nothing in the catalogue
          says a station is on air right now. */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-h1 text-text">{station.name}</h1>
          <p className="text-body text-text-muted">
            {station.frequency} · {station.allCities.join(", ")} · {station.genre}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2">
            {/* A star rating and "23 brand reviews" stood here. There is no
                review system, so there were no reviewers. */}
          </span>
          <span aria-hidden className="text-text-muted">·</span>
          <span aria-hidden className="text-text-muted">·</span>
          <Badge variant="lilac">
            <BadgeCheck aria-hidden strokeWidth={2} />
            Verified by Arc
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          {facts.map(f => (
            <Badge key={f.text} variant="outline">
              <f.Icon aria-hidden strokeWidth={1.75} />
              {f.text}
            </Badge>
          ))}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px] xl:items-start">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="audience">Audience</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Daypart Availability</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <TunerStrip
                  segments={daypartSegments(station)}
                  label={`${station.name} daypart availability and rates`}
                />
                <div className="flex flex-wrap gap-4">
                  {([
                    ["lilac",  "bg-lilac",    "Available"],
                    ["butter", "bg-butter",   "Limited"],
                    ["muted",  "bg-hairline", "Full"],
                  ] as const).map(([key, fill, label]) => (
                    <span key={key} className="flex items-center gap-2">
                      <span aria-hidden className={`size-3 rounded-[4px] ${fill}`} />
                      <span className="text-small text-text-muted">{label}</span>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Assembled from the catalogue, not written. This card used to
                hold three paragraphs about a real company that nobody at
                that company had said - superlatives about its standing and
                claims about which segments it dominates. What is left is what
                the catalogue actually holds, every figure named as an
                estimate. */}
            <Card>
              <CardHeader>
                <CardTitle>About {station.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="max-w-prose text-body leading-relaxed text-text-muted">
                  {station.name} broadcasts on {station.frequency} in{" "}
                  {station.allCities.join(", ")}. Format: {station.genre}, in{" "}
                  {station.language.join(" and ")}.
                </p>
                <p className="max-w-prose text-body leading-relaxed text-text-muted">
                  Catalogue estimates: {station.dailyListeners.toLocaleString()} daily
                  listeners, spot rates from PKR {station.priceMin.toLocaleString()}.
                  These are estimates held for planning — a rate is confirmed
                  only by a call, and shown as confirmed only then.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Coverage Area</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  {station.allCities.map(city => (
                    <Badge key={city} variant="lilac">{city}</Badge>
                  ))}
                </div>
                <p className="text-small text-text-muted">
                  {station.allCities.length === 1
                    ? `Focused local coverage across ${station.allCities[0]} Metropolitan Area`
                    : "Simultaneous national broadcast reaching all major cities"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prime dayparts</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {station.shows.filter(s => s.type !== "offpeak").map(show => (
                  <div
                    /* Keyed on the hours: a daypart is unique within a day,
                       and the invented show name it used to key on is gone. */
                    key={`${show.startHour}-${show.endHour}`}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-control bg-bone p-4"
                  >
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-small font-medium text-text">{show.genre}</span>
                      <span className="text-small text-text-muted">{show.time}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge variant={show.type === "prime" ? "butter" : "outline"}>
                        {show.type === "prime" ? "Prime Time" : "Standard"}
                      </Badge>
                      <span className="text-small text-text-muted">{show.genre}</span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="audience" className="flex flex-col gap-6">
            {/* Was a recharts pie and bar pair. Same real numbers, on the same
                strip the directory card and the creator pages use. */}
            <Card>
              <CardHeader>
                <CardTitle>Age Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <TunerStrip segments={ageSegments} label={`${station.name} listener age split`} />
                <p className="text-small text-text-muted">Reported range {station.ageRange}.</p>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Gender</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <ShareBar label="Female" pct={station.demographics.genderFemale} tone="bg-blush-deep" />
                  <ShareBar label="Male" pct={100 - station.demographics.genderFemale} tone="bg-lilac-deep" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Where They Listen</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {station.demographics.cityBreakdown.map((c, i) => (
                    <ShareBar key={c.city} label={c.city} pct={c.pct} tone={CITY_TONES[i % CITY_TONES.length]} />
                  ))}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Income</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-body text-text-muted">{station.demographics.income}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Languages</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {station.demographics.topLanguages.map(l => (
                    <Badge key={l} variant="lilac">{l}</Badge>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="schedule">
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Programming Schedule</CardTitle>
                <span className="text-small text-text-muted">Times in PKT (UTC+5)</span>
              </CardHeader>
              <CardContent>
                <ScheduleGrid shows={station.shows} bestFor={station.bestFor} />
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>

        <div className="xl:sticky xl:top-24">
          <BookingSidebar
            slots={station.slots}
            stationName={station.name}
            stationId={station.id}
            city={station.city}
            campaigns={campaigns}
          />
        </div>
      </div>
    </>
  );
}
