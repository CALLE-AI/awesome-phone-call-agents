"""Campaign orchestrator — the safe loop that turns a roster into a smarter brain.

For each patient on the roster this does, in order:

  consent  ->  quiet-hours  ->  idempotency  ->  budget (fail-closed)
           ->  build_call_goal (brain)  ->  place_call (CALL-E)
           ->  wait_for_result  ->  learn_from_call (brain grows)

The guards up front are the point. This system places real phone calls and
writes a shared brain, so every guard fails *closed* — when in doubt it does NOT
dial:

- **No-call default**: a real call is placed ONLY with an explicit execute
  intent (`execute=True` / `--execute`) and never in dry-run. Omitting it
  previews the goal without dialing.
- **Authorized destination**: a live dial must be strict E.164 AND match a
  **non-empty** `CORTEX_ALLOWED_DIAL` allowlist. An empty allowlist fails
  closed for live calls — you must list the numbers you may call.
- **Explicit consent**: a patient with `consent=false` is never called, and a
  self-supplied `--phone`/`--demo` number is NOT treated as consent — the
  operator must pass `--consent` (roster files carry their own per-patient
  consent). No override flag bypasses a missing consent.
- **Inconclusive/ambiguous outcomes** (error, timeout, unknown, or a poll that
  never reaches a terminal state) halt the campaign for reconciliation; the
  brain never learns from or advances past them.
- **Quiet hours**: no calls inside `CORTEX_QUIET_HOURS` (region-local). A human
  running an interactive demo can pass `ignore_quiet=True`; automation cannot.
- **Idempotency**: the same patient identity is not called twice within
  `CORTEX_MIN_RECALL_HOURS`, and never twice in one run. Protects people from
  double-dialing if the script is re-run.
- **Budget**: before each call, `spent + est_cost` must stay under
  `CORTEX_BUDGET_USD`. Crossing it stops the whole campaign, it does not skip on.

Identity vs. dial target: a roster entry's `phone` is the patient *identity* (the
sub-brain key and the corroboration source). `dial` is the number actually rung;
it defaults to `phone`. In production they're equal. For a live demo you can point
several distinct identities at one real handset (`--dial <a number you supply>`) to show three
different "callers" teaching the master brain — genuine distinct-source
corroboration, one ringing phone.

Concurrency: the idempotency, per-run call cap, and budget guards read state
before dialing and write after, so run **one** campaign against a given
`cortex.db` at a time. Two concurrent campaigns on the same DB could each pass
the guards and collectively double-dial, exceed the call cap, or overrun budget.
Single-writer operation is assumed; serialize runs (or use separate DBs).
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None

from .brain import build_call_goal
from .caller import Caller
from .learn import learn_from_call
from .llm import Gemini
from .memory import Memory
from .util import authorized_dial, is_e164, mask_phone

_TZ = {"IN": "Asia/Kolkata", "US": "America/New_York", "UK": "Europe/London"}


def _now_local(region: str) -> datetime:
    if ZoneInfo is not None:
        try:
            return datetime.now(ZoneInfo(_TZ.get(region, "Asia/Kolkata")))
        except Exception:
            pass
    return datetime.now()


def _in_quiet_hours(spec: str, region: str) -> bool:
    """spec like '21:00-08:00' (may wrap past midnight). Empty spec => never quiet."""
    if not spec or "-" not in spec:
        return False
    try:
        a, b = spec.split("-", 1)
        ah, am = (int(x) for x in a.split(":"))
        bh, bm = (int(x) for x in b.split(":"))
    except ValueError:
        return False
    now = _now_local(region)
    cur = now.hour * 60 + now.minute
    start, end = ah * 60 + am, bh * 60 + bm
    return (start <= cur or cur < end) if start > end else (start <= cur < end)


@dataclass
class Patient:
    phone: str                     # identity = sub-brain key = corroboration source
    name: Optional[str] = None
    drug: Optional[str] = None
    consent: bool = False
    language: Optional[str] = None
    dial: Optional[str] = None     # number actually rung; defaults to `phone`

    @property
    def dial_to(self) -> str:
        return self.dial or self.phone


@dataclass
class CampaignResult:
    placed: list = field(default_factory=list)
    skipped: list = field(default_factory=list)
    learned: list = field(default_factory=list)
    stopped_reason: Optional[str] = None

    def as_dict(self) -> dict:
        return {"placed": self.placed, "skipped": self.skipped,
                "learned": self.learned, "stopped_reason": self.stopped_reason}


class Campaign:
    def __init__(self, memory: Memory = None, caller: Caller = None,
                 gemini: Gemini = None, *, cost_per_call: float = None,
                 budget_usd: float = None, region: str = None):
        self.region = region or os.environ.get("CORTEX_REGION", "IN")
        self.memory = memory or Memory()
        self.caller = caller or Caller(memory=self.memory, region=self.region)
        self.gemini = gemini or Gemini()
        self.cost_per_call = float(
            cost_per_call if cost_per_call is not None
            else os.environ.get("CORTEX_COST_PER_CALL", 0.0))
        self.budget = float(
            budget_usd if budget_usd is not None
            else os.environ.get("CORTEX_BUDGET_USD", 5.0))
        self.min_recall_h = float(os.environ.get("CORTEX_MIN_RECALL_HOURS", 20))
        self.quiet = os.environ.get("CORTEX_QUIET_HOURS", "")
        # Hard cap on real calls per run — bounds blast radius even when
        # cost_per_call is 0 (which makes the money budget a no-op).
        self.max_calls = int(os.environ.get("CORTEX_MAX_CALLS", 50))

    # ---- guards ----------------------------------------------------------
    def _recently_called(self, phone: str) -> Optional[float]:
        p = self.memory.get_patient(phone)
        if not p or not p.last_call_ts:
            return None
        age_h = (time.time() - p.last_call_ts) / 3600.0
        return age_h if age_h < self.min_recall_h else None

    # ---- one patient -----------------------------------------------------
    def call_one(self, pt: Patient, *, ignore_quiet: bool = False,
                 force: bool = False, dry_run: bool = False,
                 execute: bool = False) -> dict:
        # register/refresh the sub-brain identity (consent + who they are)
        self.memory.upsert_patient(pt.phone, name=pt.name, consent=pt.consent,
                                   language=pt.language or os.environ.get("CORTEX_LANGUAGE", "English"))

        if not pt.consent:
            return {"phone": pt.phone, "skipped": "no_consent"}
        if not ignore_quiet and _in_quiet_hours(self.quiet, self.region):
            return {"phone": pt.phone, "skipped": f"quiet_hours({self.quiet})"}
        if not force:
            age = self._recently_called(pt.phone)
            if age is not None:
                return {"phone": pt.phone, "skipped": f"called_{age:.1f}h_ago"}

        goal = build_call_goal(self.memory, pt.phone, drug=pt.drug)
        # No-call is the default. A real call is placed ONLY with an explicit
        # execute intent (and never in dry-run). Without it, this previews.
        if dry_run or not execute:
            return {"phone": pt.phone, "dial": pt.dial_to, "preview": True,
                    "reason": "dry_run" if dry_run else "no_execute", "goal": goal}
        # Defense in depth: validate the destination here too (Caller re-checks).
        if not is_e164(pt.dial_to):
            return {"phone": pt.phone, "skipped": f"invalid_dial:{mask_phone(pt.dial_to)}"}
        # A live dial must hit an explicit, non-empty authorized-destination allowlist.
        if not authorized_dial(pt.dial_to, require_allowlist=True):
            return {"phone": pt.phone,
                    "skipped": f"unauthorized_destination:{mask_phone(pt.dial_to)} "
                               f"(set CORTEX_ALLOWED_DIAL)"}

        placed = self.caller.place_call(pt.dial_to, goal, language=pt.language)
        run_id = placed["run_id"]
        # the sub-brain identity may differ from the dialed number; bind them
        self.memory.record_call(run_id, phone=pt.phone, cost_usd=self.cost_per_call)

        res = self.caller.wait_for_result(run_id, phone=pt.phone)
        # If the call never reached a terminal state, do NOT learn or advance.
        if res.get("inconclusive"):
            return {"phone": pt.phone, "dial": pt.dial_to, "run_id": run_id,
                    "status": res.get("status"), "inconclusive": True}

        learned = learn_from_call(self.memory, pt.phone,
                                  res.get("transcript") or "",
                                  summary=res.get("summary"), drug=pt.drug,
                                  gemini=self.gemini)
        return {"phone": pt.phone, "dial": pt.dial_to, "run_id": run_id,
                "status": res.get("status"), "outcome": learned["outcome"],
                "promoted": learned["_promoted_to_canonical"],
                "flagged": learned["_flagged_to_staff"]}

    # ---- whole roster ----------------------------------------------------
    def run(self, roster: list[Patient], *, ignore_quiet: bool = False,
            force: bool = False, dry_run: bool = False,
            execute: bool = False) -> CampaignResult:
        live = execute and not dry_run
        out = CampaignResult()
        called_this_run: set[str] = set()
        for pt in roster:
            if pt.phone in called_this_run:
                out.skipped.append({"phone": pt.phone, "skipped": "dup_in_run"})
                continue
            # hard call-count cap (only when dialing) — the real blast-radius bound
            if live and len(called_this_run) >= self.max_calls:
                out.stopped_reason = f"max calls per run reached ({self.max_calls})"
                break
            # budget gate (only when dialing) — fail closed: stop, don't skip ahead
            if live and self.memory.total_spend() + self.cost_per_call > self.budget + 1e-9:
                out.stopped_reason = (f"budget ${self.budget:.2f} reached "
                                      f"(spent ${self.memory.total_spend():.2f})")
                break
            try:
                r = self.call_one(pt, ignore_quiet=ignore_quiet, force=force,
                                  dry_run=dry_run, execute=execute)
            except Exception as e:  # a CLI/LLM hiccup must not crash a live run
                # Fail safe: halt for reconciliation rather than silently advancing
                # (a live dial may have gone out before the error).
                out.placed.append({"phone": pt.phone, "error": str(e)[:200]})
                out.stopped_reason = (f"error on {mask_phone(pt.phone)}: {str(e)[:120]} "
                                      f"— halted for reconciliation")
                break
            if r.get("skipped"):
                out.skipped.append(r)
            elif r.get("preview"):
                out.placed.append(r)
            elif r.get("inconclusive"):
                # Halt the whole campaign for reconciliation; do not advance/learn.
                out.placed.append(r)
                out.stopped_reason = (f"inconclusive result for {mask_phone(pt.phone)} "
                                      f"(run {r.get('run_id')}) — halted for reconciliation")
                break
            else:
                called_this_run.add(pt.phone)
                out.placed.append(r)
                out.learned.append({k: r[k] for k in ("phone", "outcome", "promoted", "flagged")})
        return out


# ==========================================================================
def _load_roster(path: str) -> list[Patient]:
    with open(path) as f:
        data = json.load(f)
    return [Patient(**row) for row in data]


def _demo_roster(dial: str, drug: str, consent: bool) -> list[Patient]:
    """Three distinct identities (own sub-brains + distinct corroboration sources),
    all rung on one handset for a live demo, so one symptom reported by two
    DISTINCT callers promotes to canonical mid-demo. Identities use the reserved
    +1-555-01xx fictional range; only `dial` is a real number you supply. Consent
    is not implied by supplying a number — the operator must pass --consent."""
    return [
        Patient(phone="+12025550101", name="Caller A", drug=drug, consent=consent, dial=dial),
        Patient(phone="+12025550102", name="Caller B", drug=drug, consent=consent, dial=dial),
        Patient(phone="+12025550103", name="Caller C", drug=drug, consent=consent, dial=dial),
    ]


def main(argv=None):
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    ap = argparse.ArgumentParser(description="Cortex campaign — safe outbound learning loop")
    ap.add_argument("--roster", help="path to roster JSON (list of patient objects)")
    ap.add_argument("--phone", help="single patient identity (E.164)")
    ap.add_argument("--dial", help="number actually rung (defaults to --phone / demo)")
    ap.add_argument("--name")
    ap.add_argument("--drug", default=os.environ.get("CORTEX_DRUG", "Metformin"))
    ap.add_argument("--demo", action="store_true",
                    help="3 distinct demo callers, all rung on --dial")
    ap.add_argument("--db", default=os.environ.get("CORTEX_DB",
                    os.path.join(os.path.dirname(__file__), "..", "cortex.db")))
    ap.add_argument("--dry-run", action="store_true", help="build goals, place NO calls")
    ap.add_argument("--execute", action="store_true",
                    help="REQUIRED to place real calls. Without it, this only previews "
                         "(no-call is the default).")
    ap.add_argument("--force", action="store_true", help="bypass idempotency window")
    ap.add_argument("--consent", action="store_true",
                    help="explicitly assert recipient consent for --phone/--demo ad-hoc "
                         "calls (roster files carry their own per-patient consent). A "
                         "self-supplied number is never treated as consent on its own.")
    ap.add_argument("--ignore-quiet", action="store_true",
                    help="human-in-the-loop demo: allow calls during quiet hours")
    args = ap.parse_args(argv)

    mem = Memory(db_path=args.db)
    camp = Campaign(memory=mem)

    if args.roster:
        roster = _load_roster(args.roster)
    elif args.demo:
        if not args.dial:
            ap.error("--demo needs --dial <number to ring>")
        roster = _demo_roster(args.dial, args.drug, args.consent)
    elif args.phone:
        roster = [Patient(phone=args.phone, dial=args.dial, name=args.name,
                          drug=args.drug, consent=args.consent)]
    else:
        ap.error("give --roster, --demo --dial, or --phone")

    live = args.execute and not args.dry_run
    mode = "LIVE (placing calls)" if live else ("DRY-RUN" if args.dry_run else "PREVIEW (no --execute)")
    print(f"[cortex] {len(roster)} patient(s) · drug={args.drug} · budget=${camp.budget:.2f} "
          f"· spent=${mem.total_spend():.2f} · quiet={camp.quiet or 'off'} · {mode}")
    res = camp.run(roster, ignore_quiet=args.ignore_quiet, force=args.force,
                   dry_run=args.dry_run, execute=args.execute)

    for r in res.placed:
        if r.get("preview"):
            print(f"\n--- PREVIEW {mask_phone(r['phone'])} -> dial {mask_phone(r['dial'])} "
                  f"({r.get('reason')}) ---\n{r['goal']}\n")
        elif r.get("inconclusive"):
            print(f"[inconclusive] {mask_phone(r['phone'])} run={r.get('run_id')} "
                  f"status={r.get('status')} — not learned")
        elif r.get("error"):
            print(f"[error] {mask_phone(r['phone'])} — {r['error']}")
        else:
            print(f"[call] {mask_phone(r['phone'])} run={r.get('run_id')} status={r.get('status')} "
                  f"outcome={r.get('outcome')} promoted={r.get('promoted')} flagged={r.get('flagged')}")
    for s in res.skipped:
        print(f"[skip] {mask_phone(s['phone'])} — {s['skipped']}")
    if res.stopped_reason:
        print(f"[stop] {res.stopped_reason}")
    print(f"[done] spent=${mem.total_spend():.2f}")


if __name__ == "__main__":
    main()
