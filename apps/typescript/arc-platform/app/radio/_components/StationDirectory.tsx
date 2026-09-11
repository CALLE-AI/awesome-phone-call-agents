"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Radio as RadioIcon, Clock, Star, Plus, ArrowRight as ArrowRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { monogramInitials, monogramTone } from "@/lib/monogram";
import { ProvenanceChip } from "@/app/_components/Provenance";
import {
  CampaignSelect,
  AddResult,
  useAddToCampaign,
  type BrandCampaign,
} from "@/app/_components/CampaignPicker";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TunerStrip, type TunerSegment, type TunerTone } from "@/components/ui/tuner-strip";
import { ArrowRight } from "lucide-react";
import type { Station } from "../_data";

/**
 * One row of the directory: what the Contact table holds, plus the rich
 * `_data.ts` write-up when we happen to have one.
 *
 * The catalogue is 37 stations and only eight are written up. The directory
 * used to list those eight and call it the catalogue, which is how a Multan
 * brief could return Multan stations that the Radio Stations page said did not
 * exist. Every contact is listed now; the ones without a write-up get a
 * shorter card rather than invented dayparts and a made-up rating.
 */
export interface DirectoryStation {
  externalId: string;
  name: string;
  formerName: string | null;
  city: string | null;
  frequency: string | null;
  category: string | null;
  owner: string | null;
  audience: number | null;
  audienceBasis: string | null;
  rateEstimatePkr: number | null;
  rateProvenance: "ESTIMATE" | "SOURCED";
  audienceProvenance: "ESTIMATE" | "SOURCED";
  sourceNote: string | null;
  hasPhone: boolean;
  detail: Station | null;
}

const CITIES = ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Peshawar"];
const GENRES = [
  { key: "music", label: "Music" },
  { key: "news", label: "News" },
  { key: "entertainment", label: "Entertainment" },
  { key: "punjabi", label: "Punjabi" },
  { key: "islamic", label: "Islamic" },
  { key: "sports", label: "Sports" },
];
const REACHES = [
  { key: "all", label: "All" },
  { key: "under500", label: "Under 500K" },
  { key: "500-2m", label: "500K–2M" },
  { key: "2mplus", label: "2M+" },
];
const SORTS = [
  { key: "relevance", label: "Relevance" },
  { key: "reach", label: "Reach: High–Low" },
  { key: "price-low", label: "Price: Low–High" },
];


/**
 * Daypart availability, straight from the station's own slots. Widths are the
 * hours each daypart covers, so the strip reads as a day. Tone encodes whether
 * it is still buyable:
 *   available -> lilac    limited -> butter    full -> muted
 * Nothing here is invented; every field comes from _data.ts.
 */
const AVAILABILITY_TONE: Record<string, TunerTone> = {
  available: "lilac",
  limited: "butter",
  full: "muted",
};

function daypartSegments(station: Station): TunerSegment[] {
  return station.slots.map(slot => ({
    id: slot.id,
    label: slot.time,
    // The ⚡ in the source label is a glyph, not copy - the words are kept.
    caption: slot.label.replace(/^[^A-Za-z]+/, ""),
    weight: Math.max(1, slot.endHour - slot.startHour),
    tone: AVAILABILITY_TONE[slot.availability] ?? "lilac",
  }));
}

/**
 * Two letters on a colour derived from the catalogue id.
 *
 * We hold no station logos, and the alternative to a monogram is a grey box or
 * an invented image. The colour is stable per station so the same row reads the
 * same on the directory, its profile and a plan.
 */
function Monogram({ id, name }: { id: string; name: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-control font-display text-small font-medium text-ink",
        monogramTone(id)
      )}
    >
      {monogramInitials(name)}
    </span>
  );
}

/** The short card, for a station we can call but have not written up. */
function BasicStationCard({ item, addSlot }: { item: DirectoryStation; addSlot?: React.ReactNode }) {
  return (
    <article className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <Monogram id={item.externalId} name={item.name} />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-display text-h3 text-text">{item.name}</h3>
          <p className="type-data text-text-muted">{item.city ?? "city not on file"}</p>
          {item.formerName && (
            <p className="text-small text-text-muted">formerly {item.formerName}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* The frequency is how a radio station is recognised - more than a
            logo would be - so it is a chip rather than a line of detail. */}
        {item.frequency && <Badge variant="outline" className="normal-case">{item.frequency}</Badge>}
        {item.category && <Badge variant="lilac">{item.category}</Badge>}
        {item.owner && <Badge variant="outline">{item.owner}</Badge>}
        {!item.hasPhone && <Badge variant="outline">NO PHONE</Badge>}
      </div>

      <dl className="flex flex-col gap-2 border-y border-border py-3">
        <div className="flex items-center gap-2">
          <RadioIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-text-muted" />
          <dd className="text-small text-text">
            {item.audience == null
              ? <span className="text-text-muted">Audience not on file</span>
              : <><strong>{(item.audience / 1e6).toFixed(1)}M</strong>{" "}
                  <span className="text-text-muted">{item.audienceBasis ?? "audience"}</span></>}
          </dd>
        </div>
        {/* Dayparts, ratings and reviews are absent rather than guessed. */}
        <dd className="text-small text-text-muted">
          Dayparts and audience detail not on file yet.
        </dd>
      </dl>

      <span className="flex flex-col gap-1">
        {item.rateEstimatePkr == null ? (
          <span className="text-small text-text-muted">Rate not on file — verify by call</span>
        ) : (
          <>
            <span className="type-data text-text">
              PKR {item.rateEstimatePkr.toLocaleString()}
              <span className="text-small text-text-muted"> /spot</span>
            </span>
            {/* A figure carries its own standing. Nothing in this catalogue
                was sourced until someone supplied a citation. */}
            <ProvenanceChip
              kind={item.rateProvenance === "SOURCED" ? "sourced" : "estimate"}
              note={item.sourceNote}
              className="w-fit"
            />
          </>
        )}
      </span>

      {addSlot}

      <Button asChild variant="outline" className="w-full">
        <Link href={`/radio/${item.externalId}`}>
          View &amp; Book
          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </article>
  );
}

function StationCard({ station, activeCampaign, addSlot }: { station: Station; activeCampaign: boolean; addSlot?: React.ReactNode }) {
  const openSlots = station.slots.filter(s => s.availability !== "full").length;

  return (
    <article className="flex flex-col gap-4 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Monogram id={station.id} name={station.name} />
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-display text-h3 text-text">{station.name}</h3>
            <p className="type-data text-text-muted">{station.city}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Frequency first: it is the station's most recognisable label. */}
        <Badge variant="outline" className="normal-case">{station.frequency}</Badge>
        <Badge variant="lilac">{station.genre}</Badge>
        {station.language.map(l => <Badge key={l} variant="outline">{l}</Badge>)}
      </div>

      {/* What is still buyable, at a glance. */}
      <div className="flex flex-col gap-1.5">
        <span className="type-label text-text-muted">Daypart availability</span>
        <TunerStrip segments={daypartSegments(station)} label={`${station.name} daypart availability`} />
      </div>

      <dl className="flex flex-col gap-2 border-y border-border py-3">
        <div className="flex items-center gap-2">
          <RadioIcon aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-text-muted" />
          <dd className="text-small text-text">
            <strong>{(station.dailyListeners / 1e6).toFixed(1)}M</strong>{" "}
            <span className="text-text-muted">daily listeners</span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <Clock aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-text-muted" />
          <dd className="text-small text-text-muted">Peak: {station.peakTimes.join(" · ")}</dd>
        </div>
        <dd className="text-small text-text-muted">
          Best for: {station.bestFor.slice(0, 3).join(", ")}
        </dd>
      </dl>

      <div className="flex items-center justify-between gap-3">
        <span className="type-data text-text">
          PKR {station.priceMin.toLocaleString()} – {station.priceMax.toLocaleString()}
          <span className="text-small text-text-muted"> /spot</span>
        </span>
        <span className="type-data text-text-muted">{openSlots} of {station.slots.length} dayparts open</span>
      </div>

      {addSlot}

      <Button asChild variant="outline" className="w-full">
        <Link href={`/radio/${station.id}`}>
          View &amp; Book
          <ArrowRightIcon aria-hidden strokeWidth={1.75} />
        </Link>
      </Button>
    </article>
  );
}

export default function StationDirectory({
  items,
  campaigns,
}: {
  items: DirectoryStation[];
  campaigns: BrandCampaign[];
}) {
  const { state: addState, add } = useAddToCampaign();
  const [search, setSearch] = useState("");
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedGenre, setSelectedGenre] = useState("");
  const [selectedReach, setSelectedReach] = useState("all");
  const [sort, setSort] = useState("relevance");
  const [activeCampaign, setActiveCampaign] = useState("");

  const filtered = useMemo(() => {
    let list = [...items];

    if (search) {
      const q = search.toLowerCase();
      /* formerName is searchable on purpose: MERA FM 107.4 is still called
         Samaa FM by half the market, and a search for the old name must find
         the station rather than nothing. */
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.formerName ?? "").toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q) ||
        (s.category ?? "").toLowerCase().includes(q) ||
        (s.owner ?? "").toLowerCase().includes(q) ||
        (s.detail?.allCities ?? []).some(c => c.toLowerCase().includes(q))
      );
    }
    if (selectedCities.length > 0) {
      list = list.filter(s =>
        (s.city ? selectedCities.includes(s.city) : false) ||
        (s.detail?.allCities ?? []).some(c => selectedCities.includes(c))
      );
    }
    if (selectedGenre) {
      list = list.filter(s => (s.detail?.genreKeys ?? []).includes(selectedGenre));
    }
    if (selectedReach !== "all") {
      /* A station with no audience figure is excluded by a reach filter
         rather than assumed small. */
      list = list.filter(s => {
        const a = s.audience;
        if (a == null) return false;
        if (selectedReach === "under500") return a < 500000;
        if (selectedReach === "500-2m") return a >= 500000 && a < 2000000;
        if (selectedReach === "2mplus") return a >= 2000000;
        return true;
      });
    }

    /* Unknown sorts last rather than first. A station with no figure on file
       is not the smallest or the cheapest, it is simply unmeasured, and
       sorting it to the top of "lowest price" would be a lie of omission. */
    const nullsLast = (v: number | null) => (v == null ? Number.POSITIVE_INFINITY : v);
    if (sort === "reach") list.sort((a, b) => (b.audience ?? -1) - (a.audience ?? -1));
    else if (sort === "price-low") list.sort((a, b) => nullsLast(a.rateEstimatePkr) - nullsLast(b.rateEstimatePkr));

    return list;
  }, [items, search, selectedCities, selectedGenre, selectedReach, sort]);

  const activeFilters: { label: string; clear: () => void }[] = [
    ...selectedCities.map(c => ({ label: c, clear: () => setSelectedCities(v => v.filter(x => x !== c)) })),
    ...(selectedGenre ? [{ label: GENRES.find(g => g.key === selectedGenre)?.label ?? selectedGenre, clear: () => setSelectedGenre("") }] : []),
    ...(selectedReach !== "all" ? [{ label: REACHES.find(r => r.key === selectedReach)?.label ?? selectedReach, clear: () => setSelectedReach("all") }] : []),
  ];

  function toggleCity(city: string) {
    setSelectedCities(v => v.includes(city) ? v.filter(c => c !== city) : [...v, city]);
  }

  const chipStyle = (active: boolean, color?: string): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
    border: `1.5px solid ${active ? (color ?? "var(--lilac-deep)") : "var(--border)"}`,
    background: active ? (color ?? "#4F46E5") + "22" : "transparent",
    color: active ? (color ?? "var(--text-muted)") : "var(--text-muted)",
    fontWeight: active ? 600 : 400, transition: "all 0.15s", whiteSpace: "nowrap" as const,
  });

  return (
    <div>
      {/* Hero bar */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "24px 28px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ color: "var(--text)", fontSize: 26, fontWeight: 800, margin: "0 0 4px", letterSpacing: -0.5 }}>Book Radio Advertising</h1>
            <p style={{ color: "var(--text-muted)", fontSize: 14, margin: 0 }}>
              <strong style={{ color: "var(--text-muted)" }}>{items.length} FM stations</strong> across Pakistan. Arc calls them to confirm availability and rates.
            </p>
          </div>
          <div>
            <label style={{ display: "block", color: "var(--text-muted)", fontSize: 11, fontWeight: 600, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>Add to Campaign</label>
            <CampaignSelect
              campaigns={campaigns}
              value={activeCampaign}
              onChange={setActiveCampaign}
              newHref="/campaigns/create?from=radio"
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)", padding: "14px 28px", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: 12 }}>
            <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search stations, cities, shows..."
              style={{
                width: "100%", background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 8,
                padding: "10px 14px 10px 36px", color: "var(--text)", fontSize: 14, outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Filter chips */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, alignItems: "center" }}>
            {/* Cities */}
            <button onClick={() => setSelectedCities([])} style={chipStyle(selectedCities.length === 0)}>All Cities</button>
            {CITIES.map(city => (
              <button key={city} onClick={() => toggleCity(city)} style={chipStyle(selectedCities.includes(city))}>{city}</button>
            ))}

            <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />

            {/* Genre */}
            <button onClick={() => setSelectedGenre("")} style={chipStyle(selectedGenre === "")}>All Genres</button>
            {GENRES.map(g => (
              <button key={g.key} onClick={() => setSelectedGenre(selectedGenre === g.key ? "" : g.key)} style={chipStyle(selectedGenre === g.key)}>{g.label}</button>
            ))}

            <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />

            {/* Reach */}
            {REACHES.map(r => (
              <button key={r.key} onClick={() => setSelectedReach(r.key)} style={chipStyle(selectedReach === r.key)}>{r.label}</button>
            ))}

            <div style={{ width: 1, height: 20, background: "var(--border)", flexShrink: 0 }} />

            {/* Sort */}
            <select
              value={sort}
              onChange={e => setSort(e.target.value)}
              style={{
                background: "var(--surface)", border: "1.5px solid var(--border)", borderRadius: 20,
                color: "var(--text-muted)", padding: "6px 14px", fontSize: 13, cursor: "pointer",
                outline: "none", whiteSpace: "nowrap",
              }}
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Active filter chips + result count */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "14px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Showing <strong style={{ color: "var(--text)" }}>{filtered.length}</strong> of {items.length} stations
          </span>
          {activeFilters.map(f => (
            <button
              key={f.label}
              onClick={f.clear}
              style={{
                background: "rgba(79,70,229,0.15)", border: "1px solid var(--lilac-deep)", borderRadius: 20,
                color: "var(--text-muted)", fontSize: 12, padding: "3px 10px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              {f.label} <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>
            </button>
          ))}
          {activeFilters.length > 1 && (
            <button
              onClick={() => { setSelectedCities([]); setSelectedGenre(""); setSelectedReach("all"); }}
              style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}
            >Clear all</button>
          )}
        </div>
      </div>

      {/* Station grid */}
      <div>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-card bg-surface p-12 text-center shadow-card">
            <RadioIcon aria-hidden strokeWidth={1.75} className="size-8 text-text-muted" />
            <h3 className="font-display text-h3 text-text">No stations match your filters</h3>
            <p className="text-body text-text-muted">Try adjusting your city, genre, or reach filters.</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {filtered.map(item => {
              /* The add control only exists once a campaign is chosen. An
                 "Add to campaign" button with no campaign to add to is the
                 same empty gesture the fake dropdown was. */
              const slot = activeCampaign ? (
                <div className="flex flex-col gap-1.5">
                  <Button
                    variant="secondary"
                    className="w-full"
                    disabled={addState[item.externalId]?.kind === "adding"}
                    onClick={() => add(item.externalId, "STATION", activeCampaign)}
                  >
                    <Plus aria-hidden strokeWidth={1.75} />
                    Add to campaign
                  </Button>
                  <AddResult state={addState[item.externalId]} />
                </div>
              ) : (
                /* No campaign chosen yet. Rather than a dead control, this carries
                   the line into the wizard, which pins it into the generated plan
                   and arrives with it already ticked. */
                <Button asChild variant="ghost" className="w-full">
                  <Link href={`/campaigns/create?add=${item.externalId}`}>
                    <Plus aria-hidden strokeWidth={1.75} />
                    Start a campaign with this
                  </Link>
                </Button>
              );
              return item.detail
                ? <StationCard key={item.externalId} station={item.detail} activeCampaign={!!activeCampaign} addSlot={slot} />
                : <BasicStationCard key={item.externalId} item={item} addSlot={slot} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
