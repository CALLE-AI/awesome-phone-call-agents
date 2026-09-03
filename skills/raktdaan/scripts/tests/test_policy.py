"""Eligibility tests.

Two properties matter more than the rest and are tested hardest:

- Fail closed. Missing data must suppress the call, never permit it.
- eligible_from must be a real date or absent. A wrong date here means a blood
  bank rings someone who still cannot donate, which is the exact failure the
  skill exists to prevent.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raktdaan import compat
from raktdaan import policy as p

TODAY = date(2026, 9, 3)
ADULT_DOB = date(1995, 6, 15)
OK_CONSENT = p.Consent(recall_consent=True, recorded_on=date(2026, 1, 1))


def donor(**kw) -> p.Donor:
    """A donor who passes everything, so each test can break one thing."""
    base = dict(
        ref="R-001",
        phone="+910000000001",
        group="A+",
        sex="M",
        date_of_birth=ADULT_DOB,
        weight_kg=68.0,
        last_hb_g_dl=14.2,
        last_whole_blood=TODAY - timedelta(days=200),
        consent=OK_CONSENT,
        language="Hindi",
    )
    base.update(kw)
    return p.Donor(**base)


def screen(d: p.Donor, need="A+", component=compat.RED_CELLS, on=TODAY, policy=None):
    return p.screen(d, need, component, on, policy)


def test_the_baseline_donor_is_callable() -> None:
    d = screen(donor())
    assert d.eligible, d.reasons
    assert d.reasons == ()

def test_missing_last_donation_fails_closed() -> None:
    d = screen(donor(last_whole_blood=None))
    assert not d.eligible
    assert p.UNKNOWN_LAST_DONATION in d.reasons
    # Waiting does not fix a gap in the register.
    assert d.eligible_from is None


def test_first_time_donor_is_not_punished_for_having_no_history() -> None:
    d = screen(donor(last_whole_blood=None, first_time_donor=True))
    assert d.eligible, d.reasons


def test_interdonation_interval_is_sex_specific() -> None:
    # 100 days since last whole blood: clear for a man, not for a woman.
    recent = TODAY - timedelta(days=100)
    assert screen(donor(sex="M", last_whole_blood=recent)).eligible
    female = screen(donor(sex="F", last_whole_blood=recent, last_hb_g_dl=13.0))
    assert not female.eligible
    assert p.INTERDONATION_INTERVAL in female.reasons
    assert female.eligible_from == recent + timedelta(days=120)


def test_unrecorded_sex_gets_the_longer_interval() -> None:
    recent = TODAY - timedelta(days=100)
    d = screen(donor(sex=None, last_whole_blood=recent))
    assert not d.eligible
    assert p.INTERDONATION_INTERVAL in d.reasons


def test_platelet_regime_is_days_not_months() -> None:
    # Donated platelets 5 days ago and whole blood a year ago: callable again.
    d = screen(
        donor(
            last_plateletpheresis=TODAY - timedelta(days=5),
            last_whole_blood=TODAY - timedelta(days=365),
        ),
        component=compat.PLATELETS,
    )
    assert d.eligible, d.reasons

    # Yesterday is inside the 48h window.
    d = screen(
        donor(
            last_plateletpheresis=TODAY - timedelta(days=1),
            last_whole_blood=TODAY - timedelta(days=365),
        ),
        component=compat.PLATELETS,
    )
    assert p.APHERESIS_INTERVAL in d.reasons
    assert d.eligible_from == TODAY + timedelta(days=1)

def test_recent_whole_blood_blocks_plateletpheresis() -> None:
    d = screen(
        donor(last_whole_blood=TODAY - timedelta(days=30)),
        component=compat.PLATELETS,
    )
    assert p.CROSS_COMPONENT_INTERVAL in d.reasons


def test_recent_plateletpheresis_briefly_blocks_whole_blood() -> None:
    d = screen(donor(last_plateletpheresis=TODAY))
    assert p.CROSS_COMPONENT_INTERVAL in d.reasons
    assert d.eligible_from == TODAY + timedelta(days=2)


def test_annual_apheresis_cap_binds_and_is_not_time_resolvable() -> None:
    d = screen(
        donor(
            last_plateletpheresis=TODAY - timedelta(days=10),
            last_whole_blood=TODAY - timedelta(days=400),
            plateletpheresis_in_last_year=24,
        ),
        component=compat.PLATELETS,
    )
    assert p.APHERESIS_ANNUAL_CAP in d.reasons
    assert d.eligible_from is None


def test_permanent_deferral_never_resolves() -> None:
    d = screen(donor(deferrals=(p.Deferral("hepatitis_b", date(2019, 3, 1)),)))
    assert p.DEFERRAL_PERMANENT in d.reasons
    assert d.eligible_from is None


def test_temporary_deferral_expiry_is_computed_from_the_start_date() -> None:
    started = TODAY - timedelta(days=100)
    d = screen(donor(deferrals=(p.Deferral("tattoo", started),)))
    assert p.DEFERRAL_ACTIVE in d.reasons
    assert d.eligible_from == started + timedelta(days=180)

    # Same tattoo, 200 days ago: window has closed.
    old = screen(donor(deferrals=(p.Deferral("tattoo", TODAY - timedelta(days=200)),)))
    assert old.eligible, old.reasons


def test_undated_deferral_never_expires() -> None:
    d = screen(donor(deferrals=(p.Deferral("malaria", None),)))
    assert p.DEFERRAL_ACTIVE in d.reasons
    assert d.eligible_from is None


def test_unrecognised_deferral_reason_is_not_treated_as_harmless() -> None:
    d = screen(donor(deferrals=(p.Deferral("something_nobody_coded", TODAY - timedelta(days=9999)),)))
    assert p.DEFERRAL_ACTIVE in d.reasons

def test_opt_out_outranks_everything() -> None:
    d = screen(donor(consent=p.Consent(recall_consent=True, opted_out=True)))
    assert not d.eligible
    assert p.OPTED_OUT in d.reasons
    assert d.eligible_from is None


def test_absent_consent_is_not_consent() -> None:
    assert p.NO_CONSENT in screen(donor(consent=p.Consent())).reasons


def test_phone_numbers_are_never_repaired() -> None:
    # Every number here is +910000..., which no real Indian mobile can be:
    # Indian mobiles are ten digits beginning 6, 7, 8 or 9.
    for bad in (None, "", "9100000001", "+91 00000 00001", "+91-0000000001", "+abc"):
        assert p.NO_PHONE in screen(donor(phone=bad)).reasons, bad
    assert p.NO_PHONE not in screen(donor(phone="+910000000001")).reasons


def test_age_bounds_and_the_eighteenth_birthday_recall() -> None:
    minor_dob = date(2010, 4, 20)
    d = screen(donor(date_of_birth=minor_dob, first_time_donor=True, last_whole_blood=None))
    assert p.UNDER_AGE in d.reasons
    assert d.eligible_from == date(2028, 4, 20)

    assert p.OVER_AGE in screen(donor(date_of_birth=date(1950, 1, 1))).reasons
    assert p.UNKNOWN_AGE in screen(donor(date_of_birth=None)).reasons
    assert screen(donor(date_of_birth=None)).eligible_from is None


def test_weight_and_haemoglobin() -> None:
    assert p.UNDERWEIGHT in screen(donor(weight_kg=42.0)).reasons
    assert p.UNKNOWN_WEIGHT in screen(donor(weight_kg=None)).reasons
    assert p.LOW_LAST_HB in screen(donor(sex="M", last_hb_g_dl=12.6)).reasons
    # The same reading passes for a woman: the thresholds differ.
    assert p.LOW_LAST_HB not in screen(donor(sex="F", last_hb_g_dl=12.6)).reasons
    # Missing Hb is permitted by default, and blocking when asked to block.
    assert screen(donor(last_hb_g_dl=None)).eligible
    strict = p.Policy(require_known_hb=True)
    assert p.LOW_LAST_HB in screen(donor(last_hb_g_dl=None), policy=strict).reasons


def test_group_incompatibility_is_component_specific() -> None:
    # B+ cannot give red cells to an A+ patient.
    assert p.GROUP_INCOMPATIBLE in screen(donor(group="B+"), need="A+").reasons
    # O- can.
    assert p.GROUP_INCOMPATIBLE not in screen(donor(group="O-"), need="A+").reasons
    # For platelets, even A- is refused without an explicit allowlist.
    d = screen(donor(group="A-"), need="A+", component=compat.PLATELETS)
    assert p.GROUP_INCOMPATIBLE in d.reasons

def test_fatigue_budget_blocks_and_says_when_it_lifts() -> None:
    rung = TODAY - timedelta(days=10)
    d = screen(donor(recent_call_dates=(rung,)))
    assert p.FATIGUE_BUDGET in d.reasons
    assert d.eligible_from == rung + timedelta(days=90)
    # A call outside the window does not count.
    assert screen(donor(recent_call_dates=(TODAY - timedelta(days=200),))).eligible


def test_multiple_reasons_are_all_reported_in_canonical_order() -> None:
    d = screen(
        donor(
            group="B+",
            weight_kg=40.0,
            last_whole_blood=TODAY - timedelta(days=10),
            deferrals=(p.Deferral("tattoo", TODAY - timedelta(days=5)),),
        ),
        need="A+",
    )
    assert p.UNDERWEIGHT in d.reasons
    assert p.DEFERRAL_ACTIVE in d.reasons
    assert p.INTERDONATION_INTERVAL in d.reasons
    assert p.GROUP_INCOMPATIBLE in d.reasons
    order = [p.SUPPRESSION_CODES.index(c) for c in d.reasons]
    assert order == sorted(order), d.reasons
    # Underweight is not time-resolvable, so no date is promised.
    assert d.eligible_from is None


def test_suppression_histogram_counts_only_what_happened() -> None:
    decisions = [
        screen(donor(ref="a", weight_kg=40.0)),
        screen(donor(ref="b", weight_kg=40.0)),
        screen(donor(ref="c", group="B+"), need="A+"),
        screen(donor(ref="d")),
    ]
    hist = p.suppression_histogram(decisions)
    assert hist == {p.UNDERWEIGHT: 2, p.GROUP_INCOMPATIBLE: 1}


def test_recall_window_finds_the_cohort_nobody_calls() -> None:
    # Three donors whose deferrals lift on different days.
    roster = [
        donor(ref="lifts-soon", deferrals=(p.Deferral("tattoo", TODAY - timedelta(days=175)),)),
        donor(ref="lifts-later", deferrals=(p.Deferral("tattoo", TODAY - timedelta(days=100)),)),
        donor(ref="never", deferrals=(p.Deferral("hiv", TODAY - timedelta(days=900)),)),
    ]
    found = p.becoming_eligible_between(
        roster, "A+", compat.RED_CELLS, TODAY, TODAY + timedelta(days=14)
    )
    assert [d.donor_ref for d in found] == ["lifts-soon"]
    assert found[0].eligible_from == TODAY + timedelta(days=5)

def test_policy_thresholds_are_actually_honoured_when_overridden() -> None:
    # A bank running the looser 28-day whole-blood-to-apheresis rule.
    loose = p.Policy(whole_blood_to_apheresis_days=28)
    d = screen(
        donor(last_whole_blood=TODAY - timedelta(days=30)),
        component=compat.PLATELETS,
        policy=loose,
    )
    assert d.eligible, d.reasons
    # And the conservative default refuses the same donor.
    assert not screen(
        donor(last_whole_blood=TODAY - timedelta(days=30)), component=compat.PLATELETS
    ).eligible


def test_platelet_allowlist_widens_only_when_the_bank_says_so() -> None:
    widened = p.Policy(platelet_allowlist={"A+": frozenset({"A-"})})
    d = screen(
        donor(group="A-", last_plateletpheresis=None, last_whole_blood=TODAY - timedelta(days=400)),
        need="A+",
        component=compat.PLATELETS,
        policy=widened,
    )
    assert p.GROUP_INCOMPATIBLE not in d.reasons, d.reasons


def test_next_eligible_date_is_the_screen_answer() -> None:
    recent = TODAY - timedelta(days=10)
    d = donor(last_whole_blood=recent)
    assert p.next_eligible_date(d, "A+", compat.RED_CELLS, TODAY) == recent + timedelta(days=90)


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - reporting harness
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok   {name}")
    print("\n" + ("all eligibility tests passed" if not failures else f"{failures} failed"))
    sys.exit(1 if failures else 0)
