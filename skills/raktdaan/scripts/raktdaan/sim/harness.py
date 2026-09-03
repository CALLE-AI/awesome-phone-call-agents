"""Fixture mode: the whole flow, zero phone calls, no CALL-E account needed.

Run it:

    python3 -m raktdaan.sim.harness

Everything is deterministic, so the numbers in the README are the numbers you
get. The register below is synthetic and every number in it begins +910000,
which no Indian mobile number does -- Indian mobiles are ten digits starting
6, 7, 8 or 9 -- so none of these can be dialled even by accident.

The register is built to exercise every suppression reason at once, because the
claim being demonstrated is not "it can place a call". It is "it can tell you,
line by line, who it refused to call and why".
"""

from __future__ import annotations

from datetime import date, timedelta

from .. import commitment, compat, order
from ..policy import Consent, Deferral, Donor, Policy

TODAY = date(2026, 9, 3)
CONSENTED = Consent(recall_consent=True, recorded_on=date(2026, 1, 15))
NEVER_ASKED = Consent(recall_consent=False)
WITHDRAWN = Consent(recall_consent=True, opted_out=True, recorded_on=date(2025, 8, 1))


def _d(
    ref: str,
    group: str,
    *,
    sex: str = "M",
    age: int = 31,
    weight: float = 68.0,
    hb: float | None = 14.0,
    wb_days: int | None = 200,
    plt_days: int | None = None,
    plt_ytd: int = 0,
    deferral: Deferral | None = None,
    consent: Consent = CONSENTED,
    language: str = "Hindi",
    called_days: int | None = None,
    first_time: bool = False,
) -> Donor:
    """Build a register entry from days-ago offsets, so fixtures never go stale."""
    return Donor(
        ref=ref,
        phone=f"+91000000{ref[-4:]}",
        group=group,
        sex=sex,
        date_of_birth=date(TODAY.year - age, 5, 12),
        weight_kg=weight,
        last_hb_g_dl=hb,
        last_whole_blood=TODAY - timedelta(days=wb_days) if wb_days is not None else None,
        last_plateletpheresis=TODAY - timedelta(days=plt_days) if plt_days is not None else None,
        plateletpheresis_in_last_year=plt_ytd,
        deferrals=(deferral,) if deferral else (),
        consent=consent,
        language=language,
        recent_call_dates=(TODAY - timedelta(days=called_days),) if called_days is not None else (),
        first_time_donor=first_time,
    )

def build_register() -> list[Donor]:
    """Forty synthetic register entries covering every suppression reason."""
    return [
        # --- callable for an A+ red cell request -------------------------------
        _d("RD-1001", "A+", wb_days=210),
        _d("RD-1002", "A+", sex="F", weight=54.0, hb=13.1, wb_days=190, language="Hindi"),
        _d("RD-1003", "A-", wb_days=400, language="English"),
        _d("RD-1004", "O+", wb_days=365, language="Tamil"),
        _d("RD-1005", "O-", wb_days=300, language="English"),
        _d("RD-1006", "A+", wb_days=None, first_time=True, age=22),
        _d("RD-1007", "O+", sex="F", weight=49.0, hb=12.8, wb_days=500),
        _d("RD-1008", "A+", wb_days=95, language="Tamil"),
        _d("RD-1009", "A-", wb_days=260, plt_days=40),
        # --- inside the whole blood interdonation interval --------------------
        _d("RD-1010", "A+", wb_days=30),
        _d("RD-1011", "A+", wb_days=61),
        _d("RD-1012", "O+", wb_days=14),
        _d("RD-1013", "A-", wb_days=88),
        _d("RD-1014", "A+", sex="F", wb_days=100, hb=12.9),
        _d("RD-1015", "O-", wb_days=45),
        _d("RD-1016", "A+", wb_days=7),
        _d("RD-1017", "O+", sex="F", wb_days=119, hb=13.4),
        _d("RD-1018", "A+", wb_days=70),
        _d("RD-1019", "A-", wb_days=2),
        _d("RD-1020", "O+", wb_days=55),
        _d("RD-1021", "A+", wb_days=89),
        # --- deferred ---------------------------------------------------------
        _d("RD-1022", "A+", wb_days=300, deferral=Deferral("tattoo", TODAY - timedelta(days=30))),
        _d("RD-1023", "O+", wb_days=300, deferral=Deferral("malaria", TODAY - timedelta(days=20))),
        _d("RD-1024", "A+", sex="F", wb_days=400, hb=12.7,
           deferral=Deferral("pregnancy", TODAY - timedelta(days=120))),
        _d("RD-1025", "A-", wb_days=300, deferral=Deferral("hepatitis_b", date(2018, 2, 2))),
        _d("RD-1026", "O-", wb_days=300, deferral=Deferral("hiv", date(2016, 7, 9))),
        _d("RD-1027", "A+", wb_days=250, deferral=Deferral("major_surgery", TODAY - timedelta(days=200))),
        _d("RD-1028", "O+", wb_days=250, deferral=Deferral("antibiotics", TODAY - timedelta(days=3))),
        _d("RD-1029", "A+", wb_days=250, deferral=Deferral("jaundice", None)),
        # --- wrong group for an A+ red cell need ------------------------------
        _d("RD-1030", "B+", wb_days=300),
        _d("RD-1031", "B-", wb_days=300),
        _d("RD-1032", "AB+", wb_days=300),
        _d("RD-1033", "AB-", wb_days=300),
        _d("RD-1034", "B+", wb_days=400, language="Tamil"),
        _d("RD-1035", "AB+", sex="F", wb_days=400, hb=13.0),
        # --- consent, contactability and fatigue ------------------------------
        _d("RD-1036", "A+", wb_days=300, consent=NEVER_ASKED),
        _d("RD-1037", "O+", wb_days=300, consent=WITHDRAWN),
        _d("RD-1038", "A+", wb_days=300, called_days=20),
        _d("RD-1039", "A+", wb_days=None),                      # register gap
        _d("RD-1040", "A+", wb_days=300, weight=None, hb=None),  # unrecorded
    ]

# What each donor says when rung. Written as raw speech, then graded by the same
# grader a live run uses -- so the fixture proves the grading, not just the
# plumbing. Note RD-1002 and RD-1004: polite agreement with no arrival window,
# which is precisely the answer that a yes/no register records as a yes.
REPLIES: dict[str, str | None] = {
    "RD-1001": "Haan ji, I can come tomorrow between 10 to 12 in the morning.",
    "RD-1002": "Yes of course, I'll come sometime this week.",
    "RD-1003": None,
    "RD-1004": "Sure sure, koshish karunga.",
    "RD-1005": "Yes, I will be there 4 to 6 pm today.",
    "RD-1006": "Sorry, I'm out of town right now.",
    "RD-1007": "Okay, 9 to 11 am tomorrow works.",
    "RD-1008": "Please remove me from this list.",
    "RD-1009": "Yes I'll come, 2 to 4 pm.",
}

PLATELET_REPLIES: dict[str, str | None] = {
    "RD-1030": "Haan, main aa jaunga, 11 to 1 baje.",
    "RD-1034": "Let's see, maybe next week.",
}


class ScriptedDialler:
    """Stands in for CALL-E. Grades scripted speech through the real grader."""

    def __init__(self, replies: dict[str, str | None]) -> None:
        self.replies = replies
        self.log: list[tuple[str, str, str]] = []

    def __call__(self, donor: Donor, request: order.Request) -> order.CallOutcome:
        reply = self.replies.get(donor.ref, "")
        state, why = commitment.grade(reply, answered=reply is not None)
        self.log.append((donor.ref, state, why))
        window = reply if state == order.CONFIRMED else None
        return order.CallOutcome(
            donor_ref=donor.ref,
            commitment=state,
            arrival_window=window,
            transcript_ref=f"fixture:{donor.ref}",
        )


def run_scenario(
    label: str,
    request: order.Request,
    register: list[Donor],
    replies: dict[str, str | None],
    policy: Policy | None = None,
) -> order.RunReport:
    plan = order.build_plan(register, request, TODAY, policy)
    dialler = ScriptedDialler(replies)
    dispatched: list[str] = []
    report = order.run(plan, dialler, on_dispatch=lambda d: dispatched.append(d.ref))

    print(f"\n=== {label} ===")
    print(f"  call order: {' -> '.join(d.ref for d in plan.queue) or '(nobody eligible)'}")
    for ref, state, why in dialler.log:
        print(f"  dialled {ref}: {state.upper()} ({why})")
    for line in report.summary_lines():
        print(line)
    return report

def main() -> int:
    register = build_register()

    print(f"register: {len(register)} entries, as of {TODAY.isoformat()}")

    whole_blood = run_scenario(
        "2 units A+ red cells",
        order.Request("REQ-A", "A+", compat.RED_CELLS, units_needed=2),
        register,
        REPLIES,
    )

    # Platelets, ABO/Rh identical only -- the default refuses to widen.
    platelets = run_scenario(
        "1 unit B+ plateletpheresis (identical only)",
        order.Request("REQ-B", "B+", compat.PLATELETS, units_needed=1),
        register,
        PLATELET_REPLIES,
    )

    # Same request, with the bank's own widening allowlist applied.
    widened = run_scenario(
        "1 unit B+ plateletpheresis (bank allows B- and O+)",
        order.Request("REQ-C", "B+", compat.PLATELETS, units_needed=1),
        register,
        PLATELET_REPLIES,
        policy=Policy(platelet_allowlist={"B+": frozenset({"B-", "O+"})}),
    )

    # The recall query: whose blockers lift in the next thirty days.
    from ..policy import becoming_eligible_between

    upcoming = becoming_eligible_between(
        register, "A+", compat.RED_CELLS, TODAY, TODAY + timedelta(days=30)
    )
    print("\n=== donors becoming eligible in the next 30 days ===")
    for decision in upcoming:
        print(
            f"  {decision.donor_ref}: eligible {decision.eligible_from} "
            f"(currently {', '.join(decision.reasons)})"
        )
    print(f"  {len(upcoming)} donors nobody is currently planning to call")

    total_calls = whole_blood.calls_placed + platelets.calls_placed + widened.calls_placed
    print(
        f"\nthree shortages served with {total_calls} calls against a register of "
        f"{len(register)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

