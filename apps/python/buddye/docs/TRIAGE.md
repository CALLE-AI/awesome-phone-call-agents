# Triage: who is in danger from *this* hazard

`backend/app/domain/hazards.py` + `backend/app/domain/risk.py`. No model runs here. Tests: `tests/test_risk.py`.

The block captain has one evening and a phone. She has to be able to read a line like *"oxygen concentrator runs 4h on battery against an outage expected to last 6h — it stops about 2h before the power comes back"* and act on it without asking anyone what the software meant. So **every point in the score arrives attached to a sentence**, and the sentences are the product. The number is only how they sort.

## The one idea

**Risk is hazard-conditioned, not a property of a person.**

There is no "Rosa is a high-risk neighbour" field anywhere in this system, because it would be wrong half the time. The engine is a matrix — *(hazard kind, severity) × (neighbour attributes) → contributions* — and the same roster reorders completely when the hazard changes.

| | Heat warning · 114F · 41% RH | Power outage · 6h est. · 108F |
| --- | --- | --- |
| **Rosa Delgado** — 75+, alone, swamp cooler, no car | **100 · critical** | 68 · high |
| **Walter Brzezinski** — 65-74, alone, oxygen concentrator, 4h battery, wheelchair | 87 · critical | **100 · critical · 4.0h to harm** |
| Hazel Nakamura — 82, bedbound, insulin in the fridge | 86 · critical | 93 · critical |
| Ernesto Salgado — 65-74, alone, fan only, no car | 92 · critical | 62 · high |

Rosa's top reason under heat:

> cools with a swamp cooler and humidity is 41% — an evaporative cooler loses most of its cooling in damp air, so at 114F that house may only be a few degrees below outside

Walter's under the outage:

> oxygen concentrator runs 4h on battery against an outage expected to last 6h — it stops about 2h before the power comes back

Neither ordering is written down anywhere. Both come out of the same rules over the same rows.

## Parsing the hazard first

`hazards.parse_hazard()` turns a `Hazard` row — whose `facts` dict came from an NWS product, a utility outage map, or the captain's own eyes — into a frozen `HazardProfile`, once per sweep, so every neighbour is scored against exactly the same picture.

**Nothing in it raises.** A missing temperature, a `"114"` string from a form post, a hand-typed `outage_eta_h: "about six"` all degrade to `None`, and triage says so out loud in its reasons. A crash in hazard parsing means nobody on the roster gets called at all, which is far worse than an imprecise score.

The one piece of physics that lives here is the **evaporative-cooler curve**. A swamp cooler cools by evaporating water into the airstream, so its output tracks wet-bulb temperature: in dry Phoenix air it can drop a room 25F, and when the monsoon pushes humidity into the forties it drops it a few degrees and adds damp. `evaporative_effectiveness(humidity_pct) → 0..1` is monotonically non-increasing in humidity — damper air can never make a swamp cooler work better — and a missing humidity reading returns a middling value rather than optimism. That is why *"108F at 15% humidity"* and *"108F at 45% humidity"* are not the same hazard for Rosa, and why the humidity field is not decoration.

Derived facts the profile exposes: `cuts_power`, `may_evacuate`, `swamp_cooler_compromised`, `apparent_temp_f`, `outage_eta_h()` (with a flag saying whether the estimate was **assumed** rather than given), `severity_weight`, plus `label()`, `speakable_facts()` and `describe()` — the last three so the *caller* says the same thing the scorer computed on.

## How a score is built

1. **The hazard's rule runs** (`_heat_rule`, `_cold_rule`, `_power_outage_rule`, `_evacuation_family_rule` for flood/smoke/storm, `_boil_water_rule`, `_generic_rule` for a kind we have no rules for). Each appends unscaled `(points, reason)` pairs.
2. **Severity multiplies the lot.** `SEVERITY_WEIGHT`: advisory 0.6, watch 0.8, warning 1.0, emergency 1.25. Rules state what a situation is worth in a full-blown warning; an advisory does not get its own hand-tuned constants, and nobody can quietly retune one hazard into another's thresholds.
3. **The subtotal is capped at 85** before amplifiers. Without that ceiling a long conditions list would multiply through and land half the roster at an undifferentiated 100, which tells a captain nothing about who to ring first.
4. **Amplifiers**, applied to the subtotal and never to a subtotal of zero — living alone is not a danger in itself, it is what turns somebody else's bad night into an unwitnessed one:
   - `lives_alone` +25%
   - age: 75+ +20%, 65-74 +10%, unknown +5%
5. **Base points (4).** Everyone on the roster is worth a call; a zero would read as "no need to ring her".
6. **The ceiling and any band floor are added as visible factors**, so the invariant holds: **the score always equals the sum of its reasons.** A silent clamp would break the breakdown that makes this auditable.

Bands: `critical ≥ 70`, `high ≥ 45`, `elevated ≥ 25`, `routine ≥ 0`.

### Band floors

Some situations are critical no matter what the arithmetic says, and a constant retuned next week must not be able to drop them. `hold_at()` pins a minimum band and records why:

- *"oxygen concentrator is dead the moment the power is"* → critical
- *"oxygen concentrator fails before the power returns"* → critical
- *"battery margin is under two hours"* → high
- *"on life-support equipment during an outage"* → elevated

### Time to harm

`_power_dependency_rule` is the sharpest thing the engine knows, and it is a subtraction rather than a flag:

| Situation | Points | Floor | `time_to_harm_h` |
| --- | --- | --- | --- |
| no battery at all | 55 | critical | 0 |
| battery < outage estimate | 48 | critical | the battery hours |
| battery < estimate + 2h | 30 | high | the battery hours |
| battery comfortably covers it | 16 | elevated | the battery hours |

Eight hours of battery against a two-hour outage is a phone call. Two hours against a six-hour outage is a countdown. When the hazard carried **no** restoration estimate, one is assumed from severity and a **zero-point factor** goes into the list saying so — the captain must be able to see which numbers were ours.

`time_to_harm_h: null` means **no clock, not no risk**. Hazel's insulin is in a refrigerator, not in a machine with a battery: she scores on the medication and gets no countdown, because flagging her `power_dependent` would invent a deadline she does not have.

## Vocabulary that a volunteer typed

`conditions` is a free list of strings written by whoever filled in the card: `"COPD"`, `"heat sensitive"`, `"oxygen-dependent"`, `"insulin"`. Everything is normalised to a canonical token, and — this is the load-bearing part — **an unrecognised condition never scores zero**:

- a condition this hazard has a rule for → the table value (COPD is 10 in heat and **30** in smoke; read a column and you can see why the same person moves)
- a known condition this hazard has no rule for → 3 points, *"medication that has to stay refrigerated on file"*
- a condition we do not recognise at all → 5 points and the card quoted back verbatim: *`"high blood pressure" on file — BuddyE has no rule for that one, so it is scored conservatively and left for you to read*

Scoring an unrecognised health condition as zero is the one failure mode this product cannot have.

The same normalisation applies to `cooling`, `heating`, `mobility` and `age_band`, and for the same reason: "evaporative cooler", "evap" and "swamp cooler" are the same box on the same roof, and if triage matched only one spelling then Rosa's cooler would quietly become a generic unknown and the single most important fact about her house would drop out of both her score and her reasons.

## Order is the part that survives contact with reality

`call_order(roster, hazard)` returns neighbour ids, worst first. Sorting is `(-score, time_to_harm_h, name, id)` — deterministic to the last field, so a shuffled roster cannot reorder, and at equal scores a two-hour battery outranks an eight-hour one.

The [signup allowance](https://www.heycall-e.com/) is 100 credits, not a fixed number of calls; a volunteer's evening is shorter than her list, and a sweep can die halfway through on a flat phone battery. **Whatever fraction of the roster actually gets called has to be the right fraction.** If only six calls happen tonight, those six should be the six where a call changes the outcome.

People who never opted in are **dropped here**, not sorted to the bottom, so no downstream code path can dial them by walking one index too far. Consent is then checked a second time on the row at the moment of dialling: a guard that exists only one layer up is one an off-by-one gets past, and the thing on the other side of it is somebody's phone ringing after they said no.

`triage()` returns the *whole* roster including the people who will not be dialled, each with `may_call` and `skip_reason`, because the captain still needs to see them.

## Nothing raises

Unparseable facts, an unrecognised condition token, a neighbour dict missing half its keys: everything degrades to a conservative score with a reason naming what was not understood. A triage crash means the whole roster goes uncalled, which is the worst outcome available to this system.

## Privacy

`RiskAssessment.to_dict()` — what lands in `Sweep.triage[neighbour_id]` and `CheckCall.risk_snapshot` — contains health facts about a named person **by design**. That is what the captain needs, and redacting "oxygen concentrator" out of a reason would destroy the product. Redaction happens at egress (`app.obs.redact`), never in the engine.

The call contract deliberately does **not** get this object. `NeighbourView` is thin on purpose: derived facts only, no conditions, no medications, no address. See [`CALL-CONTRACT.md`](CALL-CONTRACT.md).
