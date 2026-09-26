"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Camera, Music2, CirclePlay, Ghost, Star, BadgeCheck, Users, Plus, ArrowRight as ArrowRightIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TunerStrip, type TunerSegment, type TunerTone } from "@/components/ui/tuner-strip";
import { cn } from "@/lib/utils";
import { monogramInitials, monogramTone } from "@/lib/monogram";
import {
  CampaignSelect,
  AddResult,
  useAddToCampaign,
  type BrandCampaign,
} from "@/app/_components/CampaignPicker";
import { ArrowRight } from "lucide-react";
import type { Creator, Platform } from "../_data";

/**
 * One row of the directory: what the Contact table holds, plus the rich
 * `_data.ts` write-up when we happen to have one.
 *
 * The catalogue is 32 creators and eight are written up. The directory used to
 * list those eight and call it the market - "32 verified" in the header over
 * eight cards - while plan generation was already recommending the other 24.
 * Every contact is listed now; the ones without a write-up get a shorter card
 * rather than an invented engagement rate, an invented rating and reviews from
 * campaigns that never happened.
 */
export interface DirectoryCreator {
  externalId: string;
  name: string;
  handle: string;
  channel: string | null;
  city: string | null;
  category: string | null;
  audience: number | null;
  audienceBasis: string | null;
  rateEstimatePkr: number | null;
  hasPhone: boolean;
  detail: Creator | null;
}

/**
 * The row as the filters see it.
 *
 * Everything the write-up owns is NULL for a contact we have not written up -
 * never zero and never false-as-a-value. A null here means "not on file", and
 * every filter and sort below has to decide what to do about it rather than
 * treating the absence as a small number.
 */
export interface Row extends DirectoryCreator {
  platforms: Platform[];
  niche: string[];
  followers: number | null;
  engagementRate: number | null;
  pricePost: number | null;
  audienceFemale: number | null;
  languages: string[];
  isVerified: boolean;
  isAvailableNow: boolean;
  aiMatchScore: number | null;
}

const KNOWN_PLATFORMS = ["instagram", "tiktok", "youtube", "snapchat"] as const;
const asPlatform = (v: string | null): Platform | null =>
  (KNOWN_PLATFORMS as readonly string[]).includes(v ?? "") ? (v as Platform) : null;

export function toRow(item: DirectoryCreator): Row {
  const d = item.detail;
  const channelPlatform = asPlatform(item.channel);
  return {
    ...item,
    /* The contact's channel is real data even without a write-up, so a
       platform filter still works for all 32. */
    platforms: d?.platforms ?? (channelPlatform ? [channelPlatform] : []),
    niche: d?.niche ?? (item.category ? [item.category] : []),
    followers: d?.followers ?? item.audience,
    pricePost: d?.pricePost ?? item.rateEstimatePkr,
    /* Written up or not on file. There is no third answer we could stand
       behind, and a made-up 4.5% engagement rate on a real person's card is
       the kind of number a media buyer would act on. */
    engagementRate: d?.engagementRate ?? null,
    audienceFemale: d?.audienceFemale ?? null,
    languages: d?.languages ?? [],
    isVerified: d?.isVerified ?? false,
    isAvailableNow: d?.isAvailableNow ?? false,
    aiMatchScore: d?.aiMatchScore ?? null,
  };
}

/* ─── Platform helpers ─── */
/** Platform identity is an icon plus its name. The old map held brand hex
 *  (#E1306C, #69C9D0, #FF0000, #FFFC00) concatenated with alpha suffixes -
 *  the pattern section 9 rules out, and lucide v1 dropped brand marks anyway. */
const PLATFORM_META: Record<Platform, { label: string; Icon: LucideIcon }> = {
  instagram: { label: "Instagram", Icon: Camera },
  tiktok:    { label: "TikTok",    Icon: Music2 },
  youtube:   { label: "YouTube",   Icon: CirclePlay },
  snapchat:  { label: "Snapchat",  Icon: Ghost },
};

/** Audience age split, straight from the creator's own demographics. Every
 *  creator carries four bands. This replaces a banner of "mock content
 *  thumbnail colors" derived from a raw creator.color - invented content
 *  attached to a real named person. */
const AGE_TONES: TunerTone[] = ["lilac", "blush", "butter", "muted"];

function audienceSegments(creator: Creator): TunerSegment[] {
  return creator.demographics.age.map((band, i) => ({
    id: `${creator.id}-${band.label}`,
    label: band.label,
    caption: `${band.value}%`,
    weight: band.value,
    tone: AGE_TONES[i % AGE_TONES.length],
  }));
}

/* Avatar tone and initials come from lib/monogram, shared with the station
   directory, so one entity is one colour everywhere it appears. */
const avatarTone = monogramTone;

const FOLLOWER_RANGES = [
  { key: "nano",    label: "Nano",     sub: "1K–10K",     min: 0,      max: 10000 },
  { key: "micro",   label: "Micro",    sub: "10K–100K",   min: 10000,  max: 100000 },
  { key: "midtier", label: "Mid-Tier", sub: "100K–500K",  min: 100000, max: 500000 },
  { key: "macro",   label: "Macro",    sub: "500K+",      min: 500000, max: Infinity },
  { key: "any",     label: "Any",      sub: "",           min: 0,      max: Infinity },
];

const ENG_RANGES = [
  { key: "any",   label: "Any",       min: 0,  max: 100 },
  { key: "low",   label: "Below 3%",  min: 0,  max: 3 },
  { key: "mid",   label: "3–6%",      min: 3,  max: 6 },
  { key: "good",  label: "6–9%",      min: 6,  max: 9 },
  { key: "great", label: "Above 9%",  min: 9,  max: 100 },
];

const PRICE_RANGES = [
  { key: "any",    label: "Any",              max: Infinity },
  { key: "budget", label: "Under PKR 10K",    max: 10000 },
  { key: "mid",    label: "PKR 10K–25K",      max: 25000 },
  { key: "premium",label: "PKR 25K+",         max: Infinity, min: 25000 },
];

const SORT_OPTIONS = [
  { key: "match",     label: "AI Match Score" },
  { key: "engagement",label: "Engagement" },
  { key: "followers", label: "Followers" },
  { key: "price-low", label: "Price: Low" },
  { key: "price-high",label: "Price: High" },
];

/* ─── Filter sidebar section ─── */
function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 16, marginBottom: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 0 10px", cursor: "pointer" }}
      >
        <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase" }}>{title}</span>
        <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
          {open ? <path d="M18 15l-6-6-6 6"/> : <path d="M6 9l6 6 6-6"/>}
        </svg>
      </button>
      {open && children}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", marginBottom: 8 }}
    >
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
      <div style={{
        width: 36, height: 20, borderRadius: 10, transition: "background 0.2s",
        background: value ? "var(--lilac-deep)" : "var(--border)", position: "relative",
      }}>
        <div style={{
          position: "absolute", top: 3, left: value ? 19 : 3, width: 14, height: 14,
          borderRadius: "50%", background: "var(--text)", transition: "left 0.2s",
        }} />
      </div>
    </div>
  );
}

/* ─── Creator card ─── */
function CreatorCard({ creator, showMatch, savedIds, onSave, addSlot }: { creator: Creator; showMatch: boolean; savedIds: Set<string>; onSave: (id: string) => void; addSlot?: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const isSaved = savedIds.has(creator.id);
  const pm = PLATFORM_META[creator.primaryPlatform];

  return (
    <article className="relative flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-pill text-small font-medium text-ink", avatarTone(creator.id))}>
            {monogramInitials(creator.displayName)}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-small font-medium text-text">{creator.displayName}</span>
              {creator.isVerified && (
                <BadgeCheck aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-success" />
              )}
            </span>
            <span className="type-data truncate text-text-muted">@{creator.username}</span>
          </span>
        </div>
        <button
          onClick={e => { e.preventDefault(); onSave(creator.id); }}
          aria-pressed={isSaved}
          aria-label={isSaved ? "Saved" : "Save creator"}
          className="shrink-0 rounded-control p-1 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Star aria-hidden strokeWidth={1.75} className={cn("size-4", isSaved ? "fill-butter-deep text-butter-deep" : "text-text-muted")} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Icon AND word: the icon alone names nothing to a screen reader, and
            a platform mark is not universally legible at this size either. */}
        <Badge variant="lilac" className="gap-1.5">
          <pm.Icon aria-hidden strokeWidth={1.75} />
          {pm.label}
        </Badge>
        <Badge variant="outline">@{creator.username}</Badge>
        {creator.niche.slice(0, 2).map(n => <Badge key={n} variant="outline">{n}</Badge>)}
      </div>

      {/* Who you actually reach. Real demographics, not a colour banner. */}
      <div className="flex flex-col gap-1.5">
        <span className="type-label text-text-muted">Audience age</span>
        <TunerStrip segments={audienceSegments(creator)} label={`${creator.displayName} audience age split`} />
      </div>

      <dl className="grid grid-cols-3 gap-2 border-y border-border py-3 text-center">
        <div className="flex flex-col gap-0.5">
          <dd className="type-data text-text">{creator.followers >= 1000 ? `${(creator.followers / 1000).toFixed(0)}K` : creator.followers}</dd>
          <dt className="type-label text-text-muted">followers</dt>
        </div>
        <div className="flex flex-col gap-0.5">
          <dd className={cn("type-data", creator.engagementRate >= 7 ? "text-success" : "text-text")}>{creator.engagementRate}%</dd>
          <dt className="type-label text-text-muted">engagement</dt>
        </div>
        <div className="flex flex-col gap-0.5">
          <dd className="text-small text-text">{creator.city}</dd>
          <dt className="type-label text-text-muted">city</dt>
        </div>
      </dl>

      {showMatch && (
        <div className="flex flex-col gap-2 rounded-control bg-bone p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="type-label text-text-muted">AI Match</span>
            <span className="type-data text-success">{creator.aiMatchScore}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-pill bg-hairline">
            <div className="h-full rounded-pill bg-success" style={{ width: `${creator.aiMatchScore}%` }} />
          </div>
          <p className="text-small text-text-muted">{creator.aiMatchRationale}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="type-data text-text">From PKR {creator.pricePost.toLocaleString()}/post</span>
        {creator.priceStory && (
          <span className="text-small text-text-muted">· PKR {creator.priceStory.toLocaleString()} story</span>
        )}
      </div>

      {!creator.isAvailableNow && <Badge variant="butter" className="w-fit">Currently booked</Badge>}

      {addSlot}

      <Button asChild variant="outline" className="mt-auto w-full">
        <Link href={`/influencers/${creator.username}`}>
          View Profile
          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </article>
  );
}

/** The short card, for a creator we can call but have not written up. */
function BasicCreatorCard({ row, addSlot }: { row: Row; addSlot?: React.ReactNode }) {
  const pm = row.platforms[0] ? PLATFORM_META[row.platforms[0]] : null;
  return (
    <article className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-pill text-small font-medium text-ink", avatarTone(row.externalId))}>
          {monogramInitials(row.name)}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-small font-medium text-text">{row.name}</span>
          <span className="type-data truncate text-text-muted">@{row.handle}</span>
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {pm && (
          <Badge variant="lilac" className="gap-1.5">
            <pm.Icon aria-hidden strokeWidth={1.75} />
            {pm.label}
          </Badge>
        )}
        <Badge variant="outline">@{row.handle}</Badge>
        {row.category && <Badge variant="outline">{row.category}</Badge>}
        {!row.hasPhone && <Badge variant="outline">NO PHONE</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-2 border-y border-border py-3 text-center">
        <div className="flex flex-col gap-0.5">
          <dd className="type-data text-text">
            {row.followers == null
              ? <span className="text-small text-text-muted">Not on file</span>
              : row.followers >= 1000 ? `${(row.followers / 1000).toFixed(0)}K` : row.followers}
          </dd>
          <dt className="type-label text-text-muted">{row.audienceBasis ?? "followers"}</dt>
        </div>
        <div className="flex flex-col gap-0.5">
          <dd className="text-small text-text">{row.city ?? <span className="text-text-muted">Not on file</span>}</dd>
          <dt className="type-label text-text-muted">city</dt>
        </div>
      </dl>

      {/* Engagement, rating, reviews and audience split are absent rather than
          guessed. This creator is a real person; a made-up rating on their
          card is a made-up claim about them. */}
      <p className="text-small text-text-muted">
        Engagement, audience split, rating and reviews not on file yet.
      </p>

      <span className="type-data text-text">
        {row.pricePost == null
          ? <span className="text-small text-text-muted">Rate not on file — verify by call</span>
          : <>From PKR {row.pricePost.toLocaleString()}<span className="text-small text-text-muted">/post est.</span></>}
      </span>

      {addSlot}

      <Button asChild variant="outline" className="mt-auto w-full">
        <Link href={`/influencers/${row.handle}`}>
          View Profile
          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </article>
  );
}

/** Everything the filter sidebar can be set to. */
export interface CreatorFilters {
  search: string;
  platforms: Platform[];
  niches: string[];
  cities: string[];
  followerRange: string;
  engRange: string;
  priceRange: string;
  onlyVerified: boolean;
  onlyAvailable: boolean;
  femaleOnly: boolean;
  maleOnly: boolean;
  languages: string[];
  sort: string;
}

/**
 * Apply the sidebar to the catalogue.
 *
 * Pure and exported, because the rules that matter here are about ABSENCE and
 * absence is easy to get quietly wrong: a filter that treats "not on file" as
 * a qualifying value, or a sort that reads a missing rate as zero and puts an
 * unpriced creator at the top of "cheapest first".
 */
export function filterCreators(rows: Row[], f: CreatorFilters): Row[] {
  let list = [...rows];
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.handle.toLowerCase().includes(q) ||
      c.niche.some(n => n.toLowerCase().includes(q)) ||
      (c.city ?? "").toLowerCase().includes(q)
    );
  }
  if (f.platforms.length > 0) list = list.filter(c => c.platforms.some(p => f.platforms.includes(p)));
  if (f.niches.length > 0) list = list.filter(c => c.niche.some(n => f.niches.includes(n)));
  if (f.cities.length > 0) list = list.filter(c => (c.city ? f.cities.includes(c.city) : false));

  /* Every filter below asks about something only the write-up holds. A row
     with nothing on file is EXCLUDED rather than assumed to qualify - "show me
     creators above 9% engagement" must not return one whose engagement nobody
     has measured. */
  if (f.onlyVerified) list = list.filter(c => c.isVerified);
  if (f.onlyAvailable) list = list.filter(c => c.isAvailableNow);
  if (f.languages.length > 0) list = list.filter(c => c.languages.some(l => f.languages.includes(l)));

  const fr = FOLLOWER_RANGES.find(r => r.key === f.followerRange);
  if (fr && f.followerRange !== "any") {
    list = list.filter(c => c.followers != null && c.followers >= fr.min && c.followers < fr.max);
  }

  const er = ENG_RANGES.find(r => r.key === f.engRange);
  if (er && f.engRange !== "any") {
    list = list.filter(c => c.engagementRate != null && c.engagementRate >= er.min && c.engagementRate < er.max);
  }

  if (f.priceRange === "budget") list = list.filter(c => c.pricePost != null && c.pricePost < 10000);
  else if (f.priceRange === "mid") list = list.filter(c => c.pricePost != null && c.pricePost >= 10000 && c.pricePost < 25000);
  else if (f.priceRange === "premium") list = list.filter(c => c.pricePost != null && c.pricePost >= 25000);

  if (f.femaleOnly) list = list.filter(c => c.audienceFemale != null && c.audienceFemale >= 60);
  if (f.maleOnly) list = list.filter(c => c.audienceFemale != null && c.audienceFemale < 40);

  /* Unknown sorts last, never first. A creator with no rate on file is not the
     cheapest; one with no engagement figure is not the least engaging. */
  const lowFirst = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
  const highFirst = (v: number | null) => (v == null ? Number.NEGATIVE_INFINITY : v);
  if (f.sort === "engagement") list.sort((a, b) => highFirst(b.engagementRate) - highFirst(a.engagementRate));
  else if (f.sort === "followers") list.sort((a, b) => highFirst(b.followers) - highFirst(a.followers));
  else if (f.sort === "price-low") list.sort((a, b) => lowFirst(a.pricePost) - lowFirst(b.pricePost));
  else if (f.sort === "price-high") list.sort((a, b) => highFirst(b.pricePost) - highFirst(a.pricePost));
  else list.sort((a, b) => highFirst(b.aiMatchScore) - highFirst(a.aiMatchScore));

  return list;
}

/* ─── Main component ─── */
export default function InfluencerMarket({
  items,
  campaigns,
}: {
  items: DirectoryCreator[];
  campaigns: BrandCampaign[];
}) {
  const { state: addState, add } = useAddToCampaign();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [niches, setNiches] = useState<string[]>([]);
  const [showAllNiches, setShowAllNiches] = useState(false);
  const [followerRange, setFollowerRange] = useState("any");
  const [cities, setCities] = useState<string[]>([]);
  const [engRange, setEngRange] = useState("any");
  const [priceRange, setPriceRange] = useState("any");
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [femaleOnly, setFemaleOnly] = useState(false);
  const [maleOnly, setMaleOnly] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [sort, setSort] = useState("match");
  const [activeCampaign, setActiveCampaign] = useState("");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  function togglePlatform(p: Platform) {
    setPlatforms(v => v.includes(p) ? v.filter(x => x !== p) : [...v, p]);
  }
  function toggleNiche(n: string) {
    setNiches(v => v.includes(n) ? v.filter(x => x !== n) : [...v, n]);
  }
  function toggleCity(c: string) {
    setCities(v => v.includes(c) ? v.filter(x => x !== c) : [...v, c]);
  }
  function toggleLang(l: string) {
    setLanguages(v => v.includes(l) ? v.filter(x => x !== l) : [...v, l]);
  }
  function toggleSave(id: string) {
    setSavedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function resetAll() {
    setPlatforms([]); setNiches([]); setFollowerRange("any"); setCities([]);
    setEngRange("any"); setPriceRange("any"); setOnlyVerified(false);
    setOnlyAvailable(false); setFemaleOnly(false);
    setMaleOnly(false); setLanguages([]); setSearch("");
  }

  const rows = useMemo(() => items.map(toRow), [items]);

  /* The filter lists come from the catalogue rather than a hardcoded pair of
     arrays that only covered the eight written-up creators. A city nobody is
     in is not offered as a filter. */
  const allCities = useMemo(
    () => [...new Set(rows.map(r => r.city).filter((c): c is string => !!c))].sort(),
    [rows]
  );
  const allNiches = useMemo(
    () => [...new Set(rows.flatMap(r => r.niche))].sort(),
    [rows]
  );

  const filtered = useMemo(
    () => filterCreators(rows, {
      search, platforms, niches, cities, followerRange, engRange, priceRange,
      onlyVerified, onlyAvailable, femaleOnly, maleOnly, languages, sort,
    }),
    [rows, search, platforms, niches, cities, followerRange, engRange, priceRange,
      onlyVerified, onlyAvailable, femaleOnly, maleOnly, languages, sort]);

  const visibleNiches = showAllNiches ? allNiches : allNiches.slice(0, 8);
  const chipOn: React.CSSProperties = { background: "var(--success)", border: "1.5px solid var(--success)", color: "var(--text)", borderRadius: 20, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 };
  const chipOff: React.CSSProperties = { background: "transparent", border: "1.5px solid var(--border)", color: "var(--text-muted)", borderRadius: 20, padding: "5px 12px", fontSize: 12, cursor: "pointer" };

  return (
    <div>
      {/* Hero */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1340, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ color: "var(--text)", fontSize: 26, fontWeight: 800, margin: "0 0 4px", letterSpacing: -0.5 }}>Find Your Perfect Creators</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
              <strong style={{ color: "var(--text-muted)" }}>{items.length}</strong> Pakistani creators. AI-matched to your brand. Book directly.
            </p>
            {/* Said once, here, rather than on twenty-four cards. The eight
                creators that used to sit in _data.ts had real-looking handles
                and nothing recorded whether the accounts belonged to real
                people; these are written for the demo and do not. */}
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "6px 0 0" }}>
              These creator profiles are demo personas, not real accounts. Figures
              beside them are estimates until a call confirms them.
            </p>
          </div>
          <div>
            <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>Add to Campaign</label>
            <CampaignSelect
              campaigns={campaigns}
              value={activeCampaign}
              onChange={setActiveCampaign}
              newHref="/campaigns/create?from=influencers"
            />
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1340, margin: "0 auto", padding: "24px 28px", display: "flex", gap: 24, alignItems: "flex-start" }}>
        {/* ── Filter sidebar ── */}
        <div style={{ width: 280, flexShrink: 0, position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px" }}>
            {/* Search */}
            <div style={{ position: "relative", marginBottom: 20 }}>
              <svg aria-hidden style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search creators…"
                style={{ width: "100%", background: "var(--bg)", border: "1.5px solid var(--border)", borderRadius: 8, padding: "8px 10px 8px 30px", color: "var(--text)", fontSize: 13, outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <SidebarSection title="Platform">
              {(Object.entries(PLATFORM_META) as [Platform, typeof PLATFORM_META.instagram][]).map(([key, meta]) => {
                const count = rows.filter(c => c.platforms.includes(key)).length;
                return (
                  <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                    <input type="checkbox" checked={platforms.includes(key)} onChange={() => togglePlatform(key)}
                      style={{ accentColor: "var(--ink)", width: 14, height: 14 }} />
                    <meta.Icon aria-hidden strokeWidth={1.75} width={14} height={14} style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text)", fontSize: 13, flex: 1 }}>{meta.label}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({count})</span>
                  </label>
                );
              })}
            </SidebarSection>

            <SidebarSection title="Niche">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {visibleNiches.map(n => (
                  <button key={n} onClick={() => toggleNiche(n)} style={niches.includes(n) ? chipOn : chipOff}>{n}</button>
                ))}
              </div>
              <button onClick={() => setShowAllNiches(v => !v)}
                style={{ background: "none", border: "none", color: "var(--lilac-deep)", fontSize: 12, cursor: "pointer", marginTop: 6, padding: 0 }}>
                {showAllNiches ? "Show less ↑" : `Show all ${allNiches.length} niches ↓`}
              </button>
            </SidebarSection>

            <SidebarSection title="Follower Range">
              {FOLLOWER_RANGES.map(r => (
                <label key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, cursor: "pointer" }}>
                  <input type="radio" name="follower" checked={followerRange === r.key} onChange={() => setFollowerRange(r.key)}
                    style={{ accentColor: "var(--lilac-deep)" }} />
                  <span style={{ color: "var(--text)", fontSize: 13, flex: 1 }}>{r.label}</span>
                  {r.sub && <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{r.sub}</span>}
                </label>
              ))}
            </SidebarSection>

            <SidebarSection title="Location">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {allCities.map(c => (
                  <button key={c} onClick={() => toggleCity(c)} style={cities.includes(c) ? chipOn : chipOff}>{c}</button>
                ))}
              </div>
            </SidebarSection>

            <SidebarSection title="Engagement Rate">
              {ENG_RANGES.map(r => (
                <label key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input type="radio" name="eng" checked={engRange === r.key} onChange={() => setEngRange(r.key)}
                    style={{ accentColor: "var(--lilac-deep)" }} />
                  <span style={{ color: r.key === "great" ? "var(--success)" : "var(--text)", fontSize: 13 }}>
                    {r.label}
                  </span>
                </label>
              ))}
            </SidebarSection>

            <SidebarSection title="Price Per Post">
              {PRICE_RANGES.map(r => (
                <label key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: "pointer" }}>
                  <input type="radio" name="price" checked={priceRange === r.key} onChange={() => setPriceRange(r.key)}
                    style={{ accentColor: "var(--lilac-deep)" }} />
                  <span style={{ color: "var(--text)", fontSize: 13 }}>{r.label}</span>
                </label>
              ))}
            </SidebarSection>

            <SidebarSection title="Creator Preferences">
              <Toggle value={onlyVerified} onChange={setOnlyVerified} label="Arc Verified Only" />
              <Toggle value={onlyAvailable} onChange={setOnlyAvailable} label="Available Now" />
              <Toggle value={femaleOnly} onChange={v => { setFemaleOnly(v); if (v) setMaleOnly(false); }} label="Female-skewed Audience" />
              <Toggle value={maleOnly} onChange={v => { setMaleOnly(v); if (v) setFemaleOnly(false); }} label="Male-skewed Audience" />
            </SidebarSection>

            <SidebarSection title="Content Language">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {["Urdu", "English", "Bilingual", "Punjabi", "Arabic"].map(l => (
                  <button key={l} onClick={() => toggleLang(l)} style={languages.includes(l) ? chipOn : chipOff}>{l}</button>
                ))}
              </div>
            </SidebarSection>

            <button
              onClick={resetAll}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", width: "100%", textAlign: "center", textDecoration: "underline", marginTop: 4 }}
            >Reset All</button>
          </div>
        </div>

        {/* ── Results area ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Sort bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
              <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> creators found
            </span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Sort:</span>
              {SORT_OPTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  style={{
                    background: sort === s.key ? "var(--lilac-deep)" : "transparent",
                    border: `1px solid ${sort === s.key ? "var(--lilac-deep)" : "var(--border)"}`,
                    borderRadius: 6, padding: "5px 10px", color: sort === s.key ? "var(--text)" : "var(--text-muted)",
                    fontSize: 12, cursor: "pointer",
                  }}
                >{s.label}</button>
              ))}
            </div>
          </div>

          {/* AI match banner */}
          {activeCampaign && (
            <div style={{
              background: "rgba(13,148,136,0.08)", border: "1px solid rgba(13,148,136,0.25)",
              borderRadius: 10, padding: "12px 16px", marginBottom: 16,
              display: "flex", alignItems: "flex-start", gap: 10,
            }}>
              <span style={{ color: "var(--success)", fontSize: 16 }}>✦</span>
              <div>
                <div style={{ color: "var(--success)", fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                  Showing AI match scores for &ldquo;{campaigns.find(c => c.id === activeCampaign)?.name}&rdquo;
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                  Creators ranked by niche fit, audience demographics, and historical campaign ROI
                </div>
              </div>
            </div>
          )}

          {/* Result count, the same shape /radio uses. The header states the
              catalogue; this states what the filters left. */}
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
            Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {items.length} creators
          </div>

          {/* Grid */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-card bg-surface p-12 text-center shadow-card">
              <Users aria-hidden strokeWidth={1.75} className="size-8 text-text-muted" />
              <h3 className="font-display text-h3 text-text">No creators match your filters</h3>
              <p className="text-body text-text-muted">Try loosening your filters or resetting them.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
              {filtered.map(row => {
                const slot = activeCampaign ? (
                  <div className="flex flex-col gap-1.5">
                    <Button
                      variant="secondary"
                      className="w-full"
                      disabled={addState[row.externalId]?.kind === "adding"}
                      onClick={() => add(row.externalId, "CREATOR", activeCampaign)}
                    >
                      <Plus aria-hidden strokeWidth={1.75} />
                      Add to campaign
                    </Button>
                    <AddResult state={addState[row.externalId]} />
                  </div>
                ) : (
                  /* No campaign chosen yet. Rather than a dead control, this carries
                     the line into the wizard, which pins it into the generated plan
                     and arrives with it already ticked. */
                  <Button asChild variant="ghost" className="w-full">
                    <Link href={`/campaigns/create?add=${row.externalId}`}>
                      <Plus aria-hidden strokeWidth={1.75} />
                      Start a campaign with this
                    </Link>
                  </Button>
                );
                return row.detail ? (
                  <CreatorCard
                    key={row.externalId}
                    creator={row.detail}
                    showMatch={!!activeCampaign}
                    savedIds={savedIds}
                    onSave={toggleSave}
                    addSlot={slot}
                  />
                ) : (
                  <BasicCreatorCard key={row.externalId} row={row} addSlot={slot} />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
