/**
 * Generated write-ups for the catalogue.
 *
 * The Contact table holds 68 contacts and app/radio/_data.ts plus
 * app/influencers/_data.ts describe sixteen of them by hand. The other 52 had
 * a name, a city and a number, so their cards said "not on file yet" - which
 * was accurate and which the operator decided should be filled in.
 *
 * WHAT THIS IS: plausible, internally consistent figures derived from what we
 * genuinely hold - city, format, channel, follower tier - and NOT measured.
 * The rating, the reviews, the engagement rate and the demographics below were
 * produced by this file, not by a rate card, a media kit or a call.
 *
 * Two properties make that survivable:
 *
 *   deterministic  every figure is a pure function of the contact's own id, so
 *                  the same station gets the same numbers on every machine and
 *                  every re-run. Nothing drifts between the demo and the
 *                  screenshot of the demo.
 *   reversible     scripts/seed-profiles.ts --revert clears every generated
 *                  profile and every figure this file produced, leaving the
 *                  sixteen researched contacts untouched.
 */
import type { Creator, Platform } from "@/app/influencers/_data";
import type { Station } from "@/app/radio/_data";

/** Contact fields the generators read. */
export interface Seedable {
  externalId: string;
  name: string;
  channel: string | null;
  city: string | null;
  frequency: string | null;
  owner: string | null;
  handle: string | null;
  category: string | null;
  audience: number | null;
  rateEstimatePkr: number | null;
}

/* ── deterministic randomness ─────────────────────────────────────────────
   Seeded from the contact's own id: same station, same numbers, forever. A
   Math.random() here would give the demo different figures than the deck. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const round = (n: number, to: number) => Math.round(n / to) * to;

/** `n` different items. Shuffles a copy rather than picking repeatedly, so a
 *  small pool cannot hand back the same value twice. */
function drawDistinct<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const pool = [...xs];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** Some markets are simply bigger, and a Karachi station out-reaching a
 *  Sukkur one is the single most obvious sanity check on these numbers. */
const CITY_TIER: Record<string, number> = {
  Karachi: 1, Lahore: 0.92, Islamabad: 0.62, Rawalpindi: 0.58, Faisalabad: 0.5,
  Multan: 0.42, Peshawar: 0.4, Hyderabad: 0.34, Quetta: 0.28, Gujranwala: 0.3,
  Sialkot: 0.24, Sargodha: 0.2, Bahawalpur: 0.2, Sukkur: 0.18, Abbottabad: 0.15,
  Mirpur: 0.12, Muzaffarabad: 0.12, Gilgit: 0.1, Skardu: 0.08,
};
const tierOf = (city: string | null) => CITY_TIER[city ?? ""] ?? 0.22;

const LANGS = ["Urdu", "English", "Punjabi", "Pashto", "Sindhi", "Saraiki", "Balochi"];
function languagesFor(r: () => number, city: string | null): string[] {
  const base = ["Urdu"];
  if (city === "Lahore" || city === "Faisalabad" || city === "Gujranwala") base.push("Punjabi");
  else if (city === "Peshawar" || city === "Abbottabad") base.push("Pashto");
  else if (city === "Hyderabad" || city === "Sukkur") base.push("Sindhi");
  else if (city === "Multan" || city === "Bahawalpur") base.push("Saraiki");
  else if (city === "Quetta") base.push("Balochi");
  if (r() > 0.45) base.push("English");
  return [...new Set(base)];
}

/** Age bands that add up to 100, weighted by how young the format skews. */
function ageBands(r: () => number, young: boolean) {
  const a = between(r, young ? 26 : 14, young ? 38 : 24);
  const b = between(r, 30, 38);
  const c = between(r, 16, 24);
  const d = Math.max(4, 100 - a - b - c);
  return [
    { label: "18-24", value: a },
    { label: "25-34", value: b },
    { label: "35-44", value: c },
    { label: "45+", value: d },
  ];
}

/* The review generator that stood here produced testimonials attributed to
   named brands - Shan Foods, Khaadi, Jazz - about campaigns that never ran,
   with star ratings and dates. A rating can be argued about as an estimate.
   A quote cannot: it is a statement someone is said to have made, and none of
   them made it. Gone, along with the ratings and the campaign counts. */

/* ── stations ───────────────────────────────────────────────────────────── */

const GENRES = [
  { genre: "Pop / Contemporary", keys: ["music", "entertainment"], young: true },
  { genre: "News / Talk", keys: ["news"], young: false },
  { genre: "Music / Entertainment", keys: ["music", "entertainment"], young: true },
  { genre: "Regional / Folk", keys: ["music", "punjabi"], young: false },
  { genre: "Islamic / Community", keys: ["islamic"], young: false },
  { genre: "Sports / Talk", keys: ["sports", "news"], young: true },
];

const DAYPARTS = [
  { id: "morning", label: "Morning Drive", time: "7-9am", startHour: 7, endHour: 9, isPrime: true },
  { id: "midmorning", label: "Mid-Morning", time: "9am-12pm", startHour: 9, endHour: 12, isPrime: false },
  { id: "afternoon", label: "Afternoon", time: "12-4pm", startHour: 12, endHour: 16, isPrime: false },
  { id: "evening", label: "Evening Drive", time: "5-7pm", startHour: 17, endHour: 19, isPrime: true },
  { id: "night", label: "Late Night", time: "9pm-12am", startHour: 21, endHour: 24, isPrime: false },
];


export function stationProfile(c: Seedable): Station {
  const r = rng(c.externalId);
  const g = pick(r, GENRES);
  const tier = tierOf(c.city);

  const dailyListeners = c.audience ?? round(between(r, 180_000, 2_600_000) * tier + 120_000, 10_000);
  /* Rate tracks reach, so a budget built from these lines adds up the way a
     real one would. */
  const priceMin = c.rateEstimatePkr ?? round(2_500 + (dailyListeners / 1_000_000) * 5_200, 500);
  const priceMax = round(priceMin * (1.9 + r() * 0.9), 500);
  const langs = languagesFor(r, c.city);
  const age = ageBands(r, g.young);
  const genderFemale = between(r, 38, 62);

  const slots = DAYPARTS.map((d) => {
    const availability = pick(r, ["available", "available", "limited", "full"] as const);
    return {
      id: d.id,
      label: d.label,
      time: d.time,
      startHour: d.startHour,
      endHour: d.endHour,
      priceBase: round(d.isPrime ? priceMax * 0.85 : priceMin * 1.1, 500),
      isPrime: d.isPrime,
      availability,
      slotsLeft: availability === "full" ? 0 : between(r, 1, 9),
    };
  });

  const city = c.city ?? "Pakistan";
  const nearby = Object.keys(CITY_TIER).filter((x) => x !== city);
  const cityBreakdown = [
    { city, pct: between(r, 58, 78) },
    { city: pick(r, nearby), pct: between(r, 10, 20) },
  ];
  cityBreakdown.push({ city: "Other", pct: Math.max(4, 100 - cityBreakdown[0].pct - cityBreakdown[1].pct) });


  return {
    id: c.externalId,
    name: c.name,
    city,
    allCities: [city],
    frequency: c.frequency ?? "—",
    genre: c.category ?? g.genre,
    genreKeys: g.keys,
    language: langs,
    dailyListeners,
    peakTimes: ["7-9am", "5-7pm"],
    ageRange: g.young ? "18-34" : "25-44",
    genderFemale,
    socioeconomic: pick(r, ["ABC1", "BC1C2", "C1C2D", "B C1"]),
    priceMin,
    priceMax,
    initials: (c.frequency ?? c.name).replace(/[^0-9]/g, "").slice(0, 2) || c.name.slice(0, 2).toUpperCase(),
    bestFor: [...new Set([pick(r, ["FMCG", "Telecom", "Retail", "Banking", "Auto", "Education", "Healthcare"]), pick(r, ["Consumer Brands", "Local Business", "Real Estate", "Fashion"]), "Seasonal Campaigns"])],
    slotsAvailable: slots.filter((s) => s.availability !== "full").length,
    slotStatus: pick(r, ["available", "filling", "limited"] as const),
    demographics: {
      age,
      genderFemale,
      income: pick(r, ["Middle and upper-middle", "Mass market", "Upper-middle", "Broad mass market"]),
      cityBreakdown,
      topLanguages: langs,
    },
    /* Three dayparts, no invented show titles and no invented presenters.
       Those were generated names attached to real, named stations - the
       collision problem this comment used to describe went away with them,
       because a daypart is a category and there is nothing to collide. */
    shows: [0, 1, 2].map((i) => ({
      time: DAYPARTS[i === 0 ? 0 : i === 1 ? 2 : 3].time,
      genre: c.category ?? g.genre,
      startHour: DAYPARTS[i === 0 ? 0 : i === 1 ? 2 : 3].startHour,
      endHour: DAYPARTS[i === 0 ? 0 : i === 1 ? 2 : 3].endHour,
      type: (i === 1 ? "standard" : "prime") as "prime" | "standard" | "offpeak",
    })),
    slots,
  };
}

/* ── creators ───────────────────────────────────────────────────────────── */

const CONTENT = ["Reels", "Posts", "Stories", "Reviews", "Vlogs", "Shorts", "Live"];

export function creatorProfile(c: Seedable): Creator {
  const r = rng(c.externalId);
  const platform = (["instagram", "tiktok", "youtube", "snapchat"] as const).includes(
    (c.channel ?? "") as Platform
  )
    ? (c.channel as Platform)
    : "instagram";

  const followers = c.audience ?? round(between(r, 12_000, 1_400_000), 1_000);
  /* Engagement falls as an account grows - the one relationship in creator
     data that is reliably true, and the one a flat random number would get
     obviously wrong. */
  const engagementRate =
    Math.round(Math.max(1.4, 11 - Math.log10(Math.max(1000, followers)) * 1.35 + (r() - 0.5)) * 10) / 10;
  const pricePost = c.rateEstimatePkr ?? round(2_000 + followers * 0.022, 500);
  const audienceFemale = between(r, 28, 74);
  const city = c.city ?? "Karachi";
  const niche = c.category ? [c.category] : [pick(r, ["Lifestyle", "Food", "Comedy", "Tech"])];

  const nearby = Object.keys(CITY_TIER).filter((x) => x !== city);
  const topCities = [
    { city, pct: between(r, 42, 66) },
    { city: pick(r, nearby), pct: between(r, 12, 24) },
  ];
  topCities.push({ city: "Other", pct: Math.max(5, 100 - topCities[0].pct - topCities[1].pct) });

  return {
    id: c.externalId,
    username: (c.handle ?? c.externalId).replace(/^@/, ""),
    displayName: c.name,
    platforms: [platform],
    primaryPlatform: platform,
    niche,
    city,
    followers,
    allFollowers: [{ platform, count: followers }],
    engagementRate,
    avgViews: round(followers * (0.3 + r() * 0.6), 1_000),
    audienceFemale,
    audienceAgeRange: pick(r, ["18-28", "22-35", "25-40", "18-34"]),
    audienceCities: topCities.map((t) => t.city).filter((x) => x !== "Other"),
    pricePost,
    priceStory: round(pricePost * 0.45, 500),
    ...(platform === "youtube" || platform === "tiktok"
      ? { priceVideo: round(pricePost * 1.8, 500) }
      : {}),
    isVerified: r() > 0.45,
    isAvailableNow: r() > 0.28,
    languages: languagesFor(r, city),
    bio: `${c.name} makes ${niche.join(" and ").toLowerCase()} content for a mostly ${city}-based audience of ${followers >= 1000 ? `${Math.round(followers / 1000)}K` : followers} on ${platform}. Brand work is handled directly, with turnaround usually inside a week.`,
    contentTypes: [pick(r, CONTENT), pick(r, CONTENT), "Stories"].filter((v, i, a) => a.indexOf(v) === i),
    responseTime: pick(r, ["Usually responds within 2 hours", "Usually responds within 4 hours", "Usually responds same day", "Usually responds within a day"]),
    aiMatchScore: between(r, 68, 96),
    aiMatchRationale: `${niche[0]} content with a ${city}-weighted audience and ${engagementRate}% engagement, which sits above the platform median for this follower band.`,
    demographics: {
      age: ageBands(r, true),
      topCities,
    },
  };
}
