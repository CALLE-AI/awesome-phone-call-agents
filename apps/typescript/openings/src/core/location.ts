/**
 * Location parsing for framing candidates.
 *
 * NPPES frames by city and state, so a watch location must resolve to both.
 * These helpers never guess: a location without a recognizable state returns
 * null so the caller can reject the request instead of dialing the wrong
 * region.
 */

const STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

/**
 * Extract the city from a location string. Returns null when the location does
 * not clearly contain a city (e.g. a bare state code or full state name).
 */
export function parseCity(location: string): string | null {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const first = parts[0];
  if (!first) return null;
  // A single part is a city only when it is not itself a state.
  if (parts.length === 1) {
    if (/^[A-Za-z]{2}$/.test(first)) return null;
    if (STATES[first.toLowerCase()]) return null;
  }
  return first;
}

/**
 * Extract the state from a location string. Accepts "PA" or "Pennsylvania".
 * Returns null when no state is present — never guesses, because guessing
 * which region to dial places real calls in the wrong place.
 */
export function parseState(location: string): string | null {
  const parts = location.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) return null;
  if (/^[A-Za-z]{2}$/.test(last)) return last.toUpperCase();
  const full = STATES[last.toLowerCase()];
  if (full) return full;
  return null;
}
