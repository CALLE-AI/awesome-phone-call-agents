import sys
import store
import calle_wrapper
import llm
from prompts import build_reference_call_goal


def run_reference_check(candidate_id: int, dry_run: bool = False):
    candidate = store.get_candidate(candidate_id)
    if not candidate:
        print(f"Candidate {candidate_id} not found.")
        return

    refs = store.get_references(candidate_id)
    if not refs:
        print(f"No references found for {candidate['name']}.")
        return

    print(f"\n{'='*60}")
    print(f"  VouchCall — Reference Check for {candidate['name']}")
    print(f"  Role: {candidate['role_title']}")
    print(f"  References: {len(refs)}")
    print(f"{'='*60}\n")

    for i, ref in enumerate(refs, 1):
        print(f"[{i}/{len(refs)}] Calling {ref['name']} ({ref['relation']})...")

        goal = build_reference_call_goal(
            candidate_name=candidate["name"],
            reference_name=ref["name"],
            reference_relation=ref["relation"],
            role_title=candidate["role_title"],
        )

        if dry_run:
            print(f"  [DRY RUN] Would call {ref['phone']}")
            print(f"  Goal preview: {goal[:200]}...")
            continue

        try:
            call_result = calle_wrapper.make_call(
                phone=ref["phone"],
                goal=goal,
                region=ref.get("region", "IN"),
                locale=ref.get("locale", "en-IN"),
            )
        except Exception as e:
            print(f"  Call failed: {e}")
            continue

        call_id_str = str(call_result.get("id", ""))
        status = call_result.get("status", "unknown")
        print(f"  Call finished. ID: {call_id_str}, Status: {status}")

        if status != "completed":
            print(f"  Call did not complete (status: {status}). Skipping analysis.")
            continue

        print(f"  Analyzing response...")
        analysis = llm.analyze_call_result(
            candidate_name=candidate["name"],
            ref_name=ref["name"],
            ref_relation=ref["relation"],
            call_result=call_result,
        )

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
            raw_result=call_result,
        )

        avg = sum(scores.values()) / len(scores)
        print(f"  Result: avg {avg:.1f}/10, recommendation: {analysis.get('overall_recommendation')}")
        print(f"  Strengths: {', '.join(analysis.get('strengths', []))}")
        print(f"  Growth areas: {', '.join(analysis.get('growth_areas', []))}")
        print()

    if dry_run:
        print("\n[DRY RUN] No calls were placed.")
        return

    print("Running cross-reference analysis...")
    calls = store.get_calls_for_candidate(candidate_id)
    if len(calls) < 2:
        print("Need at least 2 completed references for cross-analysis.")
        return

    cross = llm.cross_reference_analysis(
        candidate_name=candidate["name"],
        role_title=candidate["role_title"],
        calls=calls,
    )

    store.save_analysis(
        candidate_id=candidate_id,
        discrepancies=cross.get("discrepancies", []),
        overall_summary=cross.get("overall_summary", ""),
        hire_recommendation=cross.get("hire_recommendation", ""),
        confidence_score=cross.get("confidence_score", 0),
    )

    print(f"\n{'='*60}")
    print(f"  CROSS-REFERENCE ANALYSIS")
    print(f"{'='*60}")
    print(f"Recommendation: {cross.get('hire_recommendation')}")
    print(f"Confidence: {cross.get('confidence_score')}%")
    print(f"Summary: {cross.get('overall_summary')}")

    discs = cross.get("discrepancies", [])
    if discs:
        print(f"\nDiscrepancies found ({len(discs)}):")
        for d in discs:
            print(f"  [{d.get('severity', '?').upper()}] {d.get('dimension')}: {d.get('detail')}")
    else:
        print("\nNo significant discrepancies found.")

    print(f"\nDone. View the dashboard: streamlit run dashboard.py")


if __name__ == "__main__":
    store.init_db()

    if len(sys.argv) < 2:
        print("Usage: python agent.py <candidate_id> [--dry-run]")
        sys.exit(1)

    cid = int(sys.argv[1])
    dry = "--dry-run" in sys.argv
    run_reference_check(cid, dry_run=dry)
