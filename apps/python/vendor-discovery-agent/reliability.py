"""
Vendor reliability scoring from existing call_logs + scheduled_calls data.
No new DB columns — pure computation from what's already stored.
"""
from models import get_conn


def compute_all_reliability(conn, campaign_id: int = None) -> dict:
    """
    Returns a dict mapping lead_id -> reliability dict.
    If campaign_id given, only compute for leads in that campaign.
    Efficient: uses two aggregate queries, not N+1.
    """
    where = "WHERE l.campaign_id = ?" if campaign_id else ""
    params = (campaign_id,) if campaign_id else ()

    # Aggregate call_log attempts and answered counts per lead
    logs = conn.execute(
        f"""SELECT cl.lead_id,
                   COUNT(*) AS attempts,
                   SUM(CASE WHEN cl.extracted_fields IS NOT NULL THEN 1 ELSE 0 END) AS answered
            FROM call_logs cl
            JOIN leads l ON l.id = cl.lead_id
            {where}
            GROUP BY cl.lead_id""",
        params
    ).fetchall()

    # Aggregate scheduled callbacks: fired = vendor kept the callback, missed = fired but no R2 log
    sched = conn.execute(
        f"""SELECT sc.lead_id,
                   SUM(CASE WHEN sc.status = 'fired' THEN 1 ELSE 0 END) AS kept,
                   SUM(CASE WHEN sc.status IN ('fired','skipped','failed') THEN 1 ELSE 0 END) AS scheduled_total
            FROM scheduled_calls sc
            JOIN leads l ON l.id = sc.lead_id
            {where}
            GROUP BY sc.lead_id""",
        params
    ).fetchall()

    logs_map  = {r["lead_id"]: r for r in logs}
    sched_map = {r["lead_id"]: r for r in sched}
    all_ids   = set(logs_map) | set(sched_map)

    result = {}
    for lid in all_ids:
        log_row   = logs_map.get(lid)
        sched_row = sched_map.get(lid)

        attempts = log_row["attempts"] if log_row else 0
        answered = log_row["answered"] if log_row else 0
        answer_rate = (answered / attempts) if attempts > 0 else 0.0

        callback_kept = None
        if sched_row and sched_row["scheduled_total"] > 0:
            callback_kept = sched_row["kept"] > 0

        score = _badge(answer_rate, callback_kept)
        result[lid] = {
            "attempts": attempts,
            "answered": answered,
            "answer_rate": round(answer_rate, 2),
            "callback_kept": callback_kept,
            "score": score,
        }
    return result


def compute_reliability(conn, lead_id: int) -> dict:
    """Compute reliability for a single lead."""
    all_rel = compute_all_reliability(conn)
    return all_rel.get(lead_id, {
        "attempts": 0, "answered": 0,
        "answer_rate": 0.0, "callback_kept": None, "score": "grey"
    })


def _badge(answer_rate: float, callback_kept) -> str:
    if answer_rate >= 0.66 and callback_kept is not False:
        return "green"
    if answer_rate < 0.33 or callback_kept is False:
        return "red"
    return "amber"
