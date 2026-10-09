"""A live WooCommerce store, played by a fake one.

The fake speaks the parts of the WooCommerce REST API the connector uses and
records every write, so what is tested is the real HTTP path: auth, paging,
the order and history queries, and exactly what lands back in the store.
Every order in it is fictional, on country code 999. Nothing here touches a
network or a real shop.
"""
from __future__ import annotations

import datetime as dt
import json
import socket
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from codconfirm import agent, orders, run as sweeper, woo

KEY, SECRET = "ck_test", "cs_test"
NOW = dt.datetime(2026, 9, 11, 12, 0, tzinfo=dt.timezone.utc)


def row(order_id, first, phone, *, status="processing", method="cod", total="3450.00",
        shipping="80.00", city="Dhaka", items=("Hand-block cotton bedsheet",), meta=None):
    address = {"first_name": first, "last_name": "Example", "address_1": f"{order_id} Example Road",
               "address_2": "", "city": city, "postcode": "1205", "phone": phone}
    return {
        "id": order_id, "status": status, "payment_method": method, "total": total,
        "shipping_total": shipping, "billing": address, "shipping": dict(address),
        "line_items": [{"name": name, "quantity": 1} for name in items],
        "meta_data": [{"key": k, "value": v} for k, v in (meta or {}).items()],
    }


class FakeStore:
    """The orders a shop holds, and a log of everything written to it."""

    def __init__(self, rows):
        self.rows = rows
        self.notes: list[tuple[int, str]] = []
        self.meta: dict[int, dict] = {}
        self.puts: list[dict] = []
        self.queries: list[dict] = []
        self.fail_writes = False
        self.drop_writes = False

    def handler(self):
        store = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def _authorised(self):
                import base64
                expected = "Basic " + base64.b64encode(f"{KEY}:{SECRET}".encode()).decode()
                if self.headers.get("Authorization") != expected:
                    self._send(401, {"code": "woocommerce_rest_cannot_view"})
                    return False
                return True

            def _send(self, code, body):
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _body(self):
                length = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(length) or b"{}")

            def do_GET(self):
                if not self._authorised():
                    return
                url = urllib.parse.urlparse(self.path)
                query = dict(urllib.parse.parse_qsl(url.query))
                store.queries.append(query)
                if query.get("page", "1") != "1":
                    return self._send(200, [])
                if "search" in query:
                    hits = [r for r in store.rows if query["search"] in r["billing"]["phone"]]
                    return self._send(200, hits)
                wanted = query.get("status", "").split(",")
                return self._send(200, [r for r in store.rows if r["status"] in wanted])

            def _refuse_write(self):
                """Answer a write the way a failing store would, if asked to."""
                if store.drop_writes:
                    # The connection simply goes away, with no HTTP answer at all.
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return True
                if store.fail_writes:
                    self._send(500, {"code": "internal"})
                    return True
                return False

            def do_POST(self):
                if not self._authorised():
                    return
                body = self._body()
                if self._refuse_write():
                    return
                order_id = int(self.path.split("/orders/")[1].split("/")[0])
                store.notes.append((order_id, body["note"]))
                self._send(201, {"id": len(store.notes)})

            def do_PUT(self):
                if not self._authorised():
                    return
                body = self._body()
                if self._refuse_write():
                    return
                order_id = int(self.path.rsplit("/", 1)[1])
                store.puts.append(body)
                for item in body["meta_data"]:
                    store.meta.setdefault(order_id, {})[item["key"]] = item["value"]
                self._send(200, {"id": order_id})

        return Handler


@pytest.fixture
def shop(monkeypatch):
    """A running fake store, and the environment that points the sweep at it."""
    fake = FakeStore([
        # Refused twice before, and out of the shop's own city.
        row(282, "Shahriar", "+99900000044", total="9800.00", shipping="150.00",
            city="Chattogram", items=("Brass table lamp",)),
        row(274, "Shahriar", "+99900000044", status="failed"),
        row(273, "Shahriar", "+99900000044", status="failed"),
        # A loyal customer.
        row(285, "Rumana", "+99900000041"),
        row(271, "Rumana", "+99900000041", status="completed"),
        row(270, "Rumana", "+99900000041", status="completed"),
        # Paid up front: nothing to confirm.
        row(287, "Tanvir", "+99900000042", method="bacs"),
    ])
    server = ThreadingHTTPServer(("127.0.0.1", 0), fake.handler())
    threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05},
                     daemon=True).start()

    monkeypatch.setenv("STORE_SOURCE", "woocommerce")
    monkeypatch.setenv("WOO_BASE_URL", f"http://127.0.0.1:{server.server_address[1]}")
    monkeypatch.setenv("WOO_KEY", KEY)
    monkeypatch.setenv("WOO_SECRET", SECRET)
    monkeypatch.setenv("STORE_CITY", "Dhaka")
    for name in ("WOO_DEFAULT_CALLING_CODE", "CALL_ALLOWLIST", "DEMO_PHONE", "CALLE_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    yield fake
    server.shutdown()
    server.server_close()


def load(**overrides):
    store = woo.store()
    return store, {o.id: o for o in store.load(now=NOW)}


# --- reading ---------------------------------------------------------------

def test_only_cash_on_delivery_orders_are_read(shop):
    _, found = load()
    assert set(found) == {"282", "285"}, "the prepaid order has nothing waiting at the door"


def test_risk_comes_from_the_shops_own_history(shop):
    _, found = load()
    assert found["282"].previous_refusals == 2
    assert found["282"].previous_orders == 0
    assert found["285"].previous_orders == 2
    assert found["285"].previous_refusals == 0


def test_an_order_outside_the_shops_city_is_marked(shop):
    _, found = load()
    assert found["282"].outside_home_city is True
    assert found["285"].outside_home_city is False


def test_only_recent_orders_are_asked_for(shop, monkeypatch):
    monkeypatch.setenv("WOO_LOOKBACK_DAYS", "3")
    load()
    first = shop.queries[0]
    assert first["after"] == "2026-09-08T12:00:00"
    assert first["status"] == "processing,on-hold"


def test_a_decided_order_is_never_picked_up_again(shop):
    """Ambiguous means a person reconciles it, across runs as well as within one."""
    shop.rows.append(row(290, "Farhana", "+99900000045",
                         meta={woo.META_STATUS: orders.NEEDS_HUMAN, woo.META_ATTEMPTS: "1"}))
    _, found = load()
    assert found["290"].status == orders.NEEDS_HUMAN
    assert found["290"] not in orders.pending(found.values())


def test_a_local_number_is_not_guessed_at(shop):
    shop.rows.append(row(291, "Nusrat", "0999 000 0043"))
    _, found = load()
    assert found["291"].status == orders.NEEDS_HUMAN
    assert "international form" in found["291"].notes[0]


def test_a_local_number_gains_the_country_code_the_shop_names(shop, monkeypatch):
    monkeypatch.setenv("WOO_DEFAULT_CALLING_CODE", "999")
    shop.rows.append(row(291, "Nusrat", "0000 000 043"))
    _, found = load()
    assert found["291"].phone == "+999000000043"
    assert found["291"].status == orders.PENDING


def test_free_shipping_is_not_free_to_the_shop(shop):
    shop.rows.append(row(292, "Nadia", "+99900000046", shipping="0.00"))
    _, found = load()
    assert found["292"].shipping_cost == 70.0


def test_markup_in_a_store_payload_is_not_read_out(shop):
    shop.rows.append(row(293, "Nadia", "+99900000047",
                         items=("<strong>Jute</strong> rug &amp; mat",)))
    _, found = load()
    assert found["293"].items == ["Jute rug & mat"]


def test_a_partial_phone_match_is_somebody_else(shop):
    """A search for one number matches others that contain it. Only exact counts."""
    shop.rows.append(row(275, "Other", "+999000000441", status="failed"))
    _, found = load()
    assert found["282"].previous_refusals == 2


def test_the_cut_off_is_sent_as_utc(shop):
    load()
    assert shop.queries[0]["dates_are_gmt"] == "true"


def test_a_garbled_attempt_count_is_not_read_as_zero(shop):
    """Zero would hand the customer a fresh set of calls."""
    shop.rows.append(row(294, "Nadia", "+99900000048", meta={woo.META_ATTEMPTS: "two"}))
    _, found = load()
    assert found["294"].status == orders.NEEDS_HUMAN


def test_a_store_that_never_stops_paging_is_cut_off(shop, monkeypatch):
    monkeypatch.setattr(woo, "MAX_PAGES", 2)
    store = woo.store()
    monkeypatch.setattr(store, "_request", lambda *a, **k: [{"id": 1}] * 100)
    with pytest.raises(woo.WooError, match="more than 200 orders"):
        store.load(now=NOW)


def test_the_key_is_never_sent_in_the_clear(monkeypatch):
    monkeypatch.setenv("WOO_BASE_URL", "http://shop.example")
    monkeypatch.setenv("WOO_KEY", KEY)
    monkeypatch.setenv("WOO_SECRET", SECRET)
    with pytest.raises(woo.WooError, match="https"):
        woo.WooConfig.from_env()


def test_a_wrong_key_is_a_clear_error_not_a_crash(shop, monkeypatch):
    monkeypatch.setenv("WOO_SECRET", "cs_wrong")
    with pytest.raises(woo.WooError, match="401"):
        load()


# --- writing -----------------------------------------------------------------

def answer(monkeypatch, outcome):
    monkeypatch.setattr(sweeper, "simulate_call", lambda order, seed=None: outcome)


def confirmed():
    return agent.CallOutcome(result={
        "reached_customer": "yes", "confirmed": "yes", "address_correct": "yes",
        "confirmation_quote": "yes send it"})


def test_a_dry_run_writes_nothing_to_the_store(shop, monkeypatch):
    answer(monkeypatch, confirmed())
    sweeper.sweep(live=False)
    assert shop.notes == [] and shop.meta == {}


def test_a_called_order_gets_a_note_and_its_status(shop, monkeypatch):
    store = woo.store()
    found = {o.id: o for o in store.load(now=NOW)}
    order = found["282"]
    order.attempts += 1
    order.status = orders.CONFIRMED
    order.log('Confirmed, address unchanged. Said "yes send it".')

    assert store.write_back([order]) == 1
    assert shop.meta[282] == {woo.META_STATUS: orders.CONFIRMED, woo.META_ATTEMPTS: "1"}
    assert shop.notes == [(282, 'COD Confirm: Confirmed, address unchanged. Said "yes send it".')]


def test_an_order_only_looked_at_is_left_alone(shop):
    """A "not worth calling" note on every run would bury the ones that matter."""
    store = woo.store()
    found = {o.id: o for o in store.load(now=NOW)}
    found["285"].log("Not called: the call costs more than the refusal risk it removes.")
    assert store.write_back(list(found.values())) == 0
    assert shop.notes == []


def test_a_result_is_written_once_not_on_every_save(shop):
    store = woo.store()
    order = {o.id: o for o in store.load(now=NOW)}["282"]
    order.attempts, order.status = 1, orders.CONFIRMED
    order.log("Confirmed.")
    store.write_back([order])
    store.write_back([order])
    assert len(shop.notes) == 1


def test_a_corrected_address_is_passed_on_not_applied(shop):
    store = woo.store()
    order = {o.id: o for o in store.load(now=NOW)}["282"]
    order.attempts, order.status = 1, orders.CONFIRMED
    order.address = "Flat 3B, 282 Example Road, Chattogram"
    store.write_back([order])
    assert any("corrected delivery address" in note for _, note in shop.notes)
    assert all(set(body) == {"meta_data"} for body in shop.puts), (
        "the order's own address is for a person to change, not the sweep"
    )


def test_a_bad_phone_is_recorded_on_a_live_run(shop, monkeypatch):
    """Sent to a person while reading, so it has to reach the store too."""
    shop.rows.append(row(291, "Nusrat", "0999 000 0043"))
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000044,+99900000041")
    monkeypatch.setattr(sweeper, "place_call", lambda *a, **k: confirmed())
    sweeper.sweep(live=True)
    assert shop.meta[291][woo.META_STATUS] == orders.NEEDS_HUMAN


def test_a_failed_write_stops_the_sweep_and_names_the_order(shop, monkeypatch):
    """Otherwise the next sweep would ring a called customer again."""
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000044,+99900000041")
    monkeypatch.setattr(sweeper, "place_call", lambda *a, **k: confirmed())
    shop.fail_writes = True
    with pytest.raises(SystemExit) as stopped:
        sweeper.sweep(live=True, limit=1)
    assert "was called but its result could not be written back" in str(stopped.value)


def test_a_dropped_connection_on_a_write_stops_the_sweep_too(shop, monkeypatch):
    """A store that simply goes away mid-write is the same danger as a 500."""
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000044,+99900000041")
    monkeypatch.setattr(sweeper, "place_call", lambda *a, **k: confirmed())
    shop.drop_writes = True
    with pytest.raises(SystemExit) as stopped:
        sweeper.sweep(live=True, limit=1)
    assert "was called but its result could not be written back" in str(stopped.value)


def test_reset_refuses_to_touch_a_live_store(shop, monkeypatch):
    monkeypatch.setattr("sys.argv", ["run", "--reset"])
    with pytest.raises(SystemExit, match="live store"):
        sweeper.main()
