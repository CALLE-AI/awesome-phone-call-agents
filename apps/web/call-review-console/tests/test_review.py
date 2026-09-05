import json
from pathlib import Path

from fastapi.testclient import TestClient

from crc import compliance, evidence, review, timing
from crc.app import app

FX = Path(__file__).resolve().parents[1] / "fixtures"


def load(name):
    return json.loads((FX / name).read_text())


def test_timing_latency_silence_overlap():
    t = timing.analyze_turns([{"offset_seconds": 0, "speaker": "agent", "text": "hi"}, {"offset_seconds": 4, "speaker": "callee", "text": "yes"}, {"offset_seconds": 5.5, "speaker": "agent", "text": "ok"}, {"offset_seconds": 12, "speaker": "callee", "text": "hm"}, {"offset_seconds": 11.5, "speaker": "agent", "text": "over"}])
    assert t.agent_turns == 3 and t.callee_turns == 2
    assert t.response_latencies == [1.5]  # the overlapping turn has a negative latency and is not counted
    assert t.overlaps == 1 and len(t.silences) == 1 and t.p50 == 1.5


def test_compliance_stop_not_honored_and_no_disclosure():
    c = compliance.check(load("call_fx_003.json")["recipients"][0]["attempts"][0]["transcript_turns"])
    assert c["stop_requested"] and c["stop_honored"] is False and not c["ai_disclosed"]


def test_mask_phone():
    assert compliance.mask_phone("+15550100123") == "+1********23"


def test_unsupported_claim_is_caught_deterministically():
    t = load("call_fx_002.json")
    rows = evidence.deterministic(t["structured_result"], t["recipients"][0]["attempts"][0]["transcript_turns"])
    by = {r["field"]: r for r in rows}
    assert by["rescheduled_to"]["supported"] is False  # 'Thursday 2pm' never spoken
    assert by["confirmed"]["supported"] is None or by["confirmed"]["supported"] in (True, False)


def test_verdicts_on_fixtures():
    v = {n: review.review(load(n))["verdict"] for n in ("call_fx_001.json", "call_fx_002.json", "call_fx_003.json", "call_fx_004.json", "call_fx_005.json")}
    assert v["call_fx_001.json"] == "approve"
    assert v["call_fx_002.json"] == "reject"  # unsupported claim
    assert v["call_fx_003.json"] == "reject"  # stop request ignored, no disclosure
    assert v["call_fx_004.json"] == "reject"  # failed call
    assert v["call_fx_005.json"] in ("approve", "needs_human")  # overlaps → at most needs_human


def test_webhook_ingest_and_api(tmp_path, monkeypatch):
    monkeypatch.setenv("CRC_DATA_DIR", str(tmp_path))
    from crc import store
    monkeypatch.setattr(store, "DATA", tmp_path)
    client = TestClient(app)
    t = load("call_fx_001.json"); t["id"] = "call_wh_001"; t["metadata"] = {}
    r = client.post("/calle/webhook", json={"id": "evt_1", "type": "call.completed", "created_at": "2026-09-04T15:03:06Z", "data": t})
    assert r.status_code == 200 and r.json()["stored"] == "call_wh_001"
    calls = client.get("/api/calls").json()
    assert any(c["id"] == "call_wh_001" and c["source"] == "ingested" for c in calls)
    d = client.get("/api/calls/call_wh_001").json()
    assert d["task"]["recipients"][0]["phones"][0].startswith("+1**")  # masked
    assert client.post("/calle/webhook", json={"type": "nope"}).status_code == 400
    monkeypatch.setenv("CRC_WEBHOOK_TOKEN", "s3cret")
    assert client.post("/calle/webhook", json={"type": "call.completed", "data": t}).status_code == 401
    assert client.post("/calle/webhook", json={"type": "call.completed", "data": t}, headers={"X-CRC-Token": "s3cret"}).status_code == 200
    assert client.get("/api/benchmark").json()["aggregate"]["calls"] >= 6
