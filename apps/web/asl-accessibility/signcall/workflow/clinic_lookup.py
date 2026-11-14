"""
Finding clinics to call. Pure lookup, no CALL-E dependency.

Turns a ZIP and an appointment type into up to 10 nearby clinics, nearest
first, for clinic_call.search_clinics() to phone. Each clinic is the record
defined by schemas/clinic_record.schema.json (name, type, phone, zipcode, plus
an optional street address) and is validated against it before anything
downstream sees it.

Source: Apify's Google Maps Scraper (actor compass/crawler-google-places),
which returns the Maps listing itself, so every field of a clinic comes from
that one listing.

Things to know:

  - Yield is not guaranteed. A place is dropped when it has no callable US
    number, no 5-digit ZIP, is closed, is outside the US, repeats a phone
    number already seen, or its category doesn't plausibly match the search.
    20 places are requested to fill a list of 10.
  - Apify bills per place scraped, and a run takes tens of seconds. The call
    is synchronous.
  - Distance comes from ZIP centroids, not Maps' own ordering, so clinics in
    the user's ZIP all score 0.0 and a ZIP outside the covered states sorts last.
  - There is no synthetic fallback. A missing token, an Apify failure, or zero
    surviving places all return an empty list, and the workflow reports that
    no clinic could be found rather than inventing one.
"""

from __future__ import annotations

import json
import math
import os
import re
import time
from datetime import datetime
from pathlib import Path

from .types import AppointmentType, ClinicCandidate, distance_sort_key
from .user_input import zip_centroids, zip_state

APIFY_BASE = "https://api.apify.com/v2"
APIFY_ACTOR = "compass~crawler-google-places"  # "compass/crawler-google-places", tilde-encoded

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_DUMP_PATH = DATA_DIR / "clinics_last_search.json"
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "clinic_record.schema.json"

MAX_PLACES_REQUESTED = 20   # headroom over the 10-clinic cap, since filtering is lossy
POLL_INTERVAL_SECONDS = 3.0
RUN_DEADLINE_SECONDS = 240.0
HTTP_TIMEOUT_SECONDS = 60.0

# Apify run statuses use hyphens, and only SUCCEEDED has a dataset worth fetching.
RUN_SUCCEEDED = "SUCCEEDED"
RUN_TERMINAL = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}

# The Maps search phrase for each appointment type.
SEARCH_PHRASES = {
    AppointmentType.PHYSICAL_THERAPY: "physical therapy clinic",
    AppointmentType.EYES: "optometrist",
    AppointmentType.ENT: "ENT doctor",
    AppointmentType.DENTAL: "dentist",
    AppointmentType.MENTAL: "mental health clinic",
    AppointmentType.GENERAL: "primary care clinic",
}

# Keywords that make a Maps category plausibly the thing searched for. Maps
# returns adjacent and sponsored businesses (an "optometrist" search surfaces
# sunglasses shops), and the call script is built from the user's requested
# type, so without this an off-category business would be phoned with the wrong
# script.
CATEGORY_KEYWORDS = {
    AppointmentType.PHYSICAL_THERAPY: ("physical therap", "physiotherap", "rehabilitation", "sports medicine"),
    AppointmentType.EYES: ("optometrist", "ophthalmolog", "eye care", "eye doctor", "optician", "vision"),
    AppointmentType.ENT: ("otolaryngolog", "ear nose", "ent ", "ent doctor", "audiolog", "sinus"),
    AppointmentType.DENTAL: ("dentist", "dental", "orthodont", "endodont", "periodont", "oral surgeon"),
    AppointmentType.MENTAL: ("mental health", "psychiatr", "psycholog", "counselor", "counsell", "therapist", "behavioral health"),
    AppointmentType.GENERAL: ("family practice", "medical clinic", "general practitioner", "primary care",
                               "doctor", "physician", "medical center", "medical group", "walk-in clinic",
                               "urgent care", "internist", "medical office"),
}

_ZIP_RE = re.compile(r"(\d{5})")
# Anchored on purpose: an unanchored search over "+44 20 7946 0958" would match
# "2079460958" and return a live US number belonging to an unrelated party.
_US_PHONE_RE = re.compile(r"^(?:\+?1)?([2-9][0-9]{2})([2-9][0-9]{2})([0-9]{4})$")

_schema_cache: dict | None = None


# --- record shape --------------------------------------------------------

def _schema() -> dict:
    global _schema_cache
    if _schema_cache is None:
        _schema_cache = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return _schema_cache


def validate_record(record: dict) -> bool:
    """True when `record` conforms to schemas/clinic_record.schema.json. A
    record that doesn't is dropped; one odd listing must not fail a lookup."""
    try:
        import jsonschema

        jsonschema.validate(record, _schema())
    except Exception:
        return False
    return True


def record_to_candidate(record: dict, source: str) -> ClinicCandidate:
    return ClinicCandidate(
        name=record["name"],
        phone=record["phone"],
        zipcode=record["zipcode"],
        clinic_type=record["type"],
        source=source,
        address=record.get("address"),
    )


def candidate_to_record(clinic: ClinicCandidate) -> dict:
    record = {
        "name": clinic.name,
        "type": clinic.clinic_type,
        "phone": clinic.phone,
        "zipcode": clinic.zipcode,
    }
    if clinic.address:
        record["address"] = clinic.address
    return record


# --- extraction ----------------------------------------------------------

def normalize_phone(raw: str) -> str | None:
    """A US 10-digit number to E.164, or None. Matches the whole string once
    punctuation is stripped, so an international number is never mangled into
    a US one."""
    if not isinstance(raw, str):
        return None
    digits = re.sub(r"[\s().\-‐-―]", "", raw.strip())
    match = _US_PHONE_RE.match(digits)
    if not match:
        return None
    return "+1" + "".join(match.groups())


def extract_zip(raw: str) -> str | None:
    """The leading 5-digit run, by match rather than slicing, so a Canadian
    'V6B 1A1' yields None instead of a plausible wrong ZIP."""
    if not isinstance(raw, str):
        return None
    match = _ZIP_RE.match(raw.strip())
    return match.group(1) if match else None


def category_matches(category: str, appointment_type: AppointmentType) -> bool:
    lowered = (category or "").lower()
    return any(keyword in lowered for keyword in CATEGORY_KEYWORDS[appointment_type])


def place_to_record(place: dict, appointment_type: AppointmentType) -> dict | None:
    """One Apify Google Maps item to a clinic record, or None when the place
    isn't usable. Every field comes from this one place."""
    if not isinstance(place, dict):
        return None
    if place.get("permanentlyClosed") or place.get("temporarilyClosed"):
        return None
    country = place.get("countryCode")
    if country and str(country).upper() != "US":
        return None

    phone = normalize_phone(place.get("phoneUnformatted") or "") or normalize_phone(place.get("phone") or "")
    if phone is None:
        return None

    zipcode = extract_zip(place.get("postalCode") or "")
    if zipcode is None:
        return None

    category = place.get("categoryName")
    if not category:
        categories = place.get("categories")
        category = categories[0] if isinstance(categories, list) and categories else None
    if category and not category_matches(str(category), appointment_type):
        return None
    # With no category at all, `type` falls back to the searched label.
    clinic_type = str(category) if category else SEARCH_PHRASES[appointment_type]

    name = (place.get("title") or "").strip()
    if not name:
        return None

    record = {"name": name, "type": clinic_type, "phone": phone, "zipcode": zipcode}
    address = (place.get("address") or "").strip()
    if address:
        record["address"] = address
    return record


def places_to_records(places: list, appointment_type: AppointmentType) -> list[dict]:
    """Maps items to validated records, de-duplicated by phone. Multi-location
    practices share one central number, and real-mode line routing is sticky
    per phone, so duplicates in one list would collapse onto a single line."""
    records: list[dict] = []
    seen_phones: set[str] = set()
    for place in places or []:
        record = place_to_record(place, appointment_type)
        if record is None or record["phone"] in seen_phones:
            continue
        if not validate_record(record):
            continue
        seen_phones.add(record["phone"])
        records.append(record)
    return records


# --- distance ------------------------------------------------------------

def haversine_miles(a: "tuple[float, float]", b: "tuple[float, float]") -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 3958.7613 * 2 * math.asin(math.sqrt(h))


def zip_distance_miles(zip_a: str, zip_b: str) -> float | None:
    """Miles between two ZIP centroids, or None if either is outside the
    covered states (callers sort those last rather than guess)."""
    centroids = zip_centroids()
    first, second = centroids.get(zip_a), centroids.get(zip_b)
    if not first or not second:
        return None
    return round(haversine_miles((first["lat"], first["lon"]), (second["lat"], second["lon"])), 1)


# --- Apify transport -----------------------------------------------------

def _actor_input(zipcode: str, appointment_type: AppointmentType) -> dict:
    # The actor geocodes locationQuery before crawling and cannot place a bare
    # ZIP reliably, so the state is spelled out. It is resolved from the ZIP,
    # never hardcoded: a wrong state yields a location that doesn't exist and
    # an empty result.
    state = zip_state(zipcode)
    location = f"{zipcode}, {state}, United States" if state else f"{zipcode}, United States"
    return {
        "searchStringsArray": [SEARCH_PHRASES[appointment_type]],
        "locationQuery": location,
        "maxCrawledPlacesPerSearch": MAX_PLACES_REQUESTED,
        "language": "en",
        "skipClosedPlaces": True,
    }


def fetch_places(zipcode: str, appointment_type: AppointmentType, token: str) -> list:
    """Start the actor, poll it to a terminal status, and return its dataset
    items. Raises on any failure; find_clinics() decides what that means."""
    import httpx

    # Bearer header, not ?token=, so the token can't land in a log line.
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, headers=headers) as client:
        started = client.post(
            f"{APIFY_BASE}/acts/{APIFY_ACTOR}/runs",
            json=_actor_input(zipcode, appointment_type),
        )
        started.raise_for_status()
        run = started.json()["data"]
        run_id, dataset_id = run["id"], run["defaultDatasetId"]

        deadline = time.monotonic() + RUN_DEADLINE_SECONDS
        status = str(run.get("status", ""))
        while status not in RUN_TERMINAL:
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Apify run {run_id} still {status!r} after {RUN_DEADLINE_SECONDS}s")
            time.sleep(POLL_INTERVAL_SECONDS)
            polled = client.get(f"{APIFY_BASE}/actor-runs/{run_id}")
            polled.raise_for_status()
            status = str(polled.json()["data"].get("status", ""))

        if status != RUN_SUCCEEDED:
            raise RuntimeError(f"Apify run {run_id} finished {status}")

        items = client.get(f"{APIFY_BASE}/datasets/{dataset_id}/items", params={"clean": "true"})
        items.raise_for_status()
        return items.json()


# --- inspection dump -----------------------------------------------------

def _dump(path, zipcode: str, appointment_type: AppointmentType, source: str, records: list[dict]) -> None:
    """Writes the most recent search to a side file for debugging. Atomic, and
    never allowed to break a lookup. It holds real business names and numbers,
    which is why it is gitignored."""
    payload = {
        "searched_zipcode": zipcode,
        "appointment_type": appointment_type.value,
        "retrieved": datetime.now().isoformat(timespec="seconds"),
        "source": source,
        "clinics": records,
    }
    try:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(payload, indent=1), encoding="utf-8")
        temp.replace(path)
    except OSError:
        pass


# --- search --------------------------------------------------------------

def find_clinics(
    zipcode: str,
    appointment_type: AppointmentType,
    limit: int = 10,
    dump_path=DEFAULT_DUMP_PATH,
) -> list[ClinicCandidate]:
    """Up to `limit` clinics, nearest first. Fewer than `limit`, or none, is an
    ordinary outcome: any failure (no token, auth error, usage limit, a failed
    or timed-out run, zero places surviving the filters) returns an empty list
    rather than anything fabricated."""
    token = os.environ.get("APIFY_API_TOKEN")
    records: list[dict] = []
    if token:
        try:
            records = places_to_records(fetch_places(zipcode, appointment_type, token), appointment_type)
        except Exception:
            records = []

    clinics = [record_to_candidate(record, "apify_google_maps") for record in records]
    for clinic in clinics:
        clinic.distance_miles = zip_distance_miles(zipcode, clinic.zipcode)
    clinics.sort(key=lambda c: distance_sort_key(c.distance_miles))
    clinics = clinics[:limit]

    # Dumped after sorting and capping, so the file is exactly what gets called.
    if dump_path is not None:
        _dump(dump_path, zipcode, appointment_type, "apify_google_maps", [candidate_to_record(c) for c in clinics])
    return clinics
