"""
Vendor Discovery & Outreach - main orchestrator.
Usage:
  python main.py --product "office chairs" --location "Berlin, Germany"
  python main.py --product "hardware supplies" --location "London" --limit 10 --dry-run
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from models import init_db, get_conn, Lead, Campaign, _mask_phone
from discovery import discover_vendors, _looks_spam
from script_gen import generate_goal, prompt_client_approval
from caller import (execute_call_pipeline, classify_round1, extract_round2_fields,
                    parse_transcript_to_json, infer_from_transcript)
from scheduler import schedule_followup

ATTRIBUTION = "Data (c) OpenStreetMap contributors (ODbL) - openstreetmap.org/copyright"


def save_lead(conn, vendor: dict, campaign_id: int) -> Lead:
    osm_id = vendor.get("osm_id")
    lead = Lead(
        phone=vendor["phone"],
        campaign_id=campaign_id,
        name=vendor.get("name"),
        category=vendor.get("category"),
        lat=vendor.get("lat"),
        lon=vendor.get("lon"),
        osm_id=osm_id,
        candidate_id=f"osm:{osm_id}" if osm_id else None,
        address=vendor.get("address"),
    )
    lead.save(conn)
    return lead


def update_lead_status(conn, lead_id: int, status: str, call_id: str = None, round_num: int = 1):
    if round_num == 1:
        conn.execute("UPDATE leads SET status=?, round1_call_id=? WHERE id=?",
                     (status, call_id, lead_id))
    else:
        conn.execute("UPDATE leads SET status=?, round2_call_id=? WHERE id=?",
                     (status, call_id, lead_id))
    conn.commit()


def log_call(conn, lead_id: int, call_id: str, round_num: int,
             raw_output: dict, extracted: dict = None):
    conn.execute(
        """INSERT INTO call_logs (lead_id, call_id, round, raw_status_output, extracted_fields)
           VALUES (?,?,?,?,?)""",
        (lead_id, call_id, round_num,
         json.dumps(raw_output), json.dumps(extracted) if extracted else None)
    )
    conn.commit()


def print_results_table(conn, campaign_id: int):
    rows = conn.execute(
        """SELECT l.name, l.phone, l.masked_phone, l.category, l.status,
                  cl.extracted_fields
           FROM leads l
           LEFT JOIN call_logs cl ON cl.lead_id = l.id AND cl.round = 2
           WHERE l.campaign_id = ?
           ORDER BY l.id""",
        (campaign_id,)
    ).fetchall()

    print(f"\n{'='*80}")
    print(f"{'NAME':<25} {'PHONE':<18} {'CATEGORY':<15} {'STATUS':<15} NOTES")
    print(f"{'='*80}")
    for r in rows:
        notes = ""
        if r["extracted_fields"]:
            ef = json.loads(r["extracted_fields"])
            notes = (ef.get("summary") or ef.get("transcript_summary") or str(ef))[:50]
        masked = r["masked_phone"] or _mask_phone(r["phone"])
        print(f"{(r['name'] or '')[:24]:<25} {masked:<18} {(r['category'] or '')[:14]:<15} {r['status']:<15} {notes}")
    print(f"{'='*80}")
    print(f"\n{ATTRIBUTION}")


EXPORT_HEADERS = ["ID", "Name", "Phone (masked)", "Category", "Status",
                  "Interest", "Can Supply", "Price Range", "Timeline",
                  "Contact Name", "Next Steps", "Summary", "Candidate ID"]


def _gather_export_rows(conn, campaign_id: int):
    """Return sqlite rows for a campaign, joining the latest round-1/round-2 call log per lead."""
    return conn.execute(
        """SELECT l.id, l.name, l.masked_phone, l.phone, l.category, l.status,
                  l.candidate_id, l.osm_id, l.skip_reason,
                  c.goal_script,
                  r2log.extracted_fields AS r2_fields,
                  r1log.extracted_fields AS r1_fields
           FROM leads l
           JOIN campaigns c ON c.id = l.campaign_id
           LEFT JOIN (
               SELECT lead_id, extracted_fields FROM call_logs
               WHERE id IN (SELECT MAX(id) FROM call_logs WHERE round=1 GROUP BY lead_id)
           ) r1log ON r1log.lead_id=l.id
           LEFT JOIN (
               SELECT lead_id, extracted_fields FROM call_logs
               WHERE id IN (SELECT MAX(id) FROM call_logs WHERE round=2 GROUP BY lead_id)
           ) r2log ON r2log.lead_id=l.id
           WHERE l.campaign_id = ?
           ORDER BY l.id""",
        (campaign_id,)
    ).fetchall()


def _export_row_to_dict(r) -> dict:
    r2 = json.loads(r["r2_fields"]) if r["r2_fields"] else {}
    r1 = json.loads(r["r1_fields"]) if r["r1_fields"] else {}
    summary = r2.get("summary") or r1.get("summary") or ""
    masked = r["masked_phone"] or _mask_phone(r["phone"])
    values = [
        r["id"], r["name"] or "", masked, r["category"] or "", r["status"],
        r1.get("interest_level", ""), r2.get("can_supply", ""),
        r2.get("price_range", ""), r2.get("timeline", ""),
        r2.get("contact_name", ""), r2.get("next_steps", ""),
        summary, r["candidate_id"] or "",
    ]
    row = dict(zip(EXPORT_HEADERS, values))
    # generated-skill-contract.md candidate schema — kept alongside the
    # human-readable columns above rather than replacing them.
    row.update({
        "candidateId": r["candidate_id"] or r["osm_id"] or "",
        "phoneNumber": r["phone"],
        "maskedPhoneNumber": masked,
        "recipientLabel": r["name"] or "",
        "outboundGoal": r["goal_script"] or "",
        "status": r["status"],
        "skipReason": r["skip_reason"] or "",
    })
    return row


def export_excel(campaign_id: int, path: str):
    import openpyxl
    from openpyxl.styles import PatternFill, Font
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Leads"
    headers = EXPORT_HEADERS
    header_fill = PatternFill("solid", fgColor="1F4E79")
    header_font = Font(color="FFFFFF", bold=True)
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col, value=h)
        cell.fill = header_fill
        cell.font = header_font

    with get_conn() as conn:
        rows = _gather_export_rows(conn, campaign_id)

    for row_num, r in enumerate(rows, 2):
        ws.append([_export_row_to_dict(r)[h] for h in EXPORT_HEADERS])

    ws.column_dimensions["B"].width = 28
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["L"].width = 40
    wb.save(path)
    print(f"\nExported {len(rows)} leads to {path}")


def export_csv(campaign_id: int, path: str):
    """Export campaign results to CSV."""
    import csv
    with get_conn() as conn:
        rows = _gather_export_rows(conn, campaign_id)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=EXPORT_HEADERS, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            writer.writerow(_export_row_to_dict(r))
    print(f"\nExported {len(rows)} leads to {path}")


def export_json(campaign_id: int, path: str):
    """Export campaign results to JSON."""
    with get_conn() as conn:
        rows = _gather_export_rows(conn, campaign_id)
    data = [_export_row_to_dict(r) for r in rows]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\nExported {len(rows)} leads to {path}")


def _run_exports(campaign_id, export=None, export_csv_path=None, export_json_path=None):
    if export:
        export_excel(campaign_id, export)
    if export_csv_path:
        export_csv(campaign_id, export_csv_path)
    if export_json_path:
        export_json(campaign_id, export_json_path)


def _call_generate_goal(product, round_num, persona_name, persona_tone):
    """Call generate_goal, passing persona kwargs only if its signature accepts them."""
    import inspect
    kwargs = {}
    try:
        params = inspect.signature(generate_goal).parameters
        if "persona_name" in params:
            kwargs["persona_name"] = persona_name
        if "persona_tone" in params:
            kwargs["persona_tone"] = persona_tone
    except (TypeError, ValueError):
        pass
    return generate_goal(product, round_num=round_num, **kwargs)


def run_campaign(product: str, location: str, limit: int,
                 region: str, language: str, dry_run: bool, yes: bool = False,
                 export: str = None, skip_hours_gate: bool = False,
                 export_csv_path: str = None, export_json_path: str = None,
                 persona_name: str = None, persona_tone: str = "professional",
                 template_goal: str = None, save_template_name: str = None):
    init_db()

    print(f"\nVendor Discovery & Outreach")
    print(f"Product : {product}")
    print(f"Location: {location}")
    print(f"{'[DRY RUN] ' if dry_run else ''}Discovering vendors via OpenStreetMap...")

    vendors = discover_vendors(product, location, limit)
    if not vendors:
        print("No vendors with phone numbers found. Try a different location or product keyword.")
        sys.exit(1)

    print(f"Found {len(vendors)} vendor(s) with phone numbers.\n")
    for i, v in enumerate(vendors, 1):
        masked = _mask_phone(v["phone"])
        print(f"  {i:>2}. {v['name'][:40]:<40} {masked}  ({v['category']})")

    print(f"\n{ATTRIBUTION}")

    if yes:
        print(f"\nAuto-confirming {len(vendors)} vendors (--yes flag).")
        consent_approved_at = datetime.now(timezone.utc).isoformat()
    else:
        confirm = input(f"\nProceed with these {len(vendors)} vendors? [y/N]: ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            sys.exit(0)
        consent_approved_at = datetime.now(timezone.utc).isoformat()

    with get_conn() as conn:
        campaign = Campaign(
            product_description=product,
            location=location,
            consent_basis="client-reviewed-and-approved",
            consent_approved_at=consent_approved_at,
        )
        campaign.save(conn)
        campaign_id = campaign.id
        conn.commit()

        conn.execute(
            "UPDATE campaigns SET persona_name=?, persona_tone=? WHERE id=?",
            (persona_name, persona_tone, campaign_id)
        )
        conn.commit()

        leads = []
        for v in vendors:
            if _looks_spam(v["phone"]):
                print(f"  [Skip] {_mask_phone(v['phone'])} — spam/invalid number")
                continue
            dup = conn.execute("SELECT id FROM leads WHERE phone=?", (v["phone"],)).fetchone()
            if dup:
                print(f"  [Skip] {_mask_phone(v['phone'])} — already in DB (lead {dup['id']})")
                continue
            leads.append(save_lead(conn, v, campaign_id))

    # Score and sort leads by quality before calling
    try:
        from scoring import score_lead
        with get_conn() as conn:
            for lead in leads:
                v = next((x for x in vendors if x.get("phone") == lead.phone), {})
                score, reasons = score_lead(v)
                lead.lead_score = score
                conn.execute(
                    "UPDATE leads SET lead_score=?, score_reasons=? WHERE id=?",
                    (score, json.dumps(reasons), lead.id)
                )
            conn.commit()
        leads.sort(key=lambda l: getattr(l, 'lead_score', 0), reverse=True)
        print(f"  [Scoring] Leads prioritised by quality score.")
    except ImportError:
        pass  # scoring.py not yet present; harmless

    if not leads:
        print("\nAll discovered vendors were skipped (spam or already in DB).")
        return

    # Generate and get approval for round-1 script
    if template_goal:
        r1_goal = template_goal
        print(f"  [Template] Using saved goal script.")
    else:
        r1_goal = _call_generate_goal(product, round_num=1, persona_name=persona_name, persona_tone=persona_tone)
        r1_goal = r1_goal if yes else prompt_client_approval(r1_goal, round_num=1)

    # Save the approved R1 goal as a template if requested
    if save_template_name:
        try:
            from models import save_template
            save_template(name=save_template_name, goal_script=r1_goal,
                          region=region, language=language,
                          persona_name=persona_name, persona_tone=persona_tone)
            print(f"  [Template] Saved goal script as '{save_template_name}'.")
        except Exception as e_tpl:
            print(f"  [Template] Could not save template: {e_tpl}")

    with get_conn() as conn:
        conn.execute("UPDATE campaigns SET goal_script=? WHERE id=?", (r1_goal, campaign_id))
        conn.commit()

    # -- Round 1 --------------------------------------------------------------
    print(f"\n{'-'*60}")
    print(f"ROUND 1 - Qualification calls ({len(leads)} vendors)")
    print(f"{'-'*60}")

    positives = []
    uncertain = []
    for lead in leads:
        print(f"\n[{lead.name}]")
        try:
            status_output = execute_call_pipeline(
                lead.phone, r1_goal, region=region, language=language, dry_run=dry_run,
                lat=None if skip_hours_gate else lead.lat,
                lon=None if skip_hours_gate else lead.lon,
                campaign_id=campaign_id,
            )
            if status_output.get("status") == "SKIPPED":
                with get_conn() as conn:
                    lead.skip_reason = status_output.get("skip_reason")
                    conn.execute("UPDATE leads SET status='skipped', skip_reason=? WHERE id=?",
                                 (lead.skip_reason, lead.id))
                    conn.commit()
                continue
            call_id = status_output.get("run_id") or status_output.get("id") or "dry_run"
            outcome = classify_round1(status_output)
            print(f"  Outcome: {outcome}")

            transcript_lines = parse_transcript_to_json(status_output)
            inference = {}
            if transcript_lines:
                print(f"  Running AI inference on {len(transcript_lines)}-line transcript...")
                try:
                    inference = infer_from_transcript(transcript_lines, product, round_num=1)
                    print(f"  Interest: {inference.get('interest_level','?')} | "
                          f"Rec R2: {inference.get('recommend_round2','?')} | "
                          f"{inference.get('summary','')[:60]}")
                except Exception as ie:
                    print(f"  Inference error: {ie}")

            with get_conn() as conn:
                update_lead_status(conn, lead.id, outcome, call_id, round_num=1)
                log_call(conn, lead.id, call_id, 1, status_output,
                         {"transcript": transcript_lines, **inference} if transcript_lines else inference)

            if outcome == "unknown":
                uncertain.append(lead)
                print(f"  [Uncertain] {lead.name} — outcome unclear, not queued for R2")

            if outcome == "positive":
                positives.append(lead)
                # Auto-schedule R2 if vendor gave a callback time AND this is an OSM lead
                if lead.osm_id and not dry_run:
                    timeline = inference.get("timeline") or inference.get("next_steps") or ""
                    if timeline and timeline not in ("null", "None", ""):
                        scheduled = schedule_followup(
                            lead_id=lead.id,
                            campaign_id=campaign_id,
                            timeline_text=timeline,
                            product=product,
                            lat=lead.lat,
                            lon=lead.lon,
                            region=region,
                            language=language,
                        )
                        if not scheduled:
                            print(f"  [Scheduler] Could not parse time from: '{timeline}'")
                    # If no timeline in R1, also check R2 inference from same transcript
                    elif transcript_lines:
                        try:
                            r2_inf = infer_from_transcript(transcript_lines, product, round_num=2)
                            tl2 = r2_inf.get("timeline") or r2_inf.get("next_steps") or ""
                            if tl2 and tl2 not in ("null", "None", ""):
                                schedule_followup(lead_id=lead.id, campaign_id=campaign_id,
                                                  timeline_text=tl2, product=product,
                                                  lat=lead.lat, lon=lead.lon,
                                                  region=region, language=language)
                        except Exception:
                            pass
            elif outcome in ("no_answer", "failed", "busy") and lead.osm_id and not dry_run:
                from scheduler import schedule_retry
                attempt = 0  # first retry
                scheduled = schedule_retry(
                    lead_id=lead.id,
                    campaign_id=campaign_id,
                    product=product,
                    attempt=attempt,
                    lat=lead.lat,
                    lon=lead.lon,
                    region=region,
                    language=language,
                )
                if scheduled:
                    print(f"  [Retry] Scheduled retry #1 for lead {lead.id}")
        except Exception as e:
            print(f"  Error: {e}")
            with get_conn() as conn:
                update_lead_status(conn, lead.id, "failed", None, round_num=1)

    if not positives:
        print("\nNo positive responses from round 1.")
        with get_conn() as conn:
            print_results_table(conn, campaign_id)
        _run_exports(campaign_id, export, export_csv_path, export_json_path)
        # Send email report if configured
        try:
            from reporting import send_report_email
            send_report_email(campaign_id, excel_path=export)
        except Exception as e_rep:
            print(f"[Report] Email skipped: {e_rep}")
        return

    if uncertain:
        print(f"{len(uncertain)} uncertain lead(s) logged (excluded from round 2).")

    print(f"\n{len(positives)} positive response(s). Proceeding to round 2.")

    # Generate and get approval for round-2 script
    r2_goal = _call_generate_goal(product, round_num=2, persona_name=persona_name, persona_tone=persona_tone)
    r2_goal = r2_goal if yes else prompt_client_approval(r2_goal, round_num=2)

    # -- Round 2 --------------------------------------------------------------
    print(f"\n{'-'*60}")
    print(f"ROUND 2 - Data capture ({len(positives)} vendor(s))")
    print(f"{'-'*60}")

    for lead in positives:
        print(f"\n[{lead.name}]")
        try:
            status_output = execute_call_pipeline(
                lead.phone, r2_goal, region=region, language=language, dry_run=dry_run,
                lat=None if skip_hours_gate else lead.lat,
                lon=None if skip_hours_gate else lead.lon,
                campaign_id=campaign_id,
            )
            if status_output.get("status") == "SKIPPED":
                print(f"  Skipped R2 — {status_output.get('skip_reason')}")
                continue
            call_id = status_output.get("run_id") or status_output.get("id") or "dry_run"
            extracted = extract_round2_fields(status_output)

            transcript_lines = parse_transcript_to_json(status_output)
            inference = {}
            if transcript_lines:
                print(f"  Running AI inference on {len(transcript_lines)}-line transcript...")
                try:
                    inference = infer_from_transcript(transcript_lines, product, round_num=2)
                    print(f"  Can supply: {inference.get('can_supply','?')} | "
                          f"Price: {inference.get('price_range','?')} | "
                          f"{inference.get('summary','')[:60]}")
                except Exception as ie:
                    print(f"  Inference error: {ie}")

            combined = {**extracted, **inference}
            with get_conn() as conn:
                update_lead_status(conn, lead.id, "completed", call_id, round_num=2)
                log_call(conn, lead.id, call_id, 2, status_output, combined or None)
        except Exception as e:
            print(f"  Error: {e}")

    with get_conn() as conn:
        print_results_table(conn, campaign_id)

    _run_exports(campaign_id, export, export_csv_path, export_json_path)

    # Send email report if configured
    try:
        from reporting import send_report_email
        send_report_email(campaign_id, excel_path=export)
    except Exception as e_rep:
        print(f"[Report] Email skipped: {e_rep}")


def main():
    parser = argparse.ArgumentParser(description="Vendor Discovery & Outreach via CALL-E + OSM")
    parser.add_argument("--product", default=None, help="Product or service to source")
    parser.add_argument("--location", default=None, help="Location to search (city, region, etc.)")
    parser.add_argument("--cancel-campaign", type=int, default=None, metavar="CAMPAIGN_ID",
                        help="Cancel every still-pending scheduled call for a campaign and exit "
                             "(does not stop a call already in progress).")
    parser.add_argument("--limit", type=int, default=10, help="Max vendors to discover (default 10)")
    parser.add_argument("--region", default=None, help="Region hint for CALL-E (e.g. US, IN, GB)")
    parser.add_argument("--language", default=None, help="Language hint for CALL-E (e.g. English)")
    parser.add_argument("--live", action="store_true",
                        help="Actually place real calls via CALL-E. Without this, campaigns "
                             "always run in dry-run mode (plan only, nothing dialed).")
    parser.add_argument("--dry-run", action="store_true",
                        help="Plan calls but do not execute them. This is the default behavior "
                             "regardless of this flag — kept for backwards compatibility.")
    parser.add_argument("--yes", "-y", action="store_true", help="Skip all confirmation prompts")
    parser.add_argument("--export-excel", metavar="FILE.xlsx", default=None,
                        help="Export results to Excel after campaign completes")
    parser.add_argument("--export-csv", metavar="FILE.csv", default=None,
                        help="Export results to CSV after campaign completes")
    parser.add_argument("--export-json", metavar="FILE.json", default=None,
                        help="Export results to JSON after campaign completes")
    parser.add_argument("--skip-hours-gate", action="store_true",
                        help="Bypass business-hours check (for testing only)")
    parser.add_argument("--persona-name", default=None,
                        help="Caller persona name (e.g. Alex)")
    parser.add_argument("--persona-tone", default="professional",
                        choices=["professional", "friendly", "energetic"],
                        help="Caller persona tone (default professional)")
    parser.add_argument("--template", default=None, metavar="NAME",
                        help="Load a saved campaign template by name")
    parser.add_argument("--save-template", default=None, metavar="NAME",
                        help="Save the approved R1 goal as a named template after approval")
    args = parser.parse_args()

    if args.cancel_campaign is not None:
        from scheduler import cancel_campaign
        init_db()
        n = cancel_campaign(args.cancel_campaign)
        print(f"Cancelled {n} pending scheduled call(s) for campaign #{args.cancel_campaign}.")
        sys.exit(0)

    if not args.product or not args.location:
        parser.error("--product and --location are required (unless using --cancel-campaign)")

    template_goal = None
    region = args.region
    language = args.language
    persona_name = args.persona_name
    persona_tone = args.persona_tone

    if args.template:
        from models import load_template
        tpl = load_template(args.template)
        if tpl:
            print(f"[Template] Loaded template '{args.template}'.")
            # CLI args override template values only if explicitly set
            if region is None:
                region = tpl.get("region")
            if language is None:
                language = tpl.get("language")
            if persona_name is None:
                persona_name = tpl.get("persona_name")
            if persona_tone == "professional" and tpl.get("persona_tone"):
                persona_tone = tpl.get("persona_tone")
            template_goal = tpl.get("goal_script")
        else:
            print(f"[Template] No template named '{args.template}' found; generating goal normally.")

    run_campaign(
        product=args.product,
        location=args.location,
        limit=args.limit,
        region=region,
        language=language,
        dry_run=not args.live,
        yes=args.yes,
        export=args.export_excel,
        skip_hours_gate=args.skip_hours_gate,
        export_csv_path=args.export_csv,
        export_json_path=args.export_json,
        persona_name=persona_name,
        persona_tone=persona_tone,
        template_goal=template_goal,
        save_template_name=args.save_template,
    )


if __name__ == "__main__":
    main()
