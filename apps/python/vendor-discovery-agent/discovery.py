"""
Module 1 — Vendor Discovery via OpenStreetMap Overpass API.
Finds businesses matching a product category within a location,
returning only those with a phone number.
Data is ODbL licensed — attribution required in any user-facing output.
"""
import re
import json
import time
import urllib.request
import urllib.parse
from typing import Optional

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"

# (south, west, north, east) bounding boxes for common Indian cities — avoids Nominatim calls
_CITY_BBOX_CACHE: dict = {
    "delhi": (28.40, 76.84, 28.88, 77.35),
    "new delhi": (28.40, 76.84, 28.88, 77.35),
    "connaught place": (28.58, 77.17, 28.70, 77.28),
    "connaught place, delhi": (28.58, 77.17, 28.70, 77.28),
    "chandni chowk": (28.60, 77.18, 28.72, 77.30),
    "chandni chowk, delhi": (28.60, 77.18, 28.72, 77.30),
    "mumbai": (18.87, 72.77, 19.27, 72.99),
    "bangalore": (12.83, 77.46, 13.14, 77.78),
    "bengaluru": (12.83, 77.46, 13.14, 77.78),
    "hyderabad": (17.27, 78.27, 17.57, 78.67),
    "chennai": (12.90, 80.12, 13.23, 80.33),
    "kolkata": (22.45, 88.24, 22.70, 88.47),
    "pune": (18.42, 73.74, 18.64, 73.99),
    "ahmedabad": (22.93, 72.47, 23.12, 72.72),
    "jaipur": (26.82, 75.73, 26.97, 75.91),
    "lucknow": (26.78, 80.86, 26.95, 81.05),
    "surat": (21.10, 72.78, 21.28, 72.95),
    "kanpur": (26.39, 80.24, 26.53, 80.43),
    "nagpur": (21.07, 78.96, 21.23, 79.17),
    "noida": (28.48, 77.31, 28.64, 77.51),
    "gurugram": (28.38, 76.99, 28.52, 77.12),
    "gurgaon": (28.38, 76.99, 28.52, 77.12),
    "chandigarh": (30.66, 76.72, 30.79, 76.87),
    "bhopal": (23.16, 77.31, 23.30, 77.50),
    "indore": (22.63, 75.76, 22.78, 75.93),
    "patna": (25.55, 85.05, 25.65, 85.22),
    "vadodara": (22.25, 73.11, 22.38, 73.26),
    "coimbatore": (10.94, 76.90, 11.07, 77.07),
    "kochi": (9.91, 76.21, 10.06, 76.36),
    "vizag": (17.64, 83.18, 17.79, 83.36),
    "visakhapatnam": (17.64, 83.18, 17.79, 83.36),
}
# Runtime geocoding cache (session-level, avoids re-calling Nominatim for same location)
_geocode_runtime_cache: dict = {}
OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]
USER_AGENT = "VendorDiscoveryHackathon/1.0 (CALLE hackathon project)"

# Maps plain-English product keywords to OSM shop/amenity tags.
# Not exhaustive — the fallback does a free-text name search.
KEYWORD_TAG_MAP = {
    "grocery": [("shop", "supermarket"), ("shop", "grocery"), ("shop", "convenience")],
    "electronics": [("shop", "electronics"), ("shop", "computer")],
    "hardware": [("shop", "hardware"), ("shop", "doityourself")],
    "furniture": [("shop", "furniture")],
    "clothing": [("shop", "clothes"), ("shop", "fashion")],
    "bakery": [("shop", "bakery"), ("amenity", "cafe")],
    "restaurant": [("amenity", "restaurant"), ("amenity", "fast_food")],
    "pharmacy": [("amenity", "pharmacy"), ("shop", "chemist")],
    "stationery": [("shop", "stationery"), ("shop", "office_supplies")],
    "printing": [("shop", "copyshop"), ("craft", "printing")],
    "catering": [("amenity", "catering"), ("shop", "deli")],
    "florist": [("shop", "florist")],
    "automotive": [("shop", "car"), ("shop", "car_parts"), ("amenity", "car_repair")],
    "hotel": [("tourism", "hotel"), ("tourism", "hostel")],
    "gym": [("leisure", "fitness_centre"), ("amenity", "gym")],
    "bookstore": [("shop", "books")],
    "toys": [("shop", "toys")],
    "jewelry": [("shop", "jewelry"), ("shop", "jewellery")],
    "sports": [("shop", "sports")],
    "medical": [("amenity", "clinic"), ("amenity", "hospital"), ("amenity", "doctors")],
    "shoes": [("shop", "shoes")],
    "footwear": [("shop", "shoes")],
    "shoe": [("shop", "shoes")],
}


_llm_tag_cache: dict = {}


def _llm_map_to_osm_tags(product: str) -> list[tuple[str, str]]:
    """Use Groq to map an unknown product to OSM shop/amenity tags."""
    key = product.lower().strip()
    if key in _llm_tag_cache:
        return _llm_tag_cache[key]

    import os, json as _json
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return []
    try:
        from groq import Groq
        import concurrent.futures as _cf
        client = Groq(api_key=api_key)
        prompt = (
            f'Map the product/service "{product}" to the most likely OpenStreetMap tags for finding vendors/shops.\n'
            'Return ONLY a JSON array of [key, value] pairs, e.g. [["shop","electronics"],["craft","jeweller"]].\n'
            'Include 1-3 pairs. If completely unknown return [].'
        )
        def _call():
            return client.chat.completions.create(
                model="groq/compound",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=80, temperature=0,
            )
        with _cf.ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_call)
            resp = fut.result(timeout=10)
        raw = resp.choices[0].message.content.strip()
        raw = raw.strip('`').strip()
        if raw.startswith('json'):
            raw = raw[4:].strip()
        pairs = _json.loads(raw)
        result = [(str(k), str(v)) for k, v in pairs if isinstance(k, str) and isinstance(v, str)]
        _llm_tag_cache[key] = result
        return result
    except Exception:
        return []


def _keyword_to_tags(product_description: str) -> list[tuple[str, str]]:
    desc = product_description.lower()
    for keyword, tags in KEYWORD_TAG_MAP.items():
        if keyword in desc:
            return tags
    # KEYWORD_TAG_MAP miss: try LLM mapper before falling back to name-only search
    llm_tags = _llm_map_to_osm_tags(product_description)
    if llm_tags:
        return llm_tags
    # fallback: match against shop and amenity with name containing keywords
    return []


MIN_BBOX_DEGREES = 0.02  # ~2km; expand if Nominatim returns a point/tiny bbox


def geocode_location(location: str) -> tuple[float, float, float, float]:
    """Returns (south, west, north, east) bounding box for location string."""
    import urllib.error as _ue
    key = location.lower().strip()

    # 1. Static city cache (no network needed)
    if key in _CITY_BBOX_CACHE:
        return _CITY_BBOX_CACHE[key]
    # Check if any known city name appears in the location string
    for city_key, bbox in _CITY_BBOX_CACHE.items():
        if city_key in key:
            return bbox

    # 2. Runtime session cache
    if key in _geocode_runtime_cache:
        return _geocode_runtime_cache[key]

    # 3. Nominatim API with retry backoff
    params = urllib.parse.urlencode({"q": location, "format": "json", "limit": 1})
    data = None
    for attempt in range(3):
        req = urllib.request.Request(
            f"{NOMINATIM_URL}?{params}",
            headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            break
        except _ue.HTTPError as e:
            if e.code == 429 and attempt < 2:
                time.sleep(15 * (attempt + 1))
                continue
            raise
    if not data:
        raise ValueError(f"Could not geocode location: {location!r}")
    result = data[0]
    bb = result["boundingbox"]  # [south, north, west, east]
    s, n, w, e = float(bb[0]), float(bb[1]), float(bb[2]), float(bb[3])
    # Expand tiny bboxes (points, small landmarks) to MIN_BBOX_DEGREES
    if (n - s) < MIN_BBOX_DEGREES or (e - w) < MIN_BBOX_DEGREES:
        lat = (s + n) / 2
        lon = (w + e) / 2
        half = MIN_BBOX_DEGREES / 2
        s, n, w, e = lat - half, lat + half, lon - half, lon + half
    bbox = (s, w, n, e)
    _geocode_runtime_cache[key] = bbox
    return bbox


def _build_overpass_query(tags: list[tuple[str, str]], bbox: tuple, limit: int) -> str:
    s, w, n, e = bbox
    bbox_str = f"{s},{w},{n},{e}"
    union_parts = []
    for tag_key, tag_val in tags:
        for elem_type in ("node", "way"):
            union_parts.append(f'  {elem_type}["{tag_key}"="{tag_val}"]["phone"]({bbox_str});')
            union_parts.append(f'  {elem_type}["{tag_key}"="{tag_val}"]["contact:phone"]({bbox_str});')
    union_body = "\n".join(union_parts)
    return f'[out:json][timeout:60];\n(\n{union_body}\n);\nout body center qt {limit};'


def geocode_point(location: str) -> tuple[float, float]:
    """Returns (lat, lon) center point for a location string via Nominatim."""
    params = urllib.parse.urlencode({
        "q": location,
        "format": "json",
        "limit": 1,
    })
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    if not data:
        raise ValueError(f"Could not geocode location: {location!r}")
    result = data[0]
    return float(result["lat"]), float(result["lon"])


def _build_around_query(tags: list[tuple[str, str]], lat: float, lon: float,
                        radius_m: int, limit: int) -> str:
    around = f"around:{radius_m},{lat},{lon}"
    union_parts = []
    for tag_key, tag_val in tags:
        for elem_type in ("node", "way", "relation"):
            union_parts.append(f'  {elem_type}["{tag_key}"="{tag_val}"]["phone"]({around});')
            union_parts.append(f'  {elem_type}["{tag_key}"="{tag_val}"]["contact:phone"]({around});')
    union_body = "\n".join(union_parts)
    return f'[out:json][timeout:60];\n(\n{union_body}\n);\nout body center qt {limit};'


def _build_name_fallback_query(product: str, bbox: tuple, limit: int) -> str:
    s, w, n, e = bbox
    bbox_str = f"{s},{w},{n},{e}"
    safe = re.sub(r'[^a-zA-Z0-9 ]', '', product)[:40]
    return (
        f'[out:json][timeout:30];\n'
        f'(\n'
        f'  node["name"~"{safe}",i]["phone"]({bbox_str});\n'
        f'  node["name"~"{safe}",i]["contact:phone"]({bbox_str});\n'
        f');\n'
        f'out body center qt {limit};'
    )


def _run_overpass(query: str) -> list[dict]:
    import urllib.error
    data = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for server in OVERPASS_SERVERS:
        req = urllib.request.Request(
            server, data=data,
            headers={"User-Agent": USER_AGENT,
                     "Content-Type": "application/x-www-form-urlencoded"}
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                result = json.loads(resp.read())
            return result.get("elements", [])
        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Rate limited — wait 65s then retry this server once
                print(f"  [Overpass] 429 from {server}, waiting 65s...")
                time.sleep(65)
                try:
                    req2 = urllib.request.Request(
                        server, data=data,
                        headers={"User-Agent": USER_AGENT,
                                 "Content-Type": "application/x-www-form-urlencoded"}
                    )
                    with urllib.request.urlopen(req2, timeout=90) as resp:
                        result = json.loads(resp.read())
                    return result.get("elements", [])
                except Exception as e2:
                    last_err = e2
                    continue
            if e.code == 504:
                last_err = e
                time.sleep(3)
                continue
            last_err = e
            continue
        except (urllib.error.URLError, OSError) as e:
            last_err = e
            continue
    raise RuntimeError(f"All Overpass servers failed. Last error: {last_err}")


def _normalize_phone(raw: str) -> Optional[str]:
    cleaned = re.sub(r'[^\d+]', '', raw)
    if not cleaned:
        return None
    # OSM sometimes concatenates multiple numbers: "+919812345678+919876543210"
    # Split on every '+' boundary after the first character and take the first segment
    parts = re.split(r'(?<=\d)(?=\+)', cleaned)
    digits = parts[0].strip()
    if not digits:
        return None
    if not digits.startswith('+'):
        digits = '+' + digits
    if len(digits) < 8:
        return None
    return digits


def _looks_spam(phone: str) -> bool:
    """True for obviously fake/spam numbers: too few digits or all-same-digit repeats."""
    digits = re.sub(r'\D', '', phone or "")
    if len(digits) < 8:
        return True
    if len(set(digits)) <= 2:
        return True
    return False


def discover_vendors(product_description: str, location: str, limit: int = 20,
                     radius_km: float = None) -> list[dict]:
    """
    Returns a list of vendor dicts with keys:
      name, phone (E.164 best-effort), category, lat, lon, osm_id
    Only vendors with a usable phone number are returned.
    When radius_km is provided, an around-based (radius) search centered on the
    geocoded location is used instead of a bounding-box search.
    Attribution: Data © OpenStreetMap contributors (ODbL)
    """
    tags = _keyword_to_tags(product_description)

    if radius_km is not None:
        lat, lon = geocode_point(location)
        radius_m = int(radius_km * 1000)
        bbox = None
        if tags:
            elements = _run_overpass(
                _build_around_query(tags, lat, lon, radius_m, limit * 3))
        else:
            elements = []
    else:
        bbox = geocode_location(location)
        if tags:
            elements = _run_overpass(_build_overpass_query(tags, bbox, limit * 3))
        else:
            elements = []

    if not elements:
        if radius_km is not None:
            # widen the around search into a bbox around the same center for fallback
            half = MIN_BBOX_DEGREES / 2
            bbox = (lat - half, lon - half, lat + half, lon + half)
        elements = _run_overpass(_build_name_fallback_query(product_description, bbox, limit * 3))

    seen_phones = set()
    vendors = []
    for el in elements:
        t = el.get("tags", {})
        raw_phone = t.get("phone") or t.get("contact:phone") or ""
        phone = _normalize_phone(raw_phone)
        if not phone or phone in seen_phones:
            continue
        seen_phones.add(phone)
        # Build address from OSM addr:* tags
        addr_parts = []
        if t.get("addr:housenumber") and t.get("addr:street"):
            addr_parts.append(f"{t['addr:housenumber']} {t['addr:street']}")
        elif t.get("addr:street"):
            addr_parts.append(t["addr:street"])
        elif t.get("addr:full"):
            addr_parts.append(t["addr:full"])
        elif t.get("addr:place"):
            addr_parts.append(t["addr:place"])
        for key in ("addr:suburb", "addr:city", "addr:state", "addr:postcode"):
            if t.get(key):
                addr_parts.append(t[key])
        address = ", ".join(addr_parts) if addr_parts else None

        vendors.append({
            "name": t.get("name", "Unknown"),
            "phone": phone,
            "category": t.get("shop") or t.get("amenity") or t.get("craft") or "business",
            "lat": el.get("lat") or el.get("center", {}).get("lat"),
            "lon": el.get("lon") or el.get("center", {}).get("lon"),
            "osm_id": f"{el['type']}/{el['id']}",
            "address": address,
            "tags": {
                "website": el.get("tags", {}).get("website") or el.get("tags", {}).get("contact:website"),
                "opening_hours": el.get("tags", {}).get("opening_hours"),
                "email": el.get("tags", {}).get("email") or el.get("tags", {}).get("contact:email"),
                "addr:street": el.get("tags", {}).get("addr:street"),
                "addr:housenumber": el.get("tags", {}).get("addr:housenumber"),
                "addr:city": el.get("tags", {}).get("addr:city"),
                "addr:postcode": el.get("tags", {}).get("addr:postcode"),
            },
        })
        if len(vendors) >= limit:
            break

    return vendors
