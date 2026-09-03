"""Eligibility, resolved before anyone is dialled.

The failure this exists to prevent: Indian tele-recruitment programmes report a
~76% "yes" rate on answered calls and under 10% conversion to actual donation.
A large share of that gap is people who were never able to donate that day --
still inside their interdonation interval, still inside a deferral window, or
the wrong group for the component that is actually short. They agree on the
phone because the caller had no way to know, and they are turned away at the
chair, or they simply do not come.

So the gate runs first, and it fails closed. Unknown eligibility is not
eligibility. A donor whose last donation date is missing from the register is
not called, because the alternative is calling someone who donated three weeks
ago and burning both the call and their goodwill.

Two things this deliberately does not do:

- It does not clear anyone medically. Last recorded haemoglobin orders the call
  list; it never substitutes for screening, which happens at the centre with a
  fresh sample. No output of this module may be read as a clinical statement.
- It does not hold numeric thresholds as truth. Indian guidance (NBTC/DGHS,
  Schedule F Part XIIB as amended 2020) differs from Western guidance, differs
  between states, and blood banks run their own SOPs on top. Every threshold
  lives in Policy with a cited default and is meant to be overridden.

See references/eligibility-policy.md for the citation behind each default.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

from . import compat

# Suppression reason codes. These are the histogram keys in the run report --
# the whole point of the skill is that it can say why it did not call someone,
# so they are a stable public vocabulary, not debug strings.
NO_PHONE = "no_phone"
NO_CONSENT = "no_consent"
OPTED_OUT = "opted_out"
UNKNOWN_AGE = "unknown_age"
UNDER_AGE = "under_age"
OVER_AGE = "over_age"
UNKNOWN_WEIGHT = "unknown_weight"
UNDERWEIGHT = "underweight"
LOW_LAST_HB = "low_last_hb"
UNKNOWN_LAST_DONATION = "unknown_last_donation"
INTERDONATION_INTERVAL = "interdonation_interval"
APHERESIS_INTERVAL = "apheresis_interval"
APHERESIS_ANNUAL_CAP = "apheresis_annual_cap"
CROSS_COMPONENT_INTERVAL = "cross_component_interval"
DEFERRAL_ACTIVE = "deferral_active"
DEFERRAL_PERMANENT = "deferral_permanent"
GROUP_INCOMPATIBLE = "group_incompatible"
FATIGUE_BUDGET = "fatigue_budget"

SUPPRESSION_CODES: tuple[str, ...] = (
    NO_PHONE, NO_CONSENT, OPTED_OUT, UNKNOWN_AGE, UNDER_AGE, OVER_AGE,
    UNKNOWN_WEIGHT, UNDERWEIGHT, LOW_LAST_HB, UNKNOWN_LAST_DONATION,
    INTERDONATION_INTERVAL, APHERESIS_INTERVAL, APHERESIS_ANNUAL_CAP,
    CROSS_COMPONENT_INTERVAL, DEFERRAL_ACTIVE, DEFERRAL_PERMANENT,
    GROUP_INCOMPATIBLE, FATIGUE_BUDGET,
)

# Temporary deferrals, in days from the start of the condition. Every one of
# these has a computable expiry, which is what makes deferral-expiry recall
# possible at all: the register already knows when each of these people becomes
# donatable again, and nobody calls them on that day.
DEFAULT_DEFERRAL_DAYS: dict[str, int] = {
    "alcohol": 1,
    "dental_extraction": 7,
    "fever": 14,
    "antibiotics": 14,
    "vaccination_inactivated": 14,
    "vaccination_live": 28,
    "malaria": 90,
    "minor_surgery": 180,
    "tattoo": 180,
    "piercing": 180,
    "typhoid": 365,
    "jaundice": 365,
    "major_surgery": 365,
    "pregnancy": 365,
    "breastfeeding": 365,
    "transfusion_received": 365,
    "rabies_vaccine": 365,
    "tuberculosis": 730,
}

# Permanent deferrals. Never called, never recalled, never counted as pool.
PERMANENT_DEFERRALS: frozenset[str] = frozenset({
    "hiv",
    "hepatitis_b",
    "hepatitis_c",
    "syphilis",
    "cancer",
    "insulin_dependent_diabetes",
    "cardiac_disease",
    "epilepsy",
    "iv_drug_use",
    "bleeding_disorder",
    "chronic_kidney_disease",
    "chronic_liver_disease",
})

@dataclass(frozen=True)
class Policy:
    """Thresholds, all overridable. Defaults follow Indian national guidance.

    Where sources disagree -- and whole-blood-to-apheresis is the worst case,
    ranging from 28 days to 3 months across Indian SOPs -- the default is the
    more conservative reading, because the cost of being wrong is a donor
    turned away at the chair.
    """

    min_age: int = 18
    max_age: int = 65
    min_weight_kg: float = 45.0
    min_hb_male_g_dl: float = 13.0
    min_hb_female_g_dl: float = 12.5

    # Whole blood interdonation interval. Longer for women on account of iron
    # stores; India sets 3 months for men and 4 for women.
    whole_blood_interval_days_male: int = 90
    whole_blood_interval_days_female: int = 120

    # Plateletpheresis. Platelets regenerate in days, not months, which is why
    # the interval is 48h -- but the annual cap still binds.
    apheresis_interval_days: int = 2
    apheresis_max_per_year: int = 24

    # Cross-component intervals.
    whole_blood_to_apheresis_days: int = 90
    apheresis_to_whole_blood_days: int = 2

    # Anti-fatigue budget: how often this donor may be *rung*, regardless of
    # whether they donated. A register that is called until it stops answering
    # is a register that has been destroyed.
    max_calls_per_fatigue_window: int = 1
    fatigue_window_days: int = 90

    # Treat a missing haemoglobin reading as disqualifying. Off by default:
    # many Indian registers simply do not carry it, and requiring it would
    # empty the callable pool rather than improve it.
    require_known_hb: bool = False

    deferral_days: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_DEFERRAL_DAYS))
    permanent_deferrals: frozenset[str] = PERMANENT_DEFERRALS

    # Platelet compatibility widening, per the bank's own SOP. Empty means
    # ABO/Rh identical only, which is the safe default.
    platelet_allowlist: dict[str, frozenset[str]] = field(default_factory=dict)

@dataclass(frozen=True)
class Deferral:
    """One recorded reason someone cannot donate, and when it started.

    Stored as reason plus start date rather than as a precomputed expiry, so
    that a change to policy re-dates every donor in the register instead of
    leaving stale expiries behind.
    """

    reason: str
    started_on: date | None = None
    permanent: bool = False
    override_days: int | None = None


@dataclass(frozen=True)
class Consent:
    """Consent to be contacted for recall, per DPDP Act 2023.

    Purpose-limited: consent to be recalled for donation is not consent to be
    contacted for anything else. opted_out is checked before dialling, never
    after, and it outranks everything including an active shortage.
    """

    recall_consent: bool = False
    opted_out: bool = False
    recorded_on: date | None = None


@dataclass(frozen=True)
class Donor:
    """A register entry. Deliberately holds no name.

    The skill never sources, guesses, completes or reformats a phone number --
    it comes from the blood bank's own consented register in E.164 or it is not
    called. ref is the bank's opaque record id, which is all that is needed to
    report an outcome back.
    """

    ref: str
    phone: str | None
    group: str
    sex: str | None = None
    date_of_birth: date | None = None
    weight_kg: float | None = None
    last_hb_g_dl: float | None = None
    last_whole_blood: date | None = None
    last_plateletpheresis: date | None = None
    plateletpheresis_in_last_year: int = 0
    deferrals: tuple[Deferral, ...] = ()
    consent: Consent = Consent()
    language: str | None = None
    recent_call_dates: tuple[date, ...] = ()
    # Distinguishes "has never donated" from "we did not write it down". Without
    # this, a missing last-donation date is ambiguous, and the fail-closed rule
    # would lock every first-time donor out of the pool forever.
    first_time_donor: bool = False

@dataclass(frozen=True)
class Decision:
    """Why this donor is or is not being called, and when they next could be."""

    donor_ref: str
    eligible: bool
    reasons: tuple[str, ...] = ()
    eligible_from: date | None = None

    @property
    def suppressed(self) -> bool:
        return not self.eligible


def age_years(dob: date, on: date) -> int:
    return on.year - dob.year - ((on.month, on.day) < (dob.month, dob.day))


def deferral_expiry(deferral: Deferral, policy: Policy) -> date | None:
    """When this deferral lifts. None means never, or not yet knowable.

    A deferral with no start date is treated as unexpired rather than expired.
    That is the fail-closed direction: an undated 'hepatitis' note in a register
    must not become callable just because nobody wrote down when.
    """
    if deferral.permanent or deferral.reason in policy.permanent_deferrals:
        return None
    if deferral.started_on is None:
        return None
    days = deferral.override_days
    if days is None:
        days = policy.deferral_days.get(deferral.reason)
    if days is None:
        # Unrecognised reason with a known start date: honour it, but for an
        # unbounded period. Unknown risk is not zero risk.
        return None
    return deferral.started_on + timedelta(days=days)


def active_deferrals(donor: Donor, on: date, policy: Policy) -> tuple[Deferral, ...]:
    active = []
    for d in donor.deferrals:
        expiry = deferral_expiry(d, policy)
        if expiry is None or expiry > on:
            active.append(d)
    return tuple(active)


def is_permanently_deferred(donor: Donor, policy: Policy) -> bool:
    return any(
        d.permanent or d.reason in policy.permanent_deferrals for d in donor.deferrals
    )

def _whole_blood_interval(donor: Donor, policy: Policy) -> int:
    """Women get the longer interval. An unrecorded sex gets it too."""
    if donor.sex and donor.sex.upper().startswith("M"):
        return policy.whole_blood_interval_days_male
    return policy.whole_blood_interval_days_female


def _interval_checks(
    donor: Donor, component: str, on: date, policy: Policy
) -> tuple[list[str], list[date]]:
    """Interdonation constraints for the component asked for.

    Returns reason codes plus the dates on which each failing constraint lifts,
    so a caller can ask "when could this person donate?" and get an answer
    rather than a boolean.
    """
    reasons: list[str] = []
    ready: list[date] = []
    wants_platelets = component == compat.PLATELETS

    if wants_platelets:
        if donor.last_plateletpheresis is not None:
            due = donor.last_plateletpheresis + timedelta(days=policy.apheresis_interval_days)
            if due > on:
                reasons.append(APHERESIS_INTERVAL)
                ready.append(due)
        if donor.plateletpheresis_in_last_year >= policy.apheresis_max_per_year:
            reasons.append(APHERESIS_ANNUAL_CAP)
        if donor.last_whole_blood is not None:
            due = donor.last_whole_blood + timedelta(days=policy.whole_blood_to_apheresis_days)
            if due > on:
                reasons.append(CROSS_COMPONENT_INTERVAL)
                ready.append(due)
        elif not donor.first_time_donor:
            reasons.append(UNKNOWN_LAST_DONATION)
        return reasons, ready

    if donor.last_whole_blood is not None:
        due = donor.last_whole_blood + timedelta(days=_whole_blood_interval(donor, policy))
        if due > on:
            reasons.append(INTERDONATION_INTERVAL)
            ready.append(due)
    elif not donor.first_time_donor:
        reasons.append(UNKNOWN_LAST_DONATION)

    if donor.last_plateletpheresis is not None:
        due = donor.last_plateletpheresis + timedelta(days=policy.apheresis_to_whole_blood_days)
        if due > on:
            reasons.append(CROSS_COMPONENT_INTERVAL)
            ready.append(due)
    return reasons, ready

def _min_hb(donor: Donor, policy: Policy) -> float:
    if donor.sex and donor.sex.upper().startswith("M"):
        return policy.min_hb_male_g_dl
    return policy.min_hb_female_g_dl


def _looks_like_e164(phone: str | None) -> bool:
    """Shape check only. Never repairs, completes or guesses a number."""
    if not phone or not phone.startswith("+"):
        return False
    digits = phone[1:]
    return digits.isdigit() and 8 <= len(digits) <= 15


def _fatigue_checks(donor: Donor, on: date, policy: Policy) -> tuple[list[str], list[date]]:
    window_start = on - timedelta(days=policy.fatigue_window_days)
    in_window = sorted(d for d in donor.recent_call_dates if d > window_start)
    if len(in_window) < policy.max_calls_per_fatigue_window:
        return [], []
    # The call that must age out before this donor may be rung again.
    binding = in_window[-policy.max_calls_per_fatigue_window]
    return [FATIGUE_BUDGET], [binding + timedelta(days=policy.fatigue_window_days)]


def screen(
    donor: Donor,
    need_group: str,
    component: str,
    on: date,
    policy: Policy | None = None,
    *,
    check_compatibility: bool = True,
) -> Decision:
    """Decide whether to call this donor for this need, today.

    Collects every applicable reason rather than stopping at the first, because
    "deferred and also the wrong group" is more useful to a blood bank than
    "deferred". Returns eligible_from where every failing constraint is
    date-bounded, which is what makes deferral-expiry recall computable.
    """
    policy = policy or Policy()
    reasons: list[str] = []
    ready: list[date] = []

    if not _looks_like_e164(donor.phone):
        reasons.append(NO_PHONE)
    if not donor.consent.recall_consent:
        reasons.append(NO_CONSENT)
    if donor.consent.opted_out:
        reasons.append(OPTED_OUT)

    if is_permanently_deferred(donor, policy):
        reasons.append(DEFERRAL_PERMANENT)

    if donor.date_of_birth is None:
        reasons.append(UNKNOWN_AGE)
    else:
        age = age_years(donor.date_of_birth, on)
        if age < policy.min_age:
            reasons.append(UNDER_AGE)
            # Recallable on their eighteenth birthday, which the register
            # already knows and nobody currently acts on.
            ready.append(
                date(
                    donor.date_of_birth.year + policy.min_age,
                    donor.date_of_birth.month,
                    donor.date_of_birth.day,
                )
            )
        elif age > policy.max_age:
            reasons.append(OVER_AGE)

    if donor.weight_kg is None:
        reasons.append(UNKNOWN_WEIGHT)
    elif donor.weight_kg < policy.min_weight_kg:
        reasons.append(UNDERWEIGHT)

    if donor.last_hb_g_dl is None:
        if policy.require_known_hb:
            reasons.append(LOW_LAST_HB)
    elif donor.last_hb_g_dl < _min_hb(donor, policy):
        reasons.append(LOW_LAST_HB)

    active = active_deferrals(donor, on, policy)
    if active:
        reasons.append(DEFERRAL_ACTIVE)
        expiries = [deferral_expiry(d, policy) for d in active]
        if all(e is not None for e in expiries):
            ready.append(max(e for e in expiries if e is not None))

    interval_reasons, interval_ready = _interval_checks(donor, component, on, policy)
    reasons.extend(interval_reasons)
    ready.extend(interval_ready)

    if check_compatibility:
        callable_for_need = compat.callable_groups(
            need_group, component, platelet_allowlist=policy.platelet_allowlist
        )
        if donor.group not in callable_for_need:
            reasons.append(GROUP_INCOMPATIBLE)

    fatigue_reasons, fatigue_ready = _fatigue_checks(donor, on, policy)
    reasons.extend(fatigue_reasons)
    ready.extend(fatigue_ready)

    if not reasons:
        return Decision(donor.ref, True, (), on)

    ordered = tuple(code for code in SUPPRESSION_CODES if code in reasons)
    # eligible_from is only meaningful when *every* blocker is one that time
    # alone clears. A permanent deferral, a withdrawn consent or a missing
    # weight never resolves by waiting, so promising a date would be a lie.
    if all(code in TIME_RESOLVABLE for code in ordered) and ready:
        return Decision(donor.ref, False, ordered, max(ready))
    return Decision(donor.ref, False, ordered, None)


# Blockers that time alone clears. Everything absent from this set needs a human
# to update the register, re-obtain consent, or reweigh the donor.
TIME_RESOLVABLE: frozenset[str] = frozenset({
    UNDER_AGE,
    DEFERRAL_ACTIVE,
    INTERDONATION_INTERVAL,
    APHERESIS_INTERVAL,
    CROSS_COMPONENT_INTERVAL,
    FATIGUE_BUDGET,
})


def next_eligible_date(
    donor: Donor,
    need_group: str,
    component: str,
    on: date,
    policy: Policy | None = None,
) -> date | None:
    """The day this donor becomes callable, or None if waiting will not help."""
    decision = screen(donor, need_group, component, on, policy)
    return decision.eligible_from


def becoming_eligible_between(
    donors: list[Donor],
    need_group: str,
    component: str,
    start: date,
    end: date,
    policy: Policy | None = None,
) -> list[Decision]:
    """Donors whose blockers lift inside a window -- the recall-mode query.

    The literature's highest-yield untapped moment is the donor whose deferral
    expired and who was never told. It is entirely computable from a register
    the blood bank already holds, and essentially nobody runs it.
    """
    out = []
    for donor in donors:
        decision = screen(donor, need_group, component, start, policy)
        if decision.eligible or decision.eligible_from is None:
            continue
        if start <= decision.eligible_from <= end:
            out.append(decision)
    return sorted(out, key=lambda d: (d.eligible_from or end, d.donor_ref))


def suppression_histogram(decisions: list[Decision]) -> dict[str, int]:
    """Counts per reason code, in the canonical order. The headline output.

    Every other calling skill reports what it did. The number that matters to a
    blood bank is how many people it correctly left alone, and why.
    """
    counts = {code: 0 for code in SUPPRESSION_CODES}
    for d in decisions:
        for code in d.reasons:
            counts[code] += 1
    return {code: n for code, n in counts.items() if n}

