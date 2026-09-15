/**
 * The inventory Arc can actually sell, and the facts about it.
 *
 * The generator used to be handed a JSON template containing five worked-out
 * example stations - `fm_107_isl`, `power99_lhr` and friends - with invented
 * listener counts beside them. It copied the shape and kept inventing, so
 * plans arrived naming stations that do not exist. The fix was to hand it the
 * catalogue and join every fact ourselves after it answers.
 *
 * That catalogue is now the **Contact table**, not app/radio/_data.ts. The two
 * files still exist and still own the rich profile data - slots, shows,
 * reviews, demographics - which the browsing pages render and a call has no
 * use for. What they stopped being is the list of who exists: a campaign in
 * Multan could not be sold a Multan station while the menu held eight
 * hardcoded rows.
 *
 * The split, then:
 *   Contact table   who exists, who is callable, and the few facts a plan
 *                   needs - city, channel, audience, rate estimate
 *   _data.ts        everything a profile page shows about the ones we happen
 *                   to have written up, keyed by the same catalogue id
 *
 * A rate estimate is NULLABLE here and stays null all the way to the screen.
 * Most of the catalogue has no rate on file, and inventing one - or rendering
 * it as zero - would undo the entire argument for phoning them.
 */
import { db } from "@/lib/db";

/** Everything about a station a plan needs, from the record rather than the model. */
export interface StationFacts {
  stationId: string;
  stationName: string;
  city: string | null;
  frequency: string | null;
  audienceProfile: string | null;
  /** Null when we hold no figure. Not zero - see the note on rates. */
  estimatedDailyListeners: number | null;
  /** Null when no rate is on file, which is most of the catalogue. */
  estimatedCostPKR: number | null;
}

export interface CreatorFacts {
  id: string;
  username: string;
  displayName: string;
  platform: string;
  niche: string | null;
  city: string | null;
  estimatedFollowers: number | null;
  audienceBasis: string | null;
  estimatedCostPKR: number | null;
}

/**
 * Everything the generator may choose from, loaded once per request.
 *
 * Kept as data rather than fetched deep inside the join, so the join stays a
 * pure function that a test can drive without a database - which is what lets
 * the id-rejection rules be tested at all.
 */
export interface Catalogue {
  stations: StationFacts[];
  creators: CreatorFacts[];
}

interface ContactRow {
  externalId: string;
  name: string;
  type: "STATION" | "CREATOR";
  channel: string | null;
  city: string | null;
  frequency: string | null;
  owner: string | null;
  handle: string | null;
  category: string | null;
  audience: number | null;
  audienceBasis: string | null;
  rateEstimatePkr: number | null;
  phone: string | null;
}

const SELECT = {
  externalId: true, name: true, type: true, channel: true, city: true,
  frequency: true, owner: true, handle: true, category: true,
  audience: true, audienceBasis: true, rateEstimatePkr: true, phone: true,
} as const;

function toStation(c: ContactRow): StationFacts {
  return {
    stationId: c.externalId,
    stationName: c.name,
    city: c.city,
    frequency: c.frequency,
    /* Composed from what the record holds. Null rather than a cheerful
       sentence when it holds nothing. */
    audienceProfile: [c.category, c.owner].filter(Boolean).join(" · ") || null,
    estimatedDailyListeners: c.audience,
    estimatedCostPKR: c.rateEstimatePkr,
  };
}

function toCreator(c: ContactRow): CreatorFacts {
  return {
    id: c.externalId,
    username: (c.handle ?? c.externalId).replace(/^@/, ""),
    displayName: c.name,
    platform: c.channel ?? "instagram",
    niche: c.category,
    city: c.city,
    estimatedFollowers: c.audience,
    audienceBasis: c.audienceBasis,
    estimatedCostPKR: c.rateEstimatePkr,
  };
}

/**
 * Load the sellable catalogue.
 *
 * Only contacts we can actually reach are offered. A row with no number cannot
 * be phoned, and a plan whose whole point is "we called them" should not put a
 * line on it that nobody can call. They stay in the table - they are real
 * inventory awaiting a number - they are simply not recommended yet.
 */
export async function loadCatalogue(): Promise<Catalogue> {
  const rows = (await db.contact.findMany({
    where: { phone: { not: null } },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    select: SELECT,
  })) as ContactRow[];

  return {
    stations: rows.filter((r) => r.type === "STATION").map(toStation),
    creators: rows.filter((r) => r.type === "CREATOR").map(toCreator),
  };
}

/**
 * The slice of the catalogue this brief could plausibly buy.
 *
 * Two reasons, and only the second is about tokens. A menu of 71 rows asks the
 * model to hold the whole country in mind to answer a question about Multan,
 * and a menu that mixes channels the brief excluded invites lines it cannot
 * use. Narrowing the menu narrows the decision.
 *
 * In-city rows come first and are never dropped. The list is then topped up
 * from the rest of the catalogue rather than left short, because thin coverage
 * in a city is a real situation and the plan should say so with a line from
 * elsewhere and a rationale, not with three fewer stations.
 *
 * Pure, so the rules below can be tested without a database.
 */
export function shortlist(
  cat: Catalogue,
  opts: { cities?: string[]; channels?: string[]; max?: number } = {}
): Catalogue {
  const max = opts.max ?? 12;
  const wanted = (opts.cities ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  const channels = opts.channels ?? [];

  const pick = <T extends { city: string | null }>(rows: T[]): T[] => {
    if (!wanted.length) return rows.slice(0, max);
    const here = rows.filter((r) => r.city && wanted.includes(r.city.toLowerCase()));
    const elsewhere = rows.filter((r) => !here.includes(r));
    return [...here, ...elsewhere].slice(0, max);
  };

  /* A brief that did not ask for radio is not shown stations. */
  const wantsStations = !channels.length || channels.includes("radio");
  const wantsCreators = !channels.length || channels.includes("influencer");

  let stations = wantsStations ? pick(cat.stations) : [];
  let creators = wantsCreators ? pick(cat.creators) : [];

  /* A channel set naming neither - "digital" on its own - would otherwise
     produce an empty menu and a plan with nothing in it. Show everything and
     let the rationale argue for it, rather than answering with a blank. */
  if (!stations.length && !creators.length) {
    stations = pick(cat.stations);
    creators = pick(cat.creators);
  }

  return { stations, creators };
}

const money = (n: number | null) =>
  n == null ? "rate not on file" : `about PKR ${n.toLocaleString()}`;
const audience = (n: number | null, basis: string | null) =>
  n == null ? "audience not on file" : `${n.toLocaleString()} ${basis ?? "audience"}`;

/**
 * The menu shown to the model.
 *
 * City is on every line because it is the thing the brief is matched against,
 * and a menu that hid it is why a Multan campaign came back full of Karachi.
 * "rate not on file" is stated rather than omitted: an absent field invites
 * the model to fill it in, a stated absence does not.
 */
export function stationMenu(cat: Catalogue): string {
  return cat.stations
    .map((s) =>
      `- ${s.stationId} | ${s.stationName} | ${s.city ?? "city unknown"} | ` +
      `${s.frequency ?? "frequency unknown"} | ${audience(s.estimatedDailyListeners, "daily listeners")} | ` +
      `${money(s.estimatedCostPKR)}${s.audienceProfile ? ` | ${s.audienceProfile}` : ""}`
    )
    .join("\n");
}

export function creatorMenu(cat: Catalogue): string {
  return cat.creators
    .map((c) =>
      `- ${c.id} | ${c.displayName} (@${c.username}) | ${c.platform} | ${c.city ?? "city unknown"} | ` +
      `${c.niche ?? "niche unknown"} | ${audience(c.estimatedFollowers, c.audienceBasis)} | ` +
      `${money(c.estimatedCostPKR)}`
    )
    .join("\n");
}

/**
 * A deterministic sample plan, in the MODEL's shape - ids and judgement only.
 *
 * Used when the Anthropic API is unreachable, and city-aware on purpose: the
 * demo path should show a Multan brief Multan stations for the same reason the
 * real one should. It goes through the same join and validation as a real
 * generation, so it cannot recommend inventory that does not exist.
 */
export function sampleRecommendations(cat: Catalogue, cities: string[] = []) {
  const wanted = cities.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const inCity = <T extends { city: string | null }>(rows: T[]) => {
    if (!wanted.length) return rows;
    const hits = rows.filter((r) => r.city && wanted.includes(r.city.toLowerCase()));
    /* Fall back to the whole list rather than returning nothing: a brief for a
       city we carry no inventory in should still produce a plan, and the empty
       result would look like a broken generator instead of thin coverage. */
    return hits.length ? hits : rows;
  };

  return {
    stations: inCity(cat.stations).slice(0, 4).map((s, i) => ({
      stationId: s.stationId,
      recommendedSlots: ["Morning Drive 7-9am", "Evening Drive 5-7pm"],
      audienceMatchScore: 92 - i * 6,
      rationale: `Sample plan — ${s.stationName} covers ${s.city ?? "this market"}.`,
    })),
    creators: inCity(cat.creators).slice(0, 4).map((c, i) => ({
      id: c.id,
      matchScore: 90 - i * 5,
      matchRationale: `Sample plan — ${c.displayName} reaches ${c.niche ?? "this audience"} in ${c.city ?? "market"}.`,
    })),
  };
}

/**
 * Fill in every fact from the catalogue, and refuse anything not in it.
 *
 * Pure, and takes the catalogue as an argument, so the rules below can be
 * tested without a database.
 *
 * A recommendation whose id is not ours is not repaired and not dropped - it
 * fails the whole generation. Dropping it would hand back a plan quietly
 * missing three lines, which reads as complete and is not.
 */
export function joinCatalogue(
  data: Record<string, unknown>,
  cat: Catalogue
): { ok: boolean; problems: string[]; data: Record<string, unknown> } {
  const problems: string[] = [];
  const stationById = new Map(cat.stations.map((s) => [s.stationId, s]));
  const creatorById = new Map<string, CreatorFacts>();
  for (const c of cat.creators) {
    creatorById.set(c.id, c);
    creatorById.set(c.username, c);
  }

  const rawStations = Array.isArray(data.stationRecommendations) ? data.stationRecommendations : [];
  const rawCreators = Array.isArray(data.influencerMatches) ? data.influencerMatches : [];

  const stationRecommendations = rawStations.map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    const id = String(rec.stationId ?? "");
    const facts = stationById.get(id);
    if (!facts) {
      problems.push(`station id "${id || "(missing)"}" is not in the catalogue`);
      return null;
    }
    /* Facts last. Whatever the model sent for a name, a listener count or a
       RATE is overwritten by the record - including with null, which is the
       whole point: most of the catalogue has no rate on file and the model
       must not supply one. */
    return {
      recommendedSlots: Array.isArray(rec.recommendedSlots) ? rec.recommendedSlots : [],
      audienceMatchScore: Number(rec.audienceMatchScore) || 0,
      rationale: String(rec.rationale ?? ""),
      ...facts,
    };
  });

  const influencerMatches = rawCreators.map((r) => {
    const rec = (r ?? {}) as Record<string, unknown>;
    const id = String(rec.id ?? rec.username ?? "");
    const facts = creatorById.get(id);
    if (!facts) {
      problems.push(`creator id "${id || "(missing)"}" is not in the catalogue`);
      return null;
    }
    return {
      matchScore: Number(rec.matchScore) || 0,
      matchRationale: String(rec.matchRationale ?? ""),
      ...facts,
    };
  });

  if (!rawStations.length && !rawCreators.length) {
    problems.push("the plan recommended no stations and no creators");
  }

  return {
    ok: problems.length === 0,
    problems,
    data: { ...data, stationRecommendations, influencerMatches },
  };
}
