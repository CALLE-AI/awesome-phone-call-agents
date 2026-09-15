// Drug intelligence from public federal sources: NLM RxNorm (exact products, strengths, brands)
// and openFDA (current shortage records, DEA schedule). Informational only, never clinical advice.

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
const OPENFDA = "https://api.fda.gov/drug";
const TTL_MS = 60 * 60 * 1000;

interface Fetched<T> {
  status: number; // 0 = network failure
  data: T | null;
}

const cache = new Map<string, { at: number; value: Fetched<unknown> }>();

async function getJson<T>(url: string): Promise<Fetched<T>> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Fetched<T>;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    const value: Fetched<T> = { status: res.status, data: res.ok ? ((await res.json()) as T) : null };
    // openFDA answers 404 when a search has no matches, which is a real answer worth caching.
    if (res.ok || res.status === 404) cache.set(url, { at: Date.now(), value });
    return value;
  } catch {
    return { status: 0, data: null };
  }
}

interface ConceptProperties {
  rxcui: string;
  name: string;
  tty: string;
}
interface ConceptGroup {
  tty: string;
  conceptProperties?: ConceptProperties[];
}

export interface DrugProduct {
  rxcui: string;
  name: string;
  displayName: string;
  tty: "SCD" | "SBD";
  brand: string | null;
}

export interface ShortageIntel {
  active: boolean;
  records: number;
  unavailable: number;
  limited: number;
  presentations: string[];
  lastUpdated: string | null;
}

export interface DrugIntel {
  rxcui: string;
  name: string;
  displayName: string;
  ingredient: string | null;
  brands: string[];
  doseForm: string | null;
  alternatives: string[];
  shortage: ShortageIntel | null;
  deaSchedule: string | null;
}

export function prettyDrugName(name: string): string {
  const cleaned = name
    .replace(/\s*\[[^\]]+\]\s*$/, "")
    .replace(/^(?:NDA\d+|BX Rating)\s+/i, "")
    .replace(/\bMG\b/g, "mg")
    .replace(/\bMCG\b/g, "mcg")
    .replace(/(\d)ML\b/g, "$1 mL")
    .replace(/\bML\b/g, "mL")
    .replace(/\bHR\b/g, "hr")
    .replace(/\bUNT\b/g, "units")
    .replace(/\bACTUAT\b/g, "actuation");
  // RxNorm normalizes liquids to mg/mL; pharmacists and parents say "400 per 5 mL".
  const perMl = cleaned.match(/^[^/]*?(\d+(?:\.\d+)?) mg\/mL .*(Suspension|Solution|Syrup)/i);
  const withEquivalent = perMl && !cleaned.includes(" / ") ? `${cleaned} (${+(Number(perMl[1]) * 5).toFixed(2)} mg/5 mL)` : cleaned;
  return withEquivalent.charAt(0).toUpperCase() + withEquivalent.slice(1);
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)\s*(mg|mcg|ml)/g, "$1 $2")
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
}

/** Query tokens plus per-mL concentrations, so "400 mg/5 ml" also matches RxNorm's "80 MG/ML". */
function queryTokens(query: string): Set<string> {
  const wanted = new Set(tokens(query));
  for (const m of query.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*mg\s*\/\s*(\d+(?:\.\d+)?)\s*ml/g)) {
    wanted.add(String(+(Number(m[1]) / Number(m[2])).toFixed(3)));
  }
  return wanted;
}

function rankProducts(products: DrugProduct[], query: string): DrugProduct[] {
  const wanted = queryTokens(query);
  const q = query.toLowerCase();
  return products
    .map((product) => {
      const have = new Set(tokens(product.name));
      let hits = [...wanted].filter((t) => have.has(t)).length;
      // Demote combination products unless the query names the other ingredient.
      const others = product.name.toLowerCase().split(" / ").slice(1).map((part) => part.trim().split(/\s+/)[0]);
      if (others.length && !others.some((word) => q.includes(word))) hits -= 3;
      return { product, hits };
    })
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        (a.product.tty === b.product.tty ? 0 : a.product.tty === "SCD" ? -1 : 1) ||
        a.product.name.localeCompare(b.product.name),
    )
    .map((entry) => entry.product);
}

async function productsByName(name: string): Promise<DrugProduct[]> {
  const res = await getJson<{ drugGroup?: { conceptGroup?: ConceptGroup[] } }>(
    `${RXNAV}/drugs.json?name=${encodeURIComponent(name)}`,
  );
  const products: DrugProduct[] = [];
  for (const group of res.data?.drugGroup?.conceptGroup ?? []) {
    if (group.tty !== "SCD" && group.tty !== "SBD") continue;
    for (const concept of group.conceptProperties ?? []) {
      products.push({
        rxcui: concept.rxcui,
        name: concept.name,
        displayName: prettyDrugName(concept.name),
        tty: group.tty,
        brand: concept.name.match(/\[([^\]]+)\]\s*$/)?.[1] ?? null,
      });
    }
  }
  return products;
}

async function relatedGroups(rxcui: string, ttys: string): Promise<ConceptGroup[]> {
  const res = await getJson<{ relatedGroup?: { conceptGroup?: ConceptGroup[] } }>(
    `${RXNAV}/rxcui/${rxcui}/related.json?tty=${ttys}`,
  );
  return res.data?.relatedGroup?.conceptGroup ?? [];
}

export async function searchProducts(query: string): Promise<{ products: DrugProduct[]; suggestions: string[] }> {
  const q = query.trim();
  if (q.length < 2) return { products: [], suggestions: [] };
  const firstWord = q.split(/\s+/)[0];

  let products: DrugProduct[] = [];
  for (const name of new Set([q, firstWord])) {
    products = await productsByName(name);
    if (products.length) break;
  }

  if (!products.length) {
    // Recover the ingredient from RxNorm's approximate matcher, e.g. "amoxil 400 susp".
    const approx = await getJson<{ approximateGroup?: { candidate?: { rxcui: string }[] } }>(
      `${RXNAV}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=3`,
    );
    const rxcui = approx.data?.approximateGroup?.candidate?.[0]?.rxcui;
    if (rxcui) {
      const groups = await relatedGroups(rxcui, "IN");
      const ingredient = groups[0]?.conceptProperties?.[0]?.name;
      if (ingredient) products = await productsByName(ingredient);
    }
  }

  if (products.length) return { products: rankProducts(products, q).slice(0, 30), suggestions: [] };

  const spelling = await getJson<{ suggestionGroup?: { suggestionList?: { suggestion?: string[] } } }>(
    `${RXNAV}/spellingsuggestions.json?name=${encodeURIComponent(firstWord)}`,
  );
  return { products: [], suggestions: spelling.data?.suggestionGroup?.suggestionList?.suggestion?.slice(0, 5) ?? [] };
}

async function alternativePresentations(ingredientRxcui: string, currentName: string, doseForm: string | null) {
  const groups = await relatedGroups(ingredientRxcui, "SCD");
  const formWord = doseForm?.toLowerCase().split(/\s+/).pop() ?? null;
  return groups
    .flatMap((g) => g.conceptProperties ?? [])
    .map((c) => c.name)
    .filter((n) => n !== currentName && !n.includes(" / ") && (!formWord || n.toLowerCase().includes(formWord)))
    .map(prettyDrugName)
    .slice(0, 6);
}

function searchableTerm(term: string): string {
  return term.replace(/[^a-zA-Z-]/g, "");
}

async function shortageFor(term: string): Promise<ShortageIntel | null> {
  const safe = searchableTerm(term);
  if (!safe) return null;
  const res = await getJson<{
    meta?: { last_updated?: string; results?: { total?: number } };
    results?: Array<{ availability?: string; presentation?: string }>;
  }>(`${OPENFDA}/shortages.json?search=generic_name:${safe}+AND+status:%22Current%22&limit=100`);

  if (res.status === 404) {
    return { active: false, records: 0, unavailable: 0, limited: 0, presentations: [], lastUpdated: null };
  }
  if (!res.data) return null;

  const rows = res.data.results ?? [];
  const presentations = [...new Set(rows.map((r) => r.presentation).filter((p): p is string => Boolean(p)))];
  return {
    active: rows.length > 0,
    records: res.data.meta?.results?.total ?? rows.length,
    unavailable: rows.filter((r) => /unavailable/i.test(r.availability ?? "")).length,
    limited: rows.filter((r) => /limited/i.test(r.availability ?? "")).length,
    presentations: presentations.slice(0, 4),
    lastUpdated: res.data.meta?.last_updated ?? null,
  };
}

async function deaScheduleFor(term: string): Promise<string | null> {
  const safe = searchableTerm(term);
  if (!safe) return null;
  const res = await getJson<{ results?: Array<{ dea_schedule?: string }> }>(
    `${OPENFDA}/ndc.json?search=generic_name:${safe}+AND+_exists_:dea_schedule&limit=5`,
  );
  return res.data?.results?.find((r) => r.dea_schedule)?.dea_schedule ?? null;
}

export async function drugIntel(rxcui: string): Promise<DrugIntel | null> {
  if (!/^\d+$/.test(rxcui)) return null;
  const [props, groups] = await Promise.all([
    getJson<{ properties?: { name?: string } }>(`${RXNAV}/rxcui/${rxcui}/properties.json`),
    relatedGroups(rxcui, "IN+MIN+BN+DF"),
  ]);
  const name = props.data?.properties?.name;
  if (!name) return null;

  const pick = (tty: string) => groups.find((g) => g.tty === tty)?.conceptProperties ?? [];
  const single = pick("IN");
  const multi = pick("MIN");
  const ingredient = (multi[0] ?? single[0])?.name ?? null;
  const doseForm = pick("DF")[0]?.name ?? null;
  const brandFromName = name.match(/\[([^\]]+)\]\s*$/)?.[1];
  const brands = [...new Set([...(brandFromName ? [brandFromName] : []), ...pick("BN").map((b) => b.name)])];

  const alternatives =
    single.length === 1 && multi.length === 0 ? await alternativePresentations(single[0].rxcui, name, doseForm) : [];
  const term = (ingredient ?? name).split(/[\s/]+/)[0];
  const [shortage, deaSchedule] = await Promise.all([shortageFor(term), deaScheduleFor(term)]);

  return {
    rxcui,
    name,
    displayName: prettyDrugName(name),
    ingredient,
    brands,
    doseForm,
    alternatives,
    shortage,
    deaSchedule,
  };
}
