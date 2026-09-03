# Compatibility

Which donor groups are worth calling for a shortage of a given component, and
why the answer is different for each component.

**This decides whom to call. It never decides what a patient receives.** Issue
and crossmatch are the blood bank's decisions, made with the full record in front
of them. Nothing in this file or in `compat.py` is a clinical statement, and no
output of the skill may be read as one.

## Why not just search for the group

An A+ red cell shortage is servable by A+, A-, O+ and O-. A register query for
`group == "A+"` finds roughly a quarter of the people who could have covered it.
That is the first of two mistakes a naive register makes.

The second: **compatibility runs in opposite directions for red cells and
plasma.** Group O is the universal red cell donor and the *worst* plasma donor;
AB is the exact reverse. One matrix cannot serve both, and a system that keeps
only one silently mis-screens every plasma request.

## Red cells

Recipient group → donor groups whose red cells they may receive:

| Need | Callable donor groups | Pool |
| --- | --- | --- |
| `O-` | O- | 1 |
| `O+` | O-, O+ | 2 |
| `A-` | O-, A- | 2 |
| `A+` | O-, O+, A-, A+ | 4 |
| `B-` | O-, B- | 2 |
| `B+` | O-, O+, B-, B+ | 4 |
| `AB-` | O-, A-, B-, AB- | 4 |
| `AB+` | all eight | 8 |

## Plasma

Rh is not a consideration for plasma, so the matrix is keyed on ABO alone and
then expanded across both Rh signs:

| Need ABO | Callable donor ABO |
| --- | --- |
| `O` | O, A, B, AB |
| `A` | A, AB |
| `B` | B, AB |
| `AB` | AB |

So an A+ plasma request is callable from A-, A+, AB- and AB+ — a different set of
four from the red cell case, overlapping it in only two groups.

## Whole blood

ABO/Rh identical, always. Whole blood is transfused as a unit — red cells and
plasma together — so it inherits the constraints of both, and the intersection of
the two matrices is identity. It is deliberately **not** the red cell matrix, and
conflating the two is the single most dangerous mistake available here.

## Platelets fail closed

Default: **ABO/Rh identical only.** Widening requires an explicit allowlist from
the blood bank.

Three reasons, and the third is the one that is easy to miss:

1. A platelet concentrate carries donor **plasma**, so the plasma direction
   applies — an O platelet unit brings anti-A and anti-B with it.
2. It carries residual **red cells**, so the red cell direction applies too.
   Compatibility therefore runs both ways at once, and the two directions
   disagree.
3. **Rh matters**, because residual red cells in a D-positive unit can
   immunise a D-negative recipient. For an Rh-negative recipient of childbearing
   age that is not a transfusion-reaction question, it is a future-pregnancy
   question.

The resolution of all three is a clinical judgement about a specific patient,
against a specific inventory, under time pressure. It does not belong in a
calling tool. So `callable_groups` returns `{need_group}` for platelets unless the
bank passes `platelet_allowlist`:

```python
Policy(platelet_allowlist={"B+": frozenset({"B+", "AB+"})})
```

The allowlist is additive to identical, keyed by need group. An absent key means
identical only for that need — a bank can widen B+ without widening anything else.

## Scarcity ordering

`breadth(donor_group, component)` counts how many of the eight recipient groups a
donor can serve. It is **derived by counting the matrices**, not tabulated
separately, so the two cannot drift apart — a correction to a matrix updates the
ordering automatically.

| Group | Red cell breadth | Plasma breadth |
| --- | --- | --- |
| `O-` | 8 | 2 |
| `O+` | 4 | 2 |
| `A-` | 4 | 4 |
| `A+` | 2 | 4 |
| `B-` | 4 | 4 |
| `B+` | 2 | 4 |
| `AB-` | 2 | 8 |
| `AB+` | 1 | 8 |

The mirror is the whole argument in one table. O- is the most substitutable-for
donor of red cells and nearly the least useful plasma donor; AB+ is the reverse.

High breadth means **hard to substitute**, so it sorts last:

```python
donor_priority = (breadth(donor_group, component),
                  0 if donor_group == need_group else 1)
```

Lower is called first. The consequence that matters: **an O- donor is never rung
for an A+ red cell request while any A+, A- or O+ donor is still uncalled.** Their
unit is the only thing that can cover an O- need, and spending it on a need three
other groups could have served is how a bank ends up short on the one group with
no substitute.

Ties are real, not a bug. For an A+ red cell request, A- and O+ both have breadth
4 — they are genuinely equally substitutable and the ordering falls through to
`order._rank`'s later keys (longest since last donation, then `ref`).

For whole blood and platelets, breadth is 1 for every group, so priority
degenerates to the identical/non-identical tiebreak and ordering is decided
entirely by time since last donation. With a platelet allowlist that is the
correct behaviour: identical donors are spent before allowlisted ones.

Uncalled donors whose breadth exceeds the need's are reported as `scarce_spared`
— the run's record of which scarce units it protected:

```
scarce donors left uncalled: A-x2, O+x1, O-x1
```

## What this deliberately does not model

No minor antigen systems — Kell, Duffy, Kidd, MNS. No antibody screen, no
autologous or directed-donation logic, no crossmatch, no inventory. Those belong
to the blood bank's own systems and to a serologist.

The claim here is narrow and checkable: given a component shortage and a
consented register, these are the donor groups worth a phone call, in the order
that spends the substitutable ones first.
