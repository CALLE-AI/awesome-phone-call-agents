import sys
import logging
import store
import calle_wrapper
import llm
from config import require_keys, mask_phone, validate_e164
from prompts import build_reference_call_goal

log = logging.getLogger("vouchcall")


def run_reference_check(candidate_id: int, live: bool = False):
    candidate = store.get_candidate(candidate_id)
    if not candidate:
        log.error("Candidate %d not found.", candidate_id)
        return

    refs = store.get_references(candidate_id)
    if not refs:
        log.warning("No references found for %s.", candidate["name"])
        return

    if live:
        require_keys("CALLE_API_KEY", "GEMINI_API_KEY")

    mode = "LIVE" if live else "DRY RUN"
    log.info("Reference check for %s | Role: %s | Refs: %d | Mode: %s",
             candidate["name"], candidate["role_title"], len(refs), mode)

    existing_calls = store.get_calls_for_candidate(candidate_id) if live else []
    already_called = {c.get("ref_name") for c in existing_calls if c.get("status") == "completed"}

    for i, ref in enumerate(refs, 1):
        masked = mask_phone(ref["phone"])
        log.info("[%d/%d] Calling %s (%s) at %s", i, len(refs), ref["name"], ref["relation"], masked)

        if live and ref["name"] in already_called:
            log.info("Skipping %s — already have a completed call.", ref["name"])
            continue

        if live:
            try:
                ref["phone"] = validate_e164(ref["phone"])
            except ValueError:
                log.warning("Skipping %s — invalid phone number: %s", ref["name"], masked)
                continue

        goal = build_reference_call_goal(
            candidate_name=candidate["name"],
            reference_name=ref["name"],
            reference_relation=ref["relation"],
            role_title=candidate["role_title"],
        )

        if not live:
            log.info("[DRY RUN] Would call %s — goal preview: %s...", masked, goal[:200])
            continue

        try:
            call_result = calle_wrapper.make_call(
                phone=ref["phone"],
                goal=goal,
                region=ref.get("region", "IN"),
                locale=ref.get("locale", "en-IN"),
            )
        except ConnectionError as e:
            log.error("Network error calling %s: %s", ref["name"], e)
            continue
        except TimeoutError as e:
            log.error("Timeout calling %s: %s", ref["name"], e)
            continue
        except Exception as e:
            log.error("Unexpected error calling %s: %s: %s", ref["name"], type(e).__name__, e)
            continue

        call_id_str = str(call_result.get("id", ""))
        status = call_result.get("status", "unknown")
        log.info("Call finished — ID: %s, Status: %s", call_id_str, status)

        if status != "completed":
            log.warning("Call to %s did not complete (status: %s). Skipping analysis.", ref["name"], status)
            continue

        log.info("Analyzing response from %s...", ref["name"])
        try:
            analysis = llm.analyze_call_result(
                candidate_name=candidate["name"],
                ref_name=ref["name"],
                ref_relation=ref["relation"],
                call_result=call_result,
            )
        except Exception as e:
            log.error("Gemini analysis failed for %s: %s: %s", ref["name"], type(e).__name__, e)
            continue

        scores = {
            "collaboration": analysis.get("collaboration_score", 0),
            "technical_ability": analysis.get("technical_ability_score", 0),
            "reliability": analysis.get("reliability_score", 0),
            "communication": analysis.get("communication_score", 0),
            "leadership": analysis.get("leadership_score", 0),
        }

        store.save_call(
            ref_id=ref["id"],
            candidate_id=candidate_id,
            calle_call_id=call_id_str,
            status=status,
            scores=scores,
            strengths=analysis.get("strengths", []),
            growth_areas=analysis.get("growth_areas", []),
            overall_recommendation=analysis.get("overall_recommendation", "neutral"),
            key_quotes=analysis.get("key_quotes", []),
            summary=analysis.get("ref_summary", analysis.get("summary", "")),
            transcript=llm.extract_transcript(call_result),
        )

        avg = sum(scores.values()) / len(scores)
        log.info("Result: avg %.1f/10, recommendation: %s", avg, analysis.get("overall_recommendation"))
        log.info("Strengths: %s", ", ".join(analysis.get("strengths", [])))
        log.info("Growth areas: %s", ", ".join(analysis.get("growth_areas", [])))

    if not live:
        log.info("[DRY RUN] No calls were placed. Use --live to place real calls.")
        return

    log.info("Running cross-reference analysis...")
    calls = store.get_calls_for_candidate(candidate_id)
    if len(calls) < 2:
        log.warning("Need at least 2 completed references for cross-analysis.")
        return

    try:
        cross = llm.cross_reference_analysis(
            candidate_name=candidate["name"],
            role_title=candidate["role_title"],
            calls=calls,
        )
    except Exception as e:
        log.error("Cross-reference analysis failed: %s: %s", type(e).__name__, e)
        return

    store.save_analysis(
        candidate_id=candidate_id,
        discrepancies=cross.get("discrepancies", []),
        overall_summary=cross.get("overall_summary", ""),
        hire_recommendation=cross.get("hire_recommendation", ""),
        confidence_score=cross.get("confidence_score", 0),
    )

    log.info("Recommendation: %s | Confidence: %s%%", cross.get("hire_recommendation"), cross.get("confidence_score"))
    log.info("Summary: %s", cross.get("overall_summary"))

    discs = cross.get("discrepancies", [])
    if discs:
        log.info("Discrepancies found (%d):", len(discs))
        for d in discs:
            log.info("  [%s] %s: %s", d.get("severity", "?").upper(), d.get("dimension"), d.get("detail"))
    else:
        log.info("No significant discrepancies found.")

    log.info("Done. View the dashboard: streamlit run dashboard.py")


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    store.init_db()

    if len(sys.argv) < 2:
        print("Usage: python agent.py <candidate_id> [--live]")
        print("  Default is dry-run. Pass --live to place real CALL-E calls.")
        sys.exit(1)

    cid = int(sys.argv[1])
    is_live = "--live" in sys.argv
    run_reference_check(cid, live=is_live)
