"""Seed a demo brain by running the REAL learn pipeline over sample calls.

This writes a `cortex.db` the dashboard can render, with NO phone calls placed.
Every fact/signal/sub-brain still goes through the same corroboration gate the
live campaign uses, so what the dashboard shows is genuinely how the brain would
look after these calls. Safe to re-run: it starts from a clean file.

All phone numbers below are fictional samples.

    python seed_demo.py            # then: streamlit run dashboard.py
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

from cortex.memory import Memory
from cortex.llm import Gemini
from cortex.learn import learn_from_call

DB = os.path.join(os.path.dirname(__file__), "cortex.db")
DRUG = "Metformin"

# (phone, name, consent, transcript) — fictional callers, differently worded on
# purpose so the corroboration gate has to do real work.
CALLS = [
    ("+12025550101", "Caller A", True,
     "I've been taking it every day, but honestly it makes me feel sick to my stomach most mornings."),
    ("+12025550102", "Caller B", True,
     "Doing okay with the tablets. A little nausea now and then. Oh, and I'm about to run out — need a refill."),
    ("+12025550103", "Caller C", True,
     "I actually forgot a couple of doses last week, and when I do take it I get a bit dizzy."),
]


def main():
    if os.path.exists(DB):
        os.remove(DB)
    m = Memory(db_path=DB)
    g = Gemini()
    print("embedder:", m.embedder.tag, "| gemini:", g.available, "\n")

    for phone, name, consent, transcript in CALLS:
        m.upsert_patient(phone, name=name, consent=consent, language="English")
        r = learn_from_call(m, phone, transcript, summary=None, drug=DRUG, gemini=g)
        m.record_call(run_id=f"seed:{m.source_id(phone)}", phone=phone, outcome=r["outcome"],
                      summary=r["sub_brain_summary"], cost_usd=0.0)
        print(f"{name:6} -> outcome={r['outcome']:12} "
              f"promoted={r['_promoted_to_canonical']} flagged={r['_flagged_to_staff']}")

    print("\ncanonical:", [f['text'] for f in
          m.db.execute("SELECT text FROM facts WHERE status='canonical'")])
    print("candidates:", [f['text'] for f in
          m.db.execute("SELECT text FROM facts WHERE status='candidate'")])
    print(f"\nSeeded {DB}. Now: streamlit run dashboard.py")


if __name__ == "__main__":
    main()
