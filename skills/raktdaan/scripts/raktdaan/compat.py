"""Blood group compatibility, resolved per component.

Two rules that a naive donor register gets wrong:

1. Compatibility is wider than identity. An A+ red cell request is servable by
   A+, A-, O+ and O-. Searching the register for "A+" discards three quarters
   of the callable pool.

2. Compatibility runs in opposite directions for red cells and plasma. Group O
   is the universal red cell donor and the *worst* plasma donor; AB is the
   reverse. A single matrix cannot serve both.

Everything here decides *whom to call*. Nothing here decides what a patient
receives -- that is the blood bank's call, made at the bedside with the full
record in front of them. See references/compatibility.md.
"""

from __future__ import annotations

ALL_GROUPS: tuple[str, ...] = ("O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+")

RED_CELLS = "red_cells"
PLATELETS = "platelets"
PLASMA = "plasma"
WHOLE_BLOOD = "whole_blood"

COMPONENTS: tuple[str, ...] = (RED_CELLS, PLATELETS, PLASMA, WHOLE_BLOOD)

# recipient group -> donor groups whose red cells they may receive
RED_CELL_DONORS: dict[str, frozenset[str]] = {
    "O-": frozenset({"O-"}),
    "O+": frozenset({"O-", "O+"}),
    "A-": frozenset({"O-", "A-"}),
    "A+": frozenset({"O-", "O+", "A-", "A+"}),
    "B-": frozenset({"O-", "B-"}),
    "B+": frozenset({"O-", "O+", "B-", "B+"}),
    "AB-": frozenset({"O-", "A-", "B-", "AB-"}),
    "AB+": frozenset(ALL_GROUPS),
}

# Whole blood is transfused as a unit, so it must be ABO/Rh identical in
# practice. It is not the red cell matrix.
WHOLE_BLOOD_DONORS: dict[str, frozenset[str]] = {g: frozenset({g}) for g in ALL_GROUPS}

# recipient ABO -> donor ABO whose plasma they may receive. Rh is not a
# consideration for plasma, so these keys are ABO only.
PLASMA_DONORS_ABO: dict[str, frozenset[str]] = {
    "O": frozenset({"O", "A", "B", "AB"}),
    "A": frozenset({"A", "AB"}),
    "B": frozenset({"B", "AB"}),
    "AB": frozenset({"AB"}),
}


def abo(group: str) -> str:
    """Strip the Rh sign: 'A+' -> 'A'."""
    return group.rstrip("+-")


def rh(group: str) -> str:
    return group[-1]


def _plasma_donors(need_group: str) -> frozenset[str]:
    permitted_abo = PLASMA_DONORS_ABO[abo(need_group)]
    return frozenset(g for g in ALL_GROUPS if abo(g) in permitted_abo)


def callable_groups(
    need_group: str,
    component: str,
    platelet_allowlist: dict[str, frozenset[str]] | None = None,
) -> frozenset[str]:
    """Donor groups worth calling for this need.

    Platelets default to ABO/Rh identical only. Platelet concentrates carry
    donor plasma and residual red cells, so compatibility runs in both
    directions at once, and Rh matters for Rh-negative recipients of
    childbearing age. Widening that is a clinical judgement belonging to the
    blood bank, so this fails closed: pass platelet_allowlist to widen it
    explicitly, per the bank's own SOP.
    """
    if need_group not in RED_CELL_DONORS:
        raise ValueError(f"unknown blood group: {need_group!r}")
    if component not in COMPONENTS:
        raise ValueError(f"unknown component: {component!r}")

    if component == RED_CELLS:
        return RED_CELL_DONORS[need_group]
    if component == WHOLE_BLOOD:
        return WHOLE_BLOOD_DONORS[need_group]
    if component == PLASMA:
        return _plasma_donors(need_group)

    identical = frozenset({need_group})
    if platelet_allowlist is None:
        return identical
    return identical | frozenset(platelet_allowlist.get(need_group, frozenset()))


def _matrix(component: str) -> dict[str, frozenset[str]]:
    if component == PLASMA:
        return {g: _plasma_donors(g) for g in ALL_GROUPS}
    if component == RED_CELLS:
        return RED_CELL_DONORS
    return WHOLE_BLOOD_DONORS


def breadth(donor_group: str, component: str) -> int:
    """How many of the eight recipient groups this donor can serve.

    Derived from the matrices rather than tabulated, so it cannot drift out of
    step with them. High breadth means hard to substitute: O- red cells serve
    all 8 recipients and AB plasma serves all 4 ABO recipients, which is
    exactly why neither should be spent on a need that a narrower donor could
    have covered.
    """
    if component == PLATELETS:
        return 1
    matrix = _matrix(component)
    return sum(1 for recipient in ALL_GROUPS if donor_group in matrix[recipient])


def donor_priority(donor_group: str, need_group: str, component: str) -> tuple[int, int]:
    """Sort key for call ordering. Lower is called first.

    Least substitutable donor last, ABO/Rh-identical first among equals. The
    effect is that an O- donor is never rung for an A+ request while any A+,
    A- or O+ donor remains uncalled.
    """
    return (breadth(donor_group, component), 0 if donor_group == need_group else 1)


def order_donor_groups(need_group: str, component: str, **kw) -> list[str]:
    """Callable groups for a need, in the order they should be spent."""
    groups = callable_groups(need_group, component, **kw)
    return sorted(groups, key=lambda g: (donor_priority(g, need_group, component), g))
