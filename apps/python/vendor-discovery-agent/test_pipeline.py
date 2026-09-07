"""Smoke test — validates all pipeline components without placing real calls."""
import json
from datetime import datetime, timezone
from models import init_db, get_conn, Campaign, Lead, _mask_phone
from business_hours import is_business_hours, business_hours_reason
from caller import classify_round1, parse_transcript_to_json, infer_from_transcript

init_db()

# 1. Campaign + Lead save/load
with get_conn() as conn:
    campaign = Campaign(
        product_description="test shoes",
        location="London, UK",
        consent_basis="client-reviewed-and-approved",
        consent_approved_at=datetime.now(timezone.utc).isoformat(),
    )
    campaign.save(conn)
    cid = campaign.id
    assert cid is not None, "campaign.id should be set after save"

    lead = Lead(
        phone="+441234567890",
        campaign_id=cid,
        name="Test Shoe Shop",
        category="shoes",
        lat=51.39,
        lon=-0.30,
        osm_id="osm_test_123",
        candidate_id="osm:osm_test_123",
    )
    lead.save(conn)
    assert lead.id is not None, "lead.id should be set after save"
    assert lead.masked_phone == "+44****890", f"got: {lead.masked_phone}"
    conn.commit()

    rows = conn.execute(
        "SELECT l.name, l.phone, l.masked_phone, l.category, l.status, cl.extracted_fields "
        "FROM leads l LEFT JOIN call_logs cl ON cl.lead_id = l.id AND cl.round = 2 "
        "WHERE l.campaign_id = ? ORDER BY l.id", (cid,)
    ).fetchall()
    for r in rows:
        masked = r["masked_phone"] or _mask_phone(r["phone"])
        print(f"  Lead row: {r['name']} | {masked} | {r['status']}")

print("1. Campaign/Lead/DB: PASS")

# 2. Business hours gate
bh = is_business_hours(lat=51.39, lon=-0.30)
reason = business_hours_reason(lat=51.39, lon=-0.30)
print(f"2. Business hours (London): is_open={bh} | {reason}")
assert "Europe/London" in reason, f"Expected Europe/London in: {reason}"

# 3. classify_round1 status normalization
for status_str, expected in [
    ("NO ANSWER", "no_answer"),
    ("NO_ANSWER", "no_answer"),
    ("DECLINED", "no_answer"),
    ("BUSY", "no_answer"),
    ("FAILED", "failed"),
]:
    result = classify_round1({"status": status_str})
    assert result == expected, f"classify_round1({status_str!r}) = {result!r}, expected {expected!r}"
print("3. classify_round1 normalization: PASS")

# 4. Transcript parsing
mock_status = {
    "result": {
        "transcript": (
            "[00:00:05] AGENT: Hello, am I speaking with the manager?\n"
            "[00:00:08] VENDOR: Yes, this is Sarah.\n"
            "[00:00:10] AGENT: We are looking for leather shoes."
        )
    }
}
lines = parse_transcript_to_json(mock_status)
assert len(lines) == 3, f"expected 3 lines, got {len(lines)}"
assert lines[0]["speaker"] == "AGENT"
assert lines[1]["speaker"] == "VENDOR"
print("4. parse_transcript_to_json: PASS")

# 5. Groq inference R1
inference = infer_from_transcript(lines, "leather shoes", round_num=1)
if "error" in inference:
    print(f"5. Groq inference: SKIPPED ({inference['error']})")
else:
    assert "interest_level" in inference, f"missing interest_level: {inference}"
    print(f"5. Groq inference R1: PASS | interest={inference.get('interest_level')} | {inference.get('summary','')[:60]}")

print("\nAll smoke tests passed.")
