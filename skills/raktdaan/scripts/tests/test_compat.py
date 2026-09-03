"""Compatibility matrices are the kind of thing that looks right and is wrong.

These tests assert the textbook facts independently of how compat.py builds
its tables, so a transcription error in the matrices fails here rather than on
a phone call.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raktdaan import compat as c


def test_red_cells_universal_donor_and_recipient() -> None:
    # O- red cells go to everyone; nobody else's go to an O- recipient.
    for recipient in c.ALL_GROUPS:
        assert "O-" in c.RED_CELL_DONORS[recipient], recipient
    assert c.callable_groups("O-", c.RED_CELLS) == frozenset({"O-"})
    # AB+ takes red cells from all eight.
    assert c.callable_groups("AB+", c.RED_CELLS) == frozenset(c.ALL_GROUPS)


def test_red_cells_the_case_a_naive_register_gets_wrong() -> None:
    assert c.callable_groups("A+", c.RED_CELLS) == frozenset({"A+", "A-", "O+", "O-"})
    assert c.callable_groups("B+", c.RED_CELLS) == frozenset({"B+", "B-", "O+", "O-"})
    assert c.callable_groups("AB-", c.RED_CELLS) == frozenset({"AB-", "A-", "B-", "O-"})


def test_rh_negative_recipients_never_get_rh_positive_red_cells() -> None:
    for recipient in ("O-", "A-", "B-", "AB-"):
        for donor in c.callable_groups(recipient, c.RED_CELLS):
            assert c.rh(donor) == "-", f"{recipient} <- {donor}"


def test_plasma_runs_opposite_to_red_cells() -> None:
    # AB is the universal plasma donor, O the universal plasma recipient --
    # the exact inverse of the red cell picture.
    o_can_receive = c.callable_groups("O+", c.PLASMA)
    assert o_can_receive == frozenset(c.ALL_GROUPS)
    ab_can_receive = c.callable_groups("AB+", c.PLASMA)
    assert {c.abo(g) for g in ab_can_receive} == {"AB"}
    assert {c.abo(g) for g in c.callable_groups("A-", c.PLASMA)} == {"A", "AB"}


def test_platelets_fail_closed_to_identical() -> None:
    for group in c.ALL_GROUPS:
        assert c.callable_groups(group, c.PLATELETS) == frozenset({group})
    widened = c.callable_groups(
        "B+", c.PLATELETS, platelet_allowlist={"B+": frozenset({"B-", "O+"})}
    )
    assert widened == frozenset({"B+", "B-", "O+"})


def test_whole_blood_is_identical_not_the_red_cell_matrix() -> None:
    assert c.callable_groups("A+", c.WHOLE_BLOOD) == frozenset({"A+"})


def test_breadth_ranks_substitutability() -> None:
    assert c.breadth("O-", c.RED_CELLS) == 8
    assert c.breadth("AB+", c.RED_CELLS) == 1
    assert c.breadth("O+", c.RED_CELLS) == 4
    # Plasma inverts it.
    assert c.breadth("AB+", c.PLASMA) == 8
    assert c.breadth("O-", c.PLASMA) == 2


def test_ordering_preserves_the_scarce_donor() -> None:
    order = c.order_donor_groups("A+", c.RED_CELLS)
    assert order[0] == "A+", order
    assert order[-1] == "O-", order
    assert set(order) == {"A+", "A-", "O+", "O-"}

    # An AB+ need can draw on anyone, so it is the strongest test that we do
    # not simply reach for the universal donor.
    order = c.order_donor_groups("AB+", c.RED_CELLS)
    assert order[0] == "AB+", order
    assert order[-1] == "O-", order

    # Plasma: O- plasma is nearly worthless outside group O, AB+ is precious.
    order = c.order_donor_groups("O+", c.PLASMA)
    assert order[-1] in ("AB+", "AB-"), order


def test_matrices_are_internally_consistent() -> None:
    for component in (c.RED_CELLS, c.PLASMA, c.WHOLE_BLOOD):
        for need in c.ALL_GROUPS:
            for donor in c.callable_groups(need, component):
                assert donor in c.ALL_GROUPS
            # A group is always compatible with itself.
            assert need in c.callable_groups(need, component), (component, need)


def test_rejects_nonsense_input() -> None:
    for bad in ("A", "O++", "", "AB", "x"):
        try:
            c.callable_groups(bad, c.RED_CELLS)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted bad group {bad!r}")
    try:
        c.callable_groups("A+", "cryoprecipitate")
    except ValueError:
        pass
    else:
        raise AssertionError("accepted unknown component")


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - reporting harness
            failures += 1
            print(f"FAIL {name}: {exc}")
        else:
            print(f"ok   {name}")
    print("\n" + ("all compatibility tests passed" if not failures else f"{failures} failed"))
    sys.exit(1 if failures else 0)
