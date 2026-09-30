"use client";

import { useState } from "react";
import {
  ArrowRight, BadgeCheck, Camera, CirclePlay, Ghost, MapPin, Music2, Star, Clock, TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Creator, Platform } from "../../_data";
import LiveCallCard from "@/app/_components/LiveCallCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TunerStrip, type TunerSegment, type TunerTone } from "@/components/ui/tuner-strip";

/** Platform identity as an icon, not a brand hex. The old map carried
 *  #E1306C, #69C9D0, #FF0000, #FFFC00 - four foreign palettes inside Arc. */
const PLATFORM_META: Record<Platform, { label: string; Icon: LucideIcon }> = {
  instagram: { label: "Instagram", Icon: Camera },
  tiktok:    { label: "TikTok",    Icon: Music2 },
  youtube:   { label: "YouTube",   Icon: CirclePlay },
  snapchat:  { label: "Snapchat",  Icon: Ghost },
};

/** Same tones, same order as the market list, so a creator's age split looks
 *  identical in both places. */
const AGE_TONES: TunerTone[] = ["lilac", "blush", "butter", "muted"];

/** Avatar tone as a token name - section 9. Mirrors the list. */
const AVATAR_TONES = ["bg-lilac", "bg-blush", "bg-butter"] as const;
function avatarTone(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = id.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_TONES[Math.abs(h) % AVATAR_TONES.length];
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2);
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-control bg-bone p-4">
      <span className="font-display text-h2 leading-none text-text">{value}</span>
      <span className="type-label text-text-muted">{label}</span>
      {sub && <span className="text-small text-text-muted">{sub}</span>}
    </div>
  );
}

/** A percentage bar. Used for cities and the gender split - both are real
 *  numbers in the creator's own demographics. */
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

const CITY_TONES = ["bg-lilac-deep", "bg-blush-deep", "bg-butter-deep", "bg-hairline"];

export interface BrandCampaign {
  id: string;
  name: string;
}

export default function CreatorProfile({
  creator,
  campaigns,
  initialTab = "about",
}: {
  creator: Creator;
  campaigns: BrandCampaign[];
  /** Which tab opens first. Lets a link land on Audience or Book directly. */
  initialTab?: "about" | "audience" | "overview" | "book";
}) {
  const [bookingCampaign, setBookingCampaign] = useState("");
  const [brief, setBrief] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [booked, setBooked] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<{ total: number | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<string>(initialTab);

  /* Every rate the creator actually publishes. The four "packages" this
     replaced - Story/Reel/Full/Custom, priced by invented multipliers like
     pricePost * 1.4 + priceStory * 5 - were pricing rules nothing in the
     catalogue backs. These four numbers are real. */
  const rates = [
    { key: "post",   label: "Instagram Post / Reel", price: creator.pricePost },
    { key: "story",  label: "Story (24h)",           price: creator.priceStory },
    ...(creator.priceVideo  ? [{ key: "video",  label: "YouTube Video",  price: creator.priceVideo }] : []),
    ...(creator.priceShorts ? [{ key: "shorts", label: "YouTube Shorts", price: creator.priceShorts }] : []),
  ];
  const [selectedRate, setSelectedRate] = useState(rates[0].key);
  const rate = rates.find(r => r.key === selectedRate) ?? rates[0];
  const platformFee = Math.round(rate.price * 0.1);

  const ageSegments: TunerSegment[] = creator.demographics.age.map((band, i) => ({
    id: `${creator.id}-${band.label}`,
    label: band.label,
    caption: `${band.value}%`,
    weight: band.value,
    tone: AGE_TONES[i % AGE_TONES.length],
  }));

  /* Was a 1.5s setTimeout that showed "Brief Sent!" and wrote nothing. */
  async function handleBook() {
    if (!bookingCampaign) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: bookingCampaign,
          externalId: creator.id,
          kind: "CREATOR",
          name: creator.displayName,
          channel: creator.primaryPlatform,
          city: creator.city,
          dates: preferredDate ? [preferredDate] : [],
          slots: [],
          ratePkr: rate.price,
          spots: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed.");
      setBookingResult({ total: data.bookedTotalPkr });
      setBooked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBooking(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-start gap-5">
        <span
          className={`flex size-20 shrink-0 items-center justify-center rounded-pill font-display text-h2 text-ink ${avatarTone(creator.id)}`}
          aria-hidden
        >
          {initials(creator.displayName)}
        </span>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-h1 text-text">{creator.displayName}</h1>
            {creator.isVerified && (
              <Badge variant="lilac">
                <BadgeCheck aria-hidden strokeWidth={2} />
                Arc Verified
              </Badge>
            )}
            {!creator.isAvailableNow && <Badge variant="butter">Currently Booked</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-text-muted">
            <span className="type-data">@{creator.username}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1.5">
              <MapPin aria-hidden strokeWidth={1.75} className="size-4" />
              {creator.city}
            </span>
            <span aria-hidden>·</span>
            <span className="flex flex-wrap gap-2">
              {creator.platforms.map(p => {
                const meta = PLATFORM_META[p];
                return (
                  <Badge key={p} variant="outline">
                    <meta.Icon aria-hidden strokeWidth={1.75} />
                    {meta.label}
                  </Badge>
                );
              })}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {creator.niche.map(n => <Badge key={n} variant="muted">{n}</Badge>)}
          </div>
        </div>

        <Button variant="outline" onClick={() => setSaved(s => !s)} aria-pressed={saved}>
          <Star aria-hidden strokeWidth={1.75} className={saved ? "fill-butter-deep text-butter-deep" : undefined} />
          {saved ? "Saved" : "Save"}
        </Button>
      </header>

      {/* Five real figures, straight from the catalogue entry. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Followers" value={fmtNum(creator.followers)} sub={PLATFORM_META[creator.primaryPlatform].label} />
        <Stat
          label="Engagement"
          value={`${creator.engagementRate}%`}
          sub={creator.engagementRate >= 7 ? "Excellent" : creator.engagementRate >= 4 ? "Good" : "Average"}
        />
        <Stat label="Avg Views" value={fmtNum(creator.avgViews)} />
        {/* "Campaigns completed" and "Brand Rating x/5, n reviews" stood here.
            Arc has run no campaigns for these creators and has no review
            system, so both counted things that do not exist. */}
      </div>

      {/* Portfolio is gone. It generated nine posts per creator from a table
          of invented captions, with views derived from avgViews and likes from
          the engagement rate - fabricated work attributed to a real named
          person. Nothing in the catalogue backs it, so there was nothing to
          rebuild it from. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="about">About</TabsTrigger>
          <TabsTrigger value="audience">Audience</TabsTrigger>
          <TabsTrigger value="book">Book</TabsTrigger>
        </TabsList>

        <TabsContent value="about" className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>About {creator.displayName}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {/* The directory says this once at the top of the list. Someone
                    linked straight to a profile never sees that, and this page
                    is the one carrying a name, a bio and a price. */}
                <p className="max-w-prose text-small leading-relaxed text-text-muted">
                  This is a demo persona, not a real account. Figures below are
                  estimates until a call confirms them.
                </p>
                <p className="max-w-prose text-body leading-relaxed text-text-muted">{creator.bio}</p>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <span className="type-label text-text-muted">Content Types</span>
                    <span className="flex flex-wrap gap-2">
                      {creator.contentTypes.map(ct => <Badge key={ct} variant="outline">{ct}</Badge>)}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span className="type-label text-text-muted">Languages</span>
                    <span className="flex flex-wrap gap-2">
                      {creator.languages.map(l => <Badge key={l} variant="lilac">{l}</Badge>)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Was five rows; four of them - deliverables, lead time, revisions,
                report timing - were invented terms this creator never agreed
                to. Response time is the one Arc actually holds. */}
            <Card>
              <CardHeader>
                <CardTitle>Working With {creator.displayName}</CardTitle>
              </CardHeader>
              <CardContent className="flex items-center gap-3">
                <Clock aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-muted" />
                <span className="text-body text-text">{creator.responseTime}</span>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-4 lg:sticky lg:top-24">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Pricing</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {rates.map(r => (
                  <div key={r.key} className="flex items-baseline justify-between gap-3">
                    <span className="text-small text-text-muted">{r.label}</span>
                    <span className="type-data text-text">PKR {r.price.toLocaleString()}</span>
                  </div>
                ))}
                <Button className="mt-2 w-full" onClick={() => setTab("book")}>
                  Book {creator.displayName}
                  <ArrowRight aria-hidden strokeWidth={1.75} />
                </Button>
              </CardContent>
            </Card>

            <LiveCallCard
              target={{
                name: creator.displayName,
                type: "creator",
                channel: creator.primaryPlatform,
                /* Same reason as the station card: without the catalogue id
                   there is nothing to resolve a number from. */
                externalId: creator.id,
                contactName: `${creator.displayName} or their manager`,
                audienceSize: creator.followers,
                estimatePkr: creator.pricePost,
              }}
            />
          </div>
        </TabsContent>

        <TabsContent value="audience" className="flex flex-col gap-6">
          {/* The market list shows this creator's age split as a strip. Here
              the same real numbers carry further: the bands are named with
              their weights, and gender and city shares sit beside them. */}
          <Card>
            <CardHeader>
              <CardTitle>Audience Age</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <TunerStrip
                segments={ageSegments}
                label={`${creator.displayName} audience age split`}
              />
              <p className="text-small text-text-muted">
                Reported range {creator.audienceAgeRange}.
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Gender</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ShareBar label="Female" pct={creator.audienceFemale} tone="bg-blush-deep" />
                <ShareBar label="Male" pct={100 - creator.audienceFemale} tone="bg-lilac-deep" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Cities</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {creator.demographics.topCities.map((c, i) => (
                  <ShareBar key={c.city} label={c.city} pct={c.pct} tone={CITY_TONES[i % CITY_TONES.length]} />
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="book">
          {booked ? (
            <Card>
              <CardContent className="mx-auto flex max-w-lg flex-col items-center gap-4 py-8 text-center">
                <h2 className="font-display text-h1 text-text">Booking saved</h2>
                {/* The old copy said the brief had been sent to the creator and
                    that they typically respond within a given time. Nothing is
                    sent to anyone - this states what was written instead. */}
                <p className="text-body leading-relaxed text-text-muted">
                  <strong className="font-medium text-text">{creator.displayName}</strong> was added to your
                  campaign&apos;s media plan{bookingResult?.total != null ? ` at PKR ${bookingResult.total.toLocaleString()}` : ""}.
                </p>
                <Button variant="outline" onClick={() => { setBooked(false); setBookingResult(null); }}>Send Another Brief</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Link to Campaign</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {campaigns.length === 0 ? (
                      <p className="text-small text-text-muted">
                        You have no campaigns yet. A booking is added to a campaign&apos;s media plan, so create one first.
                      </p>
                    ) : (
                      <>
                        <Label htmlFor="booking-campaign">Campaign (required)</Label>
                        {/* Native select: the shadcn Select is a listbox that
                            needs a portal, and this form has no other radix
                            surface. Styled to match Input. */}
                        <select
                          id="booking-campaign"
                          value={bookingCampaign}
                          onChange={e => setBookingCampaign(e.target.value)}
                          className="h-10 rounded-control border border-border bg-surface px-3 text-small text-text outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <option value="">Select a campaign</option>
                          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Select Rate</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {rates.map(r => {
                      const isSel = selectedRate === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => setSelectedRate(r.key)}
                          aria-pressed={isSel}
                          className={`flex cursor-pointer flex-col gap-2 rounded-control p-4 text-left outline-none transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none ${
                            isSel ? "bg-lilac text-ink" : "bg-bone text-text hover:bg-lilac/40"
                          }`}
                        >
                          <span className="text-small font-medium">{r.label}</span>
                          <span className="type-data">PKR {r.price.toLocaleString()}</span>
                        </button>
                      );
                    })}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Campaign Brief</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={brief}
                      onChange={e => setBrief(e.target.value)}
                      className="min-h-30"
                      placeholder={`Describe what you'd like ${creator.displayName} to show or say. Include: key messages, product features to highlight, tone preference, and any words/phrases to avoid.`}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Preferred Posting Dates</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    <Input
                      type="date"
                      value={preferredDate}
                      onChange={e => setPreferredDate(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                      className="w-fit"
                    />
                    <p className="text-small text-text-muted">
                      Creator will confirm availability and may propose an alternative date.
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card size="sm" className="lg:sticky lg:top-24">
                <CardContent className="flex flex-col gap-5">
                  <div className="flex items-center gap-3 border-b border-hairline pb-4">
                    <span
                      className={`flex size-11 shrink-0 items-center justify-center rounded-pill text-small font-medium text-ink ${avatarTone(creator.id)}`}
                      aria-hidden
                    >
                      {initials(creator.displayName)}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-small font-medium text-text">{creator.displayName}</span>
                      <span className="type-data truncate text-text-muted">@{creator.username}</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-3">
                    <span className="type-label text-text-muted">Order Summary</span>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-small text-text-muted">{rate.label}</span>
                      <span className="type-data text-text">PKR {rate.price.toLocaleString()}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-small text-text-muted">Arc platform fee (10%)</span>
                      <span className="type-data text-text">PKR {platformFee.toLocaleString()}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 border-t border-hairline pt-3">
                      <span className="text-small font-medium text-text">Total</span>
                      <span className="type-data font-medium text-text">PKR {(rate.price + platformFee).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {error && (
                      <div className="flex items-start gap-3 rounded-control bg-danger-bg p-4" role="alert">
                        <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-danger" />
                        <p className="text-small leading-relaxed text-danger">{error}</p>
                      </div>
                    )}
                    <Button onClick={handleBook} disabled={booking || !bookingCampaign}>
                      {booking
                        ? "Sending…"
                        : !bookingCampaign
                          ? "Select a campaign to book"
                          : <>Send Brief &amp; Book <ArrowRight aria-hidden strokeWidth={1.75} /></>}
                    </Button>
                    <Button variant="outline" onClick={() => setSaved(true)}>
                      <Star aria-hidden strokeWidth={1.75} />
                      Save to Shortlist
                    </Button>
                  </div>

                  {/* "Payment held in escrow until campaign is delivered" was
                      here. No money moves anywhere in this flow, so the claim
                      is gone rather than marked. */}
                  <p className="text-center text-small leading-relaxed text-text-muted">
                    {creator.responseTime}.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
