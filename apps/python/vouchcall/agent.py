import sys
import logging
import uuid
import store
import calle_wrapper
import llm
from config import require_keys, mask_phone, validate_e164

log = logging.getLogger("vouchcall")

PERMANENT_QUALITY_STATUSES = {"no_consent"}
RETRYABLE_QUALITY_STATUSES = {"wrong_person", "insufficient"}


def run_reference_check(candidate_id: int, live: bool = False, fail_fast: bool = False):
    candidate = store.get_candidate(candidate_id)
    if not candidate:
        log.error("Candidate %d not found.", candidate_id)
        return

    if live:
        require_keys("CALLE_API_KEY", "GEMINI_API_KEY", "ENCRYPTION_KEY")
        if not store.has_candidate_consent(candidate_id):
            log.error("Cannot proceed: candidate %s has not authorized contact with their references. "
                      "Record consent first with store.record_candidate_consent(%d).",
                      candidate["name"], candidate_id)
            return
        refs = store.get_references_for_calling(candidate_id)
    else:
        refs = store.get_references(candidate_id)

    if not refs:
        log.warning("No references found for %s.", candidate["name"])
        return

    mode = "LIVE" if live else "DRY RUN"
    if fail_fast and live:
        mode += " (fail-fast)"
    log.info("Reference check for %s | Role: %s | Refs: %d | Mode: %s",
             candidate["name"], candidate["role_title"], len(refs), mode)

    already_completed_ids = store.get_completed_call_ids(candidate_id) if live else set()
    permanent_skip_refs = store.get_refs_by_quality(candidate_id, PERMANENT_QUALITY_STATUSES) if live else set()

    for i, ref in enumerate(refs, 1):
        masked = mask_phone(ref["phone"]) if live else ref["phone"]
        log.info("[%d/%d] %s (%s) at %s", i, len(refs), ref["name"], ref["relation"], masked)

        if live and ref["name"] in permanent_skip_refs:
            log.info("Skipping %s — previously declined consent.", ref["name"])
            continue

        if not live:
            goal = _build_goal(candidate, ref)
            log.info("[DRY RUN] Would call %s — goal preview: %s...", masked, goal[:200])
            continue

        try:
            ref["phone"] = validate_e164(ref["phone"])
        except ValueError:
            log.warning("Skipping %s — invalid phone number: %s", ref["name"], masked)
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue

        goal = _build_goal(candidate, ref)
        ref_attempts = store.count_calls_for_ref(ref["id"])
        idem_key = f"vouchcall_{candidate_id}_{ref['id']}_g{ref_attempts}"

        try:
            call_result = calle_wrapper.make_call(
                phone=ref["phone"],
                goal=goal,
                region=ref.get("region", "IN"),
                locale=ref.get("locale", "en-IN"),
                idempotency_key=idem_key,
            )
        except ConnectionError as e:
            log.error("Network error calling %s: %s", ref["name"], e)
            _save_unanalyzed_call(ref, candidate_id, f"err_{uuid.uuid4().hex[:12]}", "failed",
                                  f"Call failed: connection_error", "insufficient")
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue
        except TimeoutError as e:
            log.error("Timeout calling %s: %s", ref["name"], e)
            _save_unanalyzed_call(ref, candidate_id, f"err_{uuid.uuid4().hex[:12]}", "failed",
                                  f"Call failed: timeout", "insufficient")
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue
        except Exception as e:
            log.error("Unexpected error calling %s: %s: %s", ref["name"], type(e).__name__, e)
            _save_unanalyzed_call(ref, candidate_id, f"err_{uuid.uuid4().hex[:12]}", "failed",
                                  f"Call failed: {type(e).__name__}", "insufficient")
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue

        call_id_str = str(call_result.get("id", ""))
        status = call_result.get("status", "unknown")
        log.info("Call finished — ID: %s, Status: %s", call_id_str, status)

        if call_id_str in already_completed_ids:
            log.info("Skipping %s — call %s already processed.", ref["name"], call_id_str)
            continue

        if status != "completed":
            log.warning("Call to %s did not complete (status: %s). Saving as failed.", ref["name"], status)
            _save_unanalyzed_call(ref, candidate_id, call_id_str, status,
                                  f"Call did not complete: {status}", "insufficient")
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue

        completion = call_result.get("completion_confidence", {})
        if completion:
            log.info("CALL-E confidence: %s (score=%.2f)",
                     completion.get("label", "?"), completion.get("score", 0))

        transcript = llm.extract_transcript(call_result)
        quality = llm.assess_call_quality(transcript, ref["name"])
        quality_status = quality["quality_status"]

        log.info("Quality: %s (turns=%d, identity=%s, consent=%s, questions=%d)",
                 quality_status, quality["turn_count"],
                 quality["identity_confirmed"], quality["consent_given"],
                 quality["questions_answered"])

        if quality_status == "wrong_person":
            log.warning("Wrong person answered for %s. Call is retryable on next run.", ref["name"])
            _save_unanalyzed_call(ref, candidate_id, call_id_str, "completed",
                                  "Wrong person answered the call.", "wrong_person",
                                  transcript=transcript)
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue

        if quality_status == "no_consent":
            log.warning("%s declined AI analysis consent. Permanently skipping.", ref["name"])
            _save_unanalyzed_call(ref, candidate_id, call_id_str, "completed",
                                  "Reference declined consent for AI analysis.", "no_consent")
            continue

        if quality_status == "insufficient":
            log.warning("Insufficient data from %s (%d turns). Call is retryable on next run.",
                        ref["name"], quality["turn_count"])
            _save_unanalyzed_call(ref, candidate_id, call_id_str, "completed",
                                  f"Insufficient call data ({quality['turn_count']} turns).",
                                  "insufficient", transcript=transcript)
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
            continue

        if quality_status == "partial":
            log.warning("Partial data from %s (%d questions answered, need %d). Retryable on next run.",
                        ref["name"], quality["questions_answered"], 3)
            _save_unanalyzed_call(ref, candidate_id, call_id_str, "completed",
                                  f"Partial call data ({quality['questions_answered']} questions answered).",
                                  "partial", transcript=transcript)
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
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
            _save_unanalyzed_call(ref, candidate_id, call_id_str, "completed",
                                  f"Analysis failed: {type(e).__name__}", "insufficient",
                                  transcript=transcript)
            if fail_fast:
                log.error("Aborting: --fail-fast is set.")
                return
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
            transcript=transcript,
            quality_status=quality_status,
        )

        avg = sum(scores.values()) / len(scores)
        log.info("Result: avg %.1f/10, recommendation: %s, quality: %s",
                 avg, analysis.get("overall_recommendation"), quality_status)
        log.info("Strengths: %s", ", ".join(analysis.get("strengths", [])))
        log.info("Growth areas: %s", ", ".join(analysis.get("growth_areas", [])))

    if not live:
        log.info("[DRY RUN] No calls were placed. Use --live to place real calls.")
        return

    log.info("Running cross-reference analysis...")
    calls = store.get_calls_for_candidate(candidate_id)
    verified_calls = [c for c in calls if c.get("quality_status") == "verified"]

    if len(verified_calls) < 2:
        log.warning("Need at least 2 verified references for cross-analysis (have %d).", len(verified_calls))
        _log_quality_summary(calls)
        return

    try:
        cross = llm.cross_reference_analysis(
            candidate_name=candidate["name"],
            role_title=candidate["role_title"],
            calls=verified_calls,
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

    _log_quality_summary(calls)
    log.info("Done. View the dashboard: streamlit run dashboard.py")


def _build_goal(candidate, ref):
    from prompts import build_reference_call_goal
    return build_reference_call_goal(
        candidate_name=candidate["name"],
        reference_name=ref["name"],
        reference_relation=ref["relation"],
        role_title=candidate["role_title"],
    )


def _save_unanalyzed_call(ref, candidate_id, calle_call_id, status,
                           summary, quality_status, transcript=""):
    store.save_call(
        ref_id=ref["id"], candidate_id=candidate_id,
        calle_call_id=calle_call_id, status=status,
        scores={}, strengths=[], growth_areas=[],
        overall_recommendation="", key_quotes=[],
        summary=summary, transcript=transcript,
        quality_status=quality_status,
    )


def _log_quality_summary(calls):
    by_status = {}
    for c in calls:
        qs = c.get("quality_status", "unknown")
        by_status[qs] = by_status.get(qs, 0) + 1
    parts = [f"{v} {k}" for k, v in sorted(by_status.items())]
    log.info("Quality summary: %s", ", ".join(parts))


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )
    store.init_db()

    if len(sys.argv) < 2:
        print("Usage: python agent.py <candidate_id> [--live] [--fail-fast]")
        print("  Default is dry-run. Pass --live to place real CALL-E calls.")
        print("  Pass --fail-fast to stop on first error or ambiguous call.")
        sys.exit(1)

    cid = int(sys.argv[1])
    is_live = "--live" in sys.argv
    is_fail_fast = "--fail-fast" in sys.argv
    run_reference_check(cid, live=is_live, fail_fast=is_fail_fast)
