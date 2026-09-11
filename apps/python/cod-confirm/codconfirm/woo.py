"""Reading a live WooCommerce store, and writing decisions back into it.

Everything else in this package speaks in `Order`. This is the only file
that knows WooCommerce exists, so a shop swaps its demo book for its real
one by setting `STORE_SOURCE=woocommerce` and three credentials, not by
changing the sweep.

What it reads:

* cash-on-delivery orders still waiting for dispatch, placed recently
* each customer's history in the same store, matched on their phone number,
  so the refusal risk comes from the shop's own records rather than from a
  national average

What it writes, and only on a `--live` run:

* a private order note carrying the decision, and the transcript when a
  person has to finish the order
* two meta fields, `cod_confirm_status` and `cod_confirm_attempts`, so the
  next sweep knows what has already happened

It never changes an order's WooCommerce status. Whether a confirmed order
moves to packing, or a refused one is cancelled, stays the shop's decision,
made in the shop's own workflow. That also keeps the rules that matter most
here true across runs: an order sent to a person is not picked up again until
somebody clears its `cod_confirm_status`, so an ambiguous call is never
redialled by a later sweep.

The mapping is where the care is. A REST payload is written for a page, and
a page can afford to be vague: HTML in a product name, a phone number with no
country code, a free-shipping order whose freight the shop still pays. Each
of those is resolved here rather than passed on.
"""
from __future__ import annotations

import base64
import datetime as dt
import html
import http.client
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from codconfirm import phones
from codconfirm.orders import CANCELLED, CONFIRMED, NEEDS_HUMAN, PENDING, Order

API = "/wp-json/wc/v3"

# Statuses this sweep sets, and so treats as already decided on the next run.
DECIDED = {CONFIRMED, CANCELLED, NEEDS_HUMAN}

META_STATUS = "cod_confirm_status"
META_ATTEMPTS = "cod_confirm_attempts"
NOTE_PREFIX = "COD Confirm: "

# A store that keeps answering with full pages would otherwise be read
# forever. Five thousand orders is far past any small shop's pending book.
MAX_PAGES = 50

TAGS = re.compile(r"<[^>]+>")
SPACE = re.compile(r"\s+")


class WooError(RuntimeError):
    """The store could not be reached, or answered with something unusable."""


def _csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True)
class WooConfig:
    base_url: str
    key: str
    secret: str
    statuses: tuple[str, ...] = ("processing", "on-hold")
    """WooCommerce statuses that mean "placed, not yet dispatched"."""

    lookback_days: int = 7
    """Only orders placed this recently are confirmed.

    Ringing somebody about an order from last month is not a confirmation, it
    is an ambush, and the parcel has usually been dealt with some other way.
    """

    refused_statuses: tuple[str, ...] = ("failed", "refused", "returned")
    """Statuses that mean the customer did not take delivery.

    WooCommerce has no built-in "refused at the door", so shops use their
    own. Set WOO_REFUSED_STATUSES to whatever yours are called.
    """

    home_city: str = ""
    """The shop's own city. Parcels outside it travel further and refuse more."""

    calling_code: str = ""
    """Country calling code for numbers stored without one, e.g. 880.

    Empty means no guessing: a number without a country code is sent to a
    person instead of being rewritten. Adding digits to a destination is
    changing it, and that should be a decision somebody made.
    """

    default_freight: float = 70.0
    """One-way courier cost to assume when an order shows free shipping.

    Free shipping to the customer is not free to the shop, and pricing a
    call as though the freight were nothing would talk the sweep out of
    every free-delivery order.
    """

    timeout: float = 20.0

    @classmethod
    def from_env(cls) -> "WooConfig":
        base = os.environ.get("WOO_BASE_URL", "").strip().rstrip("/")
        key = os.environ.get("WOO_KEY", "").strip()
        secret = os.environ.get("WOO_SECRET", "").strip()
        if not (base and key and secret):
            raise WooError(
                "STORE_SOURCE=woocommerce needs WOO_BASE_URL, WOO_KEY and WOO_SECRET."
            )
        parsed = urllib.parse.urlparse(base)
        local = parsed.hostname in {"127.0.0.1", "localhost"}
        if parsed.scheme != "https" and not local:
            # The key pair travels as basic auth. Over plain HTTP that is the
            # shop's write access to every order, in the clear.
            raise WooError("WOO_BASE_URL must be https:// so the API key is not sent in the clear.")

        return cls(
            base_url=base,
            key=key,
            secret=secret,
            statuses=_csv(os.environ.get("WOO_ORDER_STATUSES", "processing,on-hold")),
            lookback_days=int(os.environ.get("WOO_LOOKBACK_DAYS", "7")),
            refused_statuses=_csv(os.environ.get("WOO_REFUSED_STATUSES", "failed,refused,returned")),
            home_city=os.environ.get("STORE_CITY", "").strip(),
            calling_code=os.environ.get("WOO_DEFAULT_CALLING_CODE", "").strip().lstrip("+"),
            default_freight=float(os.environ.get("WOO_DEFAULT_FREIGHT", "70")),
        )


@dataclass
class _Seen:
    """What the store last held for an order, to know what has changed since."""

    status: str
    attempts: int
    notes: int
    address: str


@dataclass
class WooStore:
    config: WooConfig
    _seen: dict[str, _Seen] = field(default_factory=dict)

    # --- transport ------------------------------------------------------

    def _request(self, method: str, path: str, params: dict | None = None,
                 body: dict | None = None):
        url = f"{self.config.base_url}{API}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        token = base64.b64encode(f"{self.config.key}:{self.config.secret}".encode()).decode()
        headers = {"Authorization": f"Basic {token}", "Accept": "application/json"}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"

        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.config.timeout) as response:
                return json.loads(response.read().decode() or "null")
        except urllib.error.HTTPError as exc:
            exc.close()
            # Never echo the URL back with credentials, and never the body a
            # store sends on error, which can carry customer data.
            raise WooError(f"The store answered {exc.code} to {method} {path}.") from None
        except (OSError, http.client.HTTPException, json.JSONDecodeError) as exc:
            # A connection dropped halfway through a write is exactly the case
            # the sweep has to report cleanly: the call may already have been
            # made. Anything the network can throw becomes one error the sweep
            # knows how to stop on, not a traceback after the phone has rung.
            raise WooError(f"The store could not be reached: {type(exc).__name__}.") from None

    def _paged(self, path: str, params: dict) -> list[dict]:
        rows: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            batch = self._request("GET", path, {**params, "per_page": 100, "page": page})
            if not isinstance(batch, list):
                raise WooError(f"Expected a list of orders from {path}.")
            rows.extend(batch)
            if len(batch) < 100:
                return rows
        raise WooError(f"The store returned more than {MAX_PAGES * 100} orders; "
                       "narrow WOO_ORDER_STATUSES or WOO_LOOKBACK_DAYS.")

    # --- reading --------------------------------------------------------

    def load(self, now: dt.datetime | None = None) -> list[Order]:
        """The cash-on-delivery orders this sweep should consider."""
        now = now or dt.datetime.now(dt.timezone.utc)
        after = (now - dt.timedelta(days=self.config.lookback_days)).strftime("%Y-%m-%dT%H:%M:%S")
        raw = self._paged("/orders", {
            "status": ",".join(self.config.statuses),
            "after": after,
            # The cut-off is worked out in UTC, so tell the store that, or it
            # reads it in the shop's own time zone and moves it by hours.
            "dates_are_gmt": "true",
        })

        history: dict[str, list[dict]] = {}
        orders: list[Order] = []
        self._seen.clear()
        for row in raw:
            if row.get("payment_method") != "cod":
                continue  # paid up front: nothing is waiting at the door
            orders.append(self._to_order(row, history))
        return orders

    def _to_order(self, row: dict, history: dict[str, list[dict]]) -> Order:
        billing = row.get("billing") or {}
        shipping = row.get("shipping") or {}
        meta = {m.get("key"): m.get("value") for m in row.get("meta_data") or []}

        raw_phone = str(billing.get("phone") or "")
        phone = international(raw_phone, self.config.calling_code)

        place = shipping if shipping.get("address_1") else billing
        address = ", ".join(
            plain(place.get(part)) for part in ("address_1", "address_2", "city", "postcode")
            if plain(place.get(part))
        )

        items = []
        for line in row.get("line_items") or []:
            name = plain(line.get("name"))
            quantity = int(line.get("quantity") or 1)
            if name:
                items.append(f"{name} x{quantity}" if quantity > 1 else name)

        freight = money(row.get("shipping_total"))
        city = plain(place.get("city"))

        try:
            attempts = int(meta.get(META_ATTEMPTS) or 0)
            corrupt = False
        except (TypeError, ValueError):
            # Reading garbage as zero would hand this customer a fresh set of
            # attempts. Reading it as anything else would be a guess.
            attempts, corrupt = 0, True

        order = Order(
            id=str(row["id"]),
            customer_name=plain(f"{billing.get('first_name', '')} {billing.get('last_name', '')}"),
            phone=phone,
            address=address,
            items=items or ["(no items listed)"],
            total=money(row.get("total")),
            shipping_cost=freight if freight > 0 else self.config.default_freight,
            outside_home_city=bool(self.config.home_city and city
                                   and city.casefold() != self.config.home_city.casefold()),
            status=str(meta.get(META_STATUS) or PENDING),
            attempts=attempts,
        )
        # Recorded before anything below changes the order, so that a
        # decision made while reading it still counts as a change to write.
        self._seen[order.id] = _Seen(order.status, order.attempts, 0, order.address)

        if corrupt and order.status == PENDING:
            order.status = NEEDS_HUMAN
            order.log(f"{META_ATTEMPTS} on this order is not a number, so how many "
                      "times it has been called is unknown. It was not called again.")
            return order

        if order.status == PENDING:
            try:
                phones.normalise(phone)
            except phones.UnsafeNumber:
                # Unusable as it stands, and rewriting it would be guessing at
                # somebody's phone number. A person fixes the order instead.
                order.status = NEEDS_HUMAN
                order.log(
                    "The phone number on this order is not in international form, "
                    "so it was not called. Add the country code, or set "
                    "WOO_DEFAULT_CALLING_CODE if every order is local."
                )
                return order

        past = self._history(phone, history)
        earlier = [o for o in past if str(o.get("id")) != order.id]
        order.previous_orders = sum(1 for o in earlier if o.get("status") == "completed")
        order.previous_refusals = sum(
            1 for o in earlier if o.get("status") in self.config.refused_statuses
        )
        return order

    def _history(self, phone: str, cache: dict[str, list[dict]]) -> list[dict]:
        """Every order this store holds for the same phone number."""
        if phone in cache:
            return cache[phone]
        found = self._paged("/orders", {"search": phone, "status": "any"})
        # A search matches substrings in any field. Only an exact phone match
        # is this customer; a partial one is somebody else.
        same = [
            o for o in found
            if international(str((o.get("billing") or {}).get("phone") or ""),
                             self.config.calling_code) == phone
        ]
        cache[phone] = same
        return same

    # --- writing --------------------------------------------------------

    def write_back(self, orders: list[Order]) -> int:
        """Record what this sweep decided. Returns how many orders changed."""
        changed = 0
        for order in orders:
            seen = self._seen.get(order.id)
            if seen is None:
                continue
            # An order the sweep only looked at, such as one it decided was
            # not worth a call, is left alone. Writing "not called" onto it on
            # every run would bury the notes that matter under ones that do not.
            if (order.status, order.attempts) == (seen.status, seen.attempts):
                continue

            notes = list(order.notes[seen.notes:])
            if order.address != seen.address:
                # The customer gave a different address on the call. It is
                # passed on for a person to apply, not written over the order's
                # own: a misheard street is a parcel sent somewhere else.
                notes.append(
                    f"The customer gave a corrected delivery address on the call: "
                    f"{order.address}. The order's own address has not been changed."
                )

            for note in notes:
                self._request("POST", f"/orders/{order.id}/notes", body={
                    "note": NOTE_PREFIX + phones.scrub(note, limit=2000),
                    "customer_note": False,
                })
            self._request("PUT", f"/orders/{order.id}", body={"meta_data": [
                {"key": META_STATUS, "value": order.status},
                {"key": META_ATTEMPTS, "value": str(order.attempts)},
            ]})
            self._seen[order.id] = _Seen(order.status, order.attempts,
                                         len(order.notes), order.address)
            changed += 1
        return changed


def international(raw: str, calling_code: str) -> str:
    """A stored phone number in E.164 form, if it can be had without guessing.

    Formatting is removed. A local number starting with 0 gains the country
    code only when the shop has said which country that is. Anything else is
    returned as it was, to be refused by `phones.normalise` downstream.
    """
    stripped = re.sub(r"[ ()\-.]", "", raw.strip())
    if stripped.startswith("+"):
        return stripped
    # 00 is the international prefix, but only when a real country code
    # follows it. Country codes never start with 0, so 000... is a local
    # number and is left to the rule below.
    if stripped[:2] == "00" and stripped[2:3] not in ("", "0") and stripped[2:].isdigit():
        return "+" + stripped[2:]
    if calling_code and stripped.isdigit():
        if stripped.startswith(calling_code):
            return "+" + stripped
        if stripped.startswith("0"):
            return "+" + calling_code + stripped[1:]
    return raw.strip()


def plain(value) -> str:
    """Text a person can read on a call: no tags, no entities, one line."""
    if not value:
        return ""
    return SPACE.sub(" ", html.unescape(TAGS.sub(" ", str(value)))).strip()


def money(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def store() -> WooStore:
    return WooStore(WooConfig.from_env())
