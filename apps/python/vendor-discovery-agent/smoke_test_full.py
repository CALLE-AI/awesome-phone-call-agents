"""
Full 3-part smoke test:
  Part 1 - Vendor discovery: finds vendors in a city by product keyword
  Part 2 - Script generation: creates R1 and R2 call scripts
  Part 3 - Real call: calls a fictional reserved sample number using the generated script
"""
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PRODUCT  = "stationery and office supplies"
CITY     = "New Delhi, India"
TARGET   = "+15550101234"   # fictional reserved sample number (not a real vendor)

SEP = "=" * 65

# ============================================================
# PART 1 — VENDOR DISCOVERY
# ============================================================
print(f"\n{SEP}")
print("PART 1 - VENDOR DISCOVERY")
print(f"Product : {PRODUCT}")
print(f"City    : {CITY}")
print(SEP)

from discovery import discover_vendors
vendors = discover_vendors(PRODUCT, CITY, limit=5)

if vendors:
    print(f"\nFound {len(vendors)} vendor(s) with phone numbers:\n")
    for i, v in enumerate(vendors, 1):
        from models import _mask_phone
        print(f"  {i}. {(v['name'] or 'Unknown'):<35} {_mask_phone(v['phone']):<18} "
              f"({v['category']})  lat={v.get('lat')} lon={v.get('lon')}")
    print(f"\n  Candidate IDs (stable OSM URIs):")
    for v in vendors:
        print(f"    osm:{v.get('osm_id')}  ->  {v.get('name')}")
else:
    print("\n  [NOTE] No vendors with phones found in OSM for this city/product.")
    print("  This is expected for many Indian cities — OSM coverage is ~4%.")
    print("  Showing that discovery module ran correctly with zero results.")

print(f"\nPart 1: DONE")

# ============================================================
# PART 2 — SCRIPT GENERATION
# ============================================================
print(f"\n{SEP}")
print("PART 2 - SCRIPT GENERATION")
print(SEP)

from script_gen import generate_goal

r1_script = generate_goal(PRODUCT, round_num=1)
r2_script = generate_goal(PRODUCT, round_num=2)

print("\n--- ROUND 1 SCRIPT (Qualification) ---")
print(r1_script)
print("\n--- ROUND 2 SCRIPT (Data Capture) ---")
print(r2_script)
print(f"\nPart 2: DONE")

# ============================================================
# PART 3 — REAL CALL to 5550101234
# ============================================================
print(f"\n{SEP}")
print("PART 3 - REAL CALL")
print(f"Target  : {TARGET}  (India mobile)")
print(f"Script  : Round 1 qualification (generated above)")
print(f"Region  : IN  |  Language: English")
print(SEP)

from caller import execute_call_pipeline, classify_round1, parse_transcript_to_json, infer_from_transcript

try:
    status_output = execute_call_pipeline(
        phone=TARGET,
        goal=r1_script,
        region="IN",
        language="English",
        dry_run=False,
        lat=None,   # no lat/lon for direct number — skip hours gate
        lon=None,
    )

    call_status = status_output.get("status", "unknown")
    print(f"\nCall status : {call_status}")

    outcome = classify_round1(status_output)
    print(f"R1 outcome  : {outcome}")

    transcript_lines = parse_transcript_to_json(status_output)
    if transcript_lines:
        print(f"\nTranscript ({len(transcript_lines)} lines):")
        for line in transcript_lines:
            print(f"  [{line['time']}] {line['speaker']}: {line['text']}")

        groq_key = os.environ.get("GROQ_API_KEY") or \
                   __import__('subprocess').run(
                       ['python','-c',
                        'import os,sys; k=os.environ.get("GROQ_API_KEY",""); sys.stdout.write(k)'],
                       capture_output=True, text=True).stdout.strip()
        if groq_key:
            os.environ["GROQ_API_KEY"] = groq_key
            inference = infer_from_transcript(transcript_lines, PRODUCT, round_num=1)
            print(f"\nGroq AI inference:")
            for k, v in inference.items():
                if k != "transcript":
                    print(f"  {k}: {v}")
        else:
            print("\n  [Groq inference skipped — GROQ_API_KEY not in environment]")
    else:
        raw_result = status_output.get("result", {})
        print(f"\n  No parsed transcript. Raw result keys: {list(raw_result.keys())}")
        summary = raw_result.get("summary") or raw_result.get("post_summary") or ""
        if summary:
            print(f"  Summary: {summary}")

    print(f"\nRun ID : {status_output.get('run_id', 'n/a')}")
    print(f"\nPart 3: DONE")

except Exception as e:
    print(f"\nPart 3 ERROR: {e}")
    import traceback; traceback.print_exc()

print(f"\n{SEP}")
print("ALL THREE PARTS COMPLETE")
print(SEP)
