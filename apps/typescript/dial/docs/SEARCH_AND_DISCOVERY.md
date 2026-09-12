# Search and discovery

Dial cannot call a business it has not found, and must never call a number it
guessed. This layer is where both of those are enforced.

## Provider interfaces

```ts
interface GeocodingProvider        // free text <-> coordinates
interface BusinessDiscoveryProvider // a query -> BusinessCandidate[]
interface WebSearchProvider        // contact cross-verification
interface BusinessContactVerifier  // corroborate a number, never invent one
```

`DiscoveryService` resolves which implementations to use from configuration and
merges their output. Swapping providers is a config change, not a rewrite.

| Config | Providers used |
| --- | --- |
| no keys | OpenStreetMap only |
| `GOOGLE_PLACES_API_KEY` set | Google Places **and** OpenStreetMap |
| `DISCOVERY_PROVIDER=osm` | OpenStreetMap only, regardless of keys |
| `DISCOVERY_PROVIDER=google` | Google Places only |

Both run together by default because two independent sources carrying the same
number is what lets a candidate be marked `phoneVerified`.

## OpenStreetMap (default, no key)

- **Nominatim** for geocoding and reverse geocoding.
- **Overpass** for business discovery, reading the `phone`, `contact:phone` and
  `contact:mobile` tags that OSM contributors maintain.

Its usage policy requires an identifying User-Agent with a contact address and
conservative request rates. Both are enforced in code (`OSM_CONTACT_EMAIL`, a
per-host throttle of roughly one request per second), not left to the caller.

Data is © OpenStreetMap contributors under the ODbL. Every candidate carries its
`sourceUrl`, and the UI links to it, so provenance is visible rather than buried.

**Verified live:** a query for phone repair near Dublin 2 returned 59 real
businesses, 15 of which had numbers passing E.164 validation, with real
addresses and distances.

**Limitation, stated plainly:** OSM has no ratings or review counts. Those fields
stay `null` rather than being invented, and ranking leans on distance, opening
hours and phone corroboration instead.

## Google Places (optional)

Written against the v1 REST surface (`places:searchText`). Adds ratings, review
counts, verified numbers and `openNow`. The key travels in a header, never a
query string, and only ever from the server.

## Domain mapping

`packages/search/src/categories.ts` maps a domain key to OSM tags and Google
types, with a keyword fallback so an unmapped domain still searches rather than
returning nothing:

```ts
{ domain: 'phone_repair',
  osmTags: [['shop','mobile_phone'], ['craft','electronics_repair'], ...],
  googleTypes: ['electronics_store'],
  keywords: ['phone repair', 'screen repair', ...] }
```

Fourteen domains ship. Adding one is a row in this table plus a call family.

## Phone numbers: the strict part

A number either normalises to valid E.164 or it is `null`. Dial never guesses,
never patches up a partial number, and never hands CALL-E something it has not
validated — a wrong digit dials a stranger.

- `libphonenumber-js`, with the country inferred from the geocoded location.
- Directory fields often contain several numbers (`"+353 1 234 5678; +353 87 ..."`);
  the first that validates wins.
- Right shape but not a real number (`+1 111 111 1111`) is rejected.
- Premium-rate and fictional ranges (NANP `555-01xx`, UK `09xx`) are refused
  outright — worse than no number.
- A candidate with no valid number is excluded from calling with a visible
  reason, not silently dropped.

## Deduplication and merging

Two directory entries for one shop are common. `dedupeCandidates` merges rather
than discards: the survivor keeps the richest field set, accumulates both
provenance records, and — when two *different* sources agree on the same E.164 —
is marked `phoneVerified`.

Matching is by E.164 first, then by normalised business name plus rounded
coordinates (legal suffixes and punctuation stripped, so "FixLab Ltd." and
"fixlab" collapse).

## Ranking, before any call

Every call costs money and rings a real business, so ordering happens first.

**Hard exclusions** (never called, reason shown in the UI): no verified phone,
explicitly excluded by the user, beyond the requested radius, closed right now.

**Score**: distance (tapering, not dominating), rating weighted by review count,
`+12` for a phone confirmed by two sources, `+15` for open now, `+40` for a
brand the user named.

`selectCallTargets` then caps the list by the task's own limit and the server's
`MAX_CALLS_PER_TASK`, whichever is smaller.

## Opening hours

`isOpenNow` evaluates the common subset of the OSM `opening_hours` syntax and
returns **`null` — explicitly unknown — for anything it does not fully
understand**, rather than guessing. A wrong `false` silently drops a business
that could have helped; a wrong `true` wastes a call. Unknown is the honest
answer, and the ranker treats it as neutral.

## Failure reporting

`DiscoveryService` catches per-provider failures and returns them in
`providerErrors` rather than throwing, because the pipeline needs to tell two
different stories:

- providers failed and nothing came back → *"Dial could not reach the business
  directory just now. Please try again shortly."*
- providers succeeded and nothing came back → *"Dial could not find any phone
  repair shop near Dublin 2."*

Both are tested.
