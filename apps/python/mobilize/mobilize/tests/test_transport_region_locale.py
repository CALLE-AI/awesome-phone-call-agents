"""CalleTransport previously hardcoded one region/locale for every dispatch
at the transport-instance level, which is wrong for a registry with
recipients in more than one country -- exactly this project's own
Kolkata-based sample registry against a transport defaulting to "US"."""

from __future__ import annotations

from mobilize.core.types import Candidate


def _candidate(region=None, locale=None) -> Candidate:
    return Candidate(
        id="c1", phone="+15550101234", name="X", days_since_last_action=90,
        distance_km=1, historical_accept_rate=0.5, historical_showup_rate=0.5,
        region=region, locale=locale,
    )


def test_candidate_region_overrides_transport_default(monkeypatch):
    captured = {}

    class _FakeClient:
        def __init__(self, **kw):
            pass

        async def post(self, path, json, headers):
            captured["region"] = json["recipients"][0]["region"]
            captured["locale"] = json["recipients"][0]["locale"]

            class _Resp:
                def raise_for_status(self):
                    pass

                def json(self):
                    return {"id": "call_1"}

            return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setenv("CALLE_API_KEY", "test_key")

    import asyncio

    from mobilize.transports.calle import CalleTransport

    async def main():
        transport = CalleTransport(region="US", locale="en-US")
        candidate = _candidate(region="IN", locale="en-IN")
        await transport.dispatch(candidate, "need", "loc", idempotency_key="k1")

    asyncio.run(main())

    assert captured["region"] == "IN"
    assert captured["locale"] == "en-IN"


def test_candidate_without_region_falls_back_to_transport_default(monkeypatch):
    captured = {}

    class _FakeClient:
        def __init__(self, **kw):
            pass

        async def post(self, path, json, headers):
            captured["region"] = json["recipients"][0]["region"]
            captured["locale"] = json["recipients"][0]["locale"]

            class _Resp:
                def raise_for_status(self):
                    pass

                def json(self):
                    return {"id": "call_1"}

            return _Resp()

    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setenv("CALLE_API_KEY", "test_key")

    import asyncio

    from mobilize.transports.calle import CalleTransport

    async def main():
        transport = CalleTransport(region="US", locale="en-US")
        candidate = _candidate()  # no region/locale override
        await transport.dispatch(candidate, "need", "loc", idempotency_key="k1")

    asyncio.run(main())

    assert captured["region"] == "US"
    assert captured["locale"] == "en-US"
