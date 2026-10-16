#!/usr/bin/env python3
"""web_search.py — keyless business discovery with phone-number extraction.

Primary backend: OpenStreetMap Overpass API (free, no key, structured results).
Geocodes location names to lat/lon, then queries for businesses by OSM tag.

Usage:
    python3 web_search.py "mens salon Sandton Johannesburg" --max-results 5
    python3 web_search.py "restaurant Cape Town" --pretty
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# ── Phone extraction ────────────────────────────────────────────────────

_SA_PHONE = re.compile(r"((?:\+27|0)[\s\-]?\d{2}[\s\-]?\d{3}[\s\-]?\d{4})")
_E164_PHONE = re.compile(r"(\+\d{1,3}[\s\-]?\d{2,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})")


def _extract_phones(text: str) -> list[str]:
    seen: set[str] = set()
    results: list[str] = []
    for match in _SA_PHONE.finditer(text):
        raw = match.group(1).strip()
        cleaned = re.sub(r"[\s\-]", "", raw)
        if cleaned not in seen:
            seen.add(cleaned)
            results.append(raw)
    for match in _E164_PHONE.finditer(text):
        raw = match.group(1).strip()
        cleaned = re.sub(r"[\s\-]", "", raw)
        if cleaned not in seen:
            seen.add(cleaned)
            results.append(raw)
    return results


# ── OSM tag registry ─────────────────────────────────────────────────────

# Maps business-category keywords → (osm_key, osm_value) for Overpass queries.
_OSM_TAGS: dict[str, tuple[str, str]] = {
    "barber": ("shop", "hairdresser"),
    "salon": ("shop", "hairdresser"),
    "hair": ("shop", "hairdresser"),
    "haircut": ("shop", "hairdresser"),
    "restaurant": ("amenity", "restaurant"),
    "steakhouse": ("amenity", "restaurant"),
    "steak": ("amenity", "restaurant"),
    "dinner": ("amenity", "restaurant"),
    "dentist": ("amenity", "dentist"),
    "clinic": ("amenity", "clinic"),
    "doctor": ("amenity", "doctors"),
    "hotel": ("tourism", "hotel"),
    "garage": ("shop", "car_repair"),
    "car": ("shop", "car_repair"),
    "vet": ("amenity", "veterinary"),
    "pharmacy": ("amenity", "pharmacy"),
    "cafe": ("amenity", "cafe"),
    "gym": ("leisure", "fitness_centre"),
    "spa": ("leisure", "beauty"),
}

# ── Google tag mapping (keyword → Google Places type) ──────────────────

_GOOGLE_TYPES: dict[str, str] = {
    "barber": "beauty_salon",
    "salon": "beauty_salon",
    "hair": "beauty_salon",
    "haircut": "beauty_salon",
    "restaurant": "restaurant",
    "steakhouse": "restaurant",
    "steak": "restaurant",
    "dentist": "dentist",
    "clinic": "doctor",
    "doctor": "doctor",
    "hotel": "lodging",
    "garage": "car_repair",
    "car": "car_repair",
    "vet": "veterinary_care",
    "pharmacy": "pharmacy",
    "cafe": "cafe",
    "gym": "gym",
    "spa": "spa",
}


def _resolve_google_type(query: str) -> str:
    """Determine Google Places type from query keywords."""
    ql = query.lower()
    for kw, gtype in sorted(_GOOGLE_TYPES.items(), key=lambda x: len(x[0]), reverse=True):
        if kw in ql:
            return gtype
    return "restaurant"


def _load_dotenv() -> None:
    """Load HERMES_HOME/.env into os.environ (idempotent, no clobber)."""
    env_path = os.path.join(
        os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes")), ".env"
    )
    if not os.path.isfile(env_path):
        return
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


def _get_google_api_key() -> str | None:
    """Check for a Google API key in environment or .env file."""
    # Ensure .env is loaded (first caller on import will trigger this)
    _load_dotenv()
    for var in ("GOOGLE_PLACES_API_KEY", "GOOGLE_API_KEY"):
        key = os.environ.get(var)
        if key:
            return key
    return None

def _overpass_query(query: str, timeout: int = 25) -> dict[str, Any] | None:
    """Send a query to Overpass API, return parsed JSON or None on failure."""
    query = "\n".join(line.strip() for line in query.strip().splitlines())
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=data,
        method="POST",
    )
    req.add_header("User-Agent", "PhoneScout/1.0 (lightweight research agent)")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            sys.stderr.write("Overpass rate-limited — waiting 3s then retrying once.\n")
            time.sleep(3)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp2:
                    return json.loads(resp2.read())
            except Exception:
                pass
        sys.stderr.write(f"Overpass HTTP {exc.code}\n")
        return None
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"Overpass failed: {exc}\n")
        return None


def _geocode(location: str) -> tuple[float, float] | None:
    """Geocode a location name to lat/lon via Nominatim (free, no key).

    Returns None if the geocoder fails or can't find the location —
    the caller should report this clearly rather than defaulting silently.
    """
    url = (
        "https://nominatim.openstreetmap.org/search?"
        + urllib.parse.urlencode({"q": location, "format": "json", "limit": 1})
    )
    req = urllib.request.Request(url, headers={"User-Agent": "PhoneScout/1.0 (research agent)"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            if data and isinstance(data, list):
                return (float(data[0]["lat"]), float(data[0]["lon"]))
    except (urllib.error.URLError, OSError, json.JSONDecodeError, (ValueError, KeyError, IndexError)):
        pass
    return None


def _resolve_tag(query: str) -> tuple[str, str]:
    """Determine (osm_key, osm_value) from query keywords."""
    ql = query.lower()
    for kw, tag in sorted(_OSM_TAGS.items(), key=lambda x: len(x[0]), reverse=True):
        if kw in ql:
            return tag
    return ("shop", "hairdresser")  # default


def _search_osm(query: str, max_results: int = 10) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Discover businesses via OpenStreetMap Overpass API.

    Geocodes the query via free Nominatim API to get lat/lon, then queries
    Overpass for nearby businesses. Falls back to empty results if geocoding fails.
    """
    key, value = _resolve_tag(query)
    coords = _geocode(query)
    if not coords:
        return [], {"location_geocoded": False, "backend": "osm", "error": "geocoding_failed"}
    lat, lon = coords

    osm_query = f"""
    [out:json];
    node["{key}"="{value}"](around:5000,{lat},{lon});
    out body {max_results + 10};
    """

    data = _overpass_query(osm_query)
    if not data:
        return []

    results: list[dict[str, Any]] = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name", "")
        if not name:
            continue

        phone_raw = tags.get("phone") or tags.get("contact:phone") or ""
        website = tags.get("website") or tags.get("contact:website") or ""
        if website and not website.startswith("http"):
            website = f"https://{website}"

        street = tags.get("addr:street", "")
        hnum = tags.get("addr:housenumber", "")
        city = tags.get("addr:city", "")
        addr = f"{hnum} {street}, {city}".strip().rstrip(",") if street else ""

        results.append({
            "name": name,
            "url": website,
            "phones": [phone_raw] if phone_raw else [],
            "location": addr or f"{el.get('lat', '')},{el.get('lon', '')}",
            "lat": el.get("lat"),
            "lon": el.get("lon"),
            "discovery_source": "openstreetmap_overpass",
        })

        if len(results) >= max_results:
            break

    return results, {
        "location_geocoded": True,
        "location_used": f"{lat},{lon}",
        "tag_used": f"{key}={value}",
        "backend": "osm",
    }


# ── Google Places API ─────────────────────────────────────────────────────


def _places_api_call(url: str, api_key: str, timeout: int = 15) -> dict[str, Any] | None:
    """Make a Google Places API call, handling errors gracefully."""
    sep = "&" if "?" in url else "?"
    full_url = f"{url}{sep}key={api_key}"
    req = urllib.request.Request(full_url)
    req.add_header("User-Agent", "PhoneScout/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read())
            status = data.get("status", "")
            if status not in ("OK", "ZERO_RESULTS"):
                sys.stderr.write(f"Google Places API returned: {status}")
                if data.get("error_message"):
                    sys.stderr.write(f" — {data['error_message']}")
                sys.stderr.write("\n")
                if status == "REQUEST_DENIED":
                    return None
            return data
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"Places API call failed: {exc}\n")
        return None


def _search_google_places(query: str, max_results: int = 10) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Discover businesses via Google Places API.

    Returns (results, meta) — same shape as _search_osm for pluggability.
    """
    api_key = _get_google_api_key()
    if not api_key:
        sys.stderr.write("Google Places: no API key found. Set GOOGLE_PLACES_API_KEY.\n")
        return [], {"location_geocoded": False, "backend": "google", "error": "no_api_key"}

    gtype = _resolve_google_type(query)

    # Phase 1: Text Search — Google handles the location internally, no geocoding needed.
    # The full natural-language query ("restaurant Cape Town") goes straight through.
    search_url = (
        "https://maps.googleapis.com/maps/api/place/textsearch/json"
        f"?query={urllib.parse.quote(query)}&type={gtype}"
    )
    data = _places_api_call(search_url, api_key)
    if not data:
        return [], {"location_geocoded": True, "backend": "google", "error": "api_call_failed"}

    candidates = (data.get("results") or [])[:max_results]
    if not candidates:
        return [], {"location_geocoded": True, "backend": "google", "note": "zero_results"}

    # Phase 2: Place Details for each candidate (get phone + website)
    results: list[dict[str, Any]] = []
    for place in candidates:
        place_id = place.get("place_id", "")
        name = place.get("name", "")
        vicinity = place.get("vicinity", "")
        rating = place.get("rating")

        if not name:
            continue

        phone = ""
        website = ""
        address = vicinity  # fallback

        if place_id:
            details_url = (
                f"https://maps.googleapis.com/maps/api/place/details/json"
                f"?place_id={place_id}"
                f"&fields=formatted_phone_number,website,formatted_address,rating"
            )
            details = _places_api_call(details_url, api_key)
            if details:
                result = details.get("result", {})
                phone = result.get("formatted_phone_number", "")
                website = result.get("website", "")
                address = result.get("formatted_address", "") or address
                if not rating and result.get("rating"):
                    rating = result["rating"]

        results.append({
            "name": name,
            "url": website,
            "phones": [phone] if phone else [],
            "location": address,
            "lat": place.get("geometry", {}).get("location", {}).get("lat"),
            "lon": place.get("geometry", {}).get("location", {}).get("lng"),
            "rating": rating,
            "discovery_source": "google_places",
        })

        if len(results) >= max_results:
            break

    return results, {
        "location_geocoded": True,
        "backend": "google",
    }


# ── Public API ───────────────────────────────────────────────────────────

_BACKENDS = {"osm": _search_osm, "google": _search_google_places}


def _auto_backend() -> str:
    """Use Google Places if an API key exists, otherwise fall back to OSM."""
    if _get_google_api_key():
        return "google"
    return "osm"


def search_web(
    query: str,
    max_results: int = 10,
    backend: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Search for businesses matching `query`.

    Returns (results, meta) where results are [{name, phones, url, ...}, ...]
    and `meta` includes `location_geocoded` (bool), `backend`, and diagnostics
    the caller uses to decide whether to warn the user if geocoding failed.

    Auto-selects Google Places if GOOGLE_PLACES_API_KEY is set,
    otherwise falls back to OpenStreetMap Overpass (free, no key).
    """
    if backend is None:
        backend = _auto_backend()

    fn = _BACKENDS.get(backend)
    if not fn:
        sys.stderr.write(f"Unknown backend: {backend}\n")
        return [], {"error": f"unknown_backend: {backend}"}

    try:
        return fn(query, max_results)
    except Exception as exc:
        sys.stderr.write(f"Search backend {backend} failed: {exc}\n")
        return [], {"backend": backend, "error": str(exc)}


# ── CLI ──────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        prog="web_search.py",
        description="Keyless business discovery with phone-number extraction (OSM Overpass).",
    )
    p.add_argument("query", nargs="+", help="Search query")
    p.add_argument("--max-results", type=int, default=10)
    p.add_argument("--pretty", action="store_true")
    p.add_argument("--backend", default=None, choices=["osm", "google"],
                   help="Force a specific backend (default: auto — Google if key exists, else OSM)")
    args = p.parse_args(argv)

    query = " ".join(args.query)
    results, meta = search_web(query, max_results=args.max_results, backend=args.backend)

    if not meta.get("location_geocoded"):
        sys.stderr.write(
            f"Warning: could not geocode the location from \"{query}\". "
            f"Try including a more specific city name.\n"
        )

    if args.pretty:
        print(json.dumps({"results": results, "meta": meta}, indent=2, ensure_ascii=False, default=str))
    else:
        for r in results:
            phones = ", ".join(r.get("phones", [])) or "(no phone)"
            loc = (r.get("location") or "")[:60]
            rating = f" ★{r['rating']}" if r.get("rating") else ""
            print(f'{r["name"]:45s} {phones:20s} {loc}{rating}')
        if not results:
            sys.stderr.write(f"No results found (backend: {meta.get('backend', '?')}).\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())