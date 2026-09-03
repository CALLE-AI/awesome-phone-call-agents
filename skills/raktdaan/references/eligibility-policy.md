# Eligibility policy

Every default in `Policy`, what it means, and where it comes from. Overriding
these is the intended use, not a workaround — a blood bank runs its own SOP and
this table is a starting position, not an authority.

## Why the defaults are Indian

Donor-selection thresholds are not universal. India's differ from US and
European guidance on age ceiling, minimum weight, interdonation interval and
several deferral windows, and Indian states differ from each other. The defaults
here follow national guidance — the Drugs & Cosmetics Rules, Schedule F Part
XIIB (as amended 2020 by GSR 166(E)), and NBTC/DGHS donor-selection guidance —
because the skill is built for Indian registers and a Western default would
quietly mis-screen every donor in one.

Where sources disagree, the default takes the conservative end of the range. The
cost of being too strict is a call not placed. The cost of being too loose is a
donor who takes time off work, travels to the centre, and is turned away at the
chair — which costs the blood bank that donor for every future shortage.

## Donor thresholds

| Field | Default | Basis |
| --- | --- | --- |
| `min_age` | 18 | Statutory minimum for voluntary donation |
| `max_age` | 65 | National guidance upper limit for repeat donors |
| `min_weight_kg` | 45.0 | Floor for a 350 mL collection |
| `min_hb_male_g_dl` | 13.0 | Sex-specific convention, conservative — see below |
| `min_hb_female_g_dl` | 12.5 | Schedule F minimum |

Three of these carry caveats worth stating plainly.

**`max_age` = 65 is the repeat-donor ceiling.** Much Indian practice caps
first-time donors at 60 and allows 60–65 only for known repeat donors, often with
physician clearance. The skill does not model that split: it applies one ceiling
to everyone. A bank that enforces the split should either set `max_age = 60` and
accept losing its older repeat donors from the callable pool, or keep 65 and
screen the age band at the centre.

**`min_weight_kg` = 45.0 is the floor for the smallest standard collection.** A
450 mL whole-blood bag and plateletpheresis both commonly require more — 50 kg or
55 kg depending on the SOP. The skill holds a single weight threshold rather than
one per component, so a bank collecting 450 mL units or running apheresis should
raise this value rather than assume 45 kg covers it.

**The haemoglobin split is stricter than Schedule F.** Schedule F states a
minimum of 12.5 g/dL. The 13.0 g/dL male default follows the sex-specific
convention used by many Indian blood banks and by international practice, and is
deliberately the stricter reading. A bank following Schedule F literally sets
both values to 12.5.

Haemoglobin is used for **one** purpose: the last recorded reading gates and
orders the call list. It is not a screening result and the call never tells a
donor they are cleared. Screening happens at the centre on a fresh sample.

`require_known_hb` defaults to **False**. Many Indian registers simply do not
carry a haemoglobin figure, and requiring one would empty the callable pool
rather than improve it. This is the one place the skill does not fail closed, and
it is a deliberate exception: set it to `True` if your register is complete
enough that a missing reading is genuinely suspicious.

## Intervals

| Field | Default | Basis |
| --- | --- | --- |
| `whole_blood_interval_days_male` | 90 | 3 months between whole-blood donations |
| `whole_blood_interval_days_female` | 120 | 4 months — iron-store recovery |
| `apheresis_interval_days` | 2 | 48 hours between plateletpheresis procedures |
| `apheresis_max_per_year` | 24 | Annual plateletpheresis cap |
| `whole_blood_to_apheresis_days` | 90 | Conservative end of a wide range |
| `apheresis_to_whole_blood_days` | 2 | 48 hours |

The longer interval for women is about iron, not caution for its own sake:
menstrual iron loss on top of donation loss means a 3-month cycle depletes
stores that a 4-month cycle does not. **An unrecorded sex gets the longer
interval**, because guessing in the permissive direction is how you defer
someone at the chair for low haemoglobin.

**`whole_blood_to_apheresis_days` = 90 is the widest disagreement in the table.**
Indian SOPs range from 28 days to 3 months for whole blood → plateletpheresis.
90 is the conservative end. A bank running 28 days will find this default
suppressing donors it considers callable, and should override it — this is the
single most likely field to need changing.

**Known gap: the twice-weekly plateletpheresis limit is not enforced.** Standard
guidance caps plateletpheresis at 48-hour spacing, not more than twice in a week,
and not more than 24 times a year. The skill enforces the 48-hour spacing and the
annual cap; it does not model the weekly limit, because the register field it has
is a yearly count, not a dated procedure history. Two workarounds: set
`apheresis_interval_days = 3`, which makes the weekly limit unreachable, or pass
a register whose `last_plateletpheresis` is current. A bank with dated apheresis
history should add the check.

## Deferrals

Deferrals are stored as `{reason, started_on}` and never as a precomputed expiry
date. That is a deliberate choice: it means changing a policy value re-dates
every donor in the register at once, instead of leaving stale expiries behind in
records nobody thinks to recompute.

Temporary, in days from the start of the condition:

| Reason | Days | Reason | Days |
| --- | --- | --- | --- |
| `alcohol` | 1 | `tattoo` | 180 |
| `dental_extraction` | 7 | `piercing` | 180 |
| `fever` | 14 | `typhoid` | 365 |
| `antibiotics` | 14 | `jaundice` | 365 |
| `vaccination_inactivated` | 14 | `major_surgery` | 365 |
| `vaccination_live` | 28 | `pregnancy` | 365 |
| `malaria` | 90 | `breastfeeding` | 365 |
| `minor_surgery` | 180 | `transfusion_received` | 365 |
| | | `rabies_vaccine` | 365 |
| | | `tuberculosis` | 730 |

Permanent, never called and never counted as pool: `hiv`, `hepatitis_b`,
`hepatitis_c`, `syphilis`, `cancer`, `insulin_dependent_diabetes`,
`cardiac_disease`, `epilepsy`, `iv_drug_use`, `bleeding_disorder`,
`chronic_kidney_disease`, `chronic_liver_disease`.

**This table is representative, not a transcription of any single SOP.** Indian
guidance ranges on several entries — `tattoo` and `piercing` are given as 6
months in some SOPs and 12 in others, and the 180-day default here is the
permissive end of that particular disagreement. Replace `deferral_days` wholesale
with your bank's own table rather than trusting these numbers as authority.

### Three fail-closed rules in the deferral arithmetic

**An undated deferral never expires.** `deferral_expiry` returns `None` for a
deferral with no `started_on`. An undated "hepatitis" note in a register must not
become callable merely because nobody wrote down when it was recorded.

**An unrecognised reason is honoured indefinitely.** A deferral reason absent from
`deferral_days` and from `permanent_deferrals` — a bank's local code, a typo, a
free-text note — suppresses the donor with no expiry. Unknown risk is not zero
risk, and the alternative is a skill that silently ignores every reason it does
not recognise.

**A missing last-donation date suppresses the call.** Unless the register
explicitly says `first_time_donor: True`. That flag exists precisely to separate
"has never donated" from "we did not write it down"; without it the fail-closed
rule would lock every first-time registrant out of the pool permanently.

## Calling conduct

| Field | Default | Meaning |
| --- | --- | --- |
| `max_calls_per_fatigue_window` | 1 | Calls permitted per donor per window |
| `fatigue_window_days` | 90 | Length of that window |

This counts **calls placed**, not donations given. A donor who was rung and did
not answer has spent their budget. That is the point: the failure mode being
prevented is a register dialled until it stops answering, and a no-answer is
exactly the signal that starts happening.

The run report states how many donors this blocked, under `fatigue_budget`. It is
a hard constraint, not a preference — the runner ends a run unfilled rather than
exceed it, and says so.

**Quiet hours are a deployment constraint, not a `screen()` check.** TRAI's
TCCCPR framework and ordinary decency both rule out calls at night. `screen()`
takes a `date`, not a timestamp, so it cannot enforce a time-of-day rule and does
not pretend to. Whoever schedules the run is responsible for not starting one at
23:00. Stated here rather than left implied, because a documented constraint that
nothing enforces is worth knowing about.

## Suppression reason codes

Eighteen codes, and they are a stable public vocabulary rather than debug strings
— the histogram is the skill's headline output, so the keys are part of the
contract:

`no_phone`, `no_consent`, `opted_out`, `unknown_age`, `under_age`, `over_age`,
`unknown_weight`, `underweight`, `low_last_hb`, `unknown_last_donation`,
`interdonation_interval`, `apheresis_interval`, `apheresis_annual_cap`,
`cross_component_interval`, `deferral_active`, `deferral_permanent`,
`group_incompatible`, `fatigue_budget`.

`screen()` collects **every** applicable reason rather than returning at the
first, then orders them by the canonical code order. "Deferred, and also the
wrong group for this component" tells a blood bank something that "deferred"
does not.

## `eligible_from`, and when it is a lie

Six blockers are cleared by time alone: `under_age`, `deferral_active`,
`interdonation_interval`, `apheresis_interval`, `cross_component_interval`,
`fatigue_budget`.

`eligible_from` is populated **only** when every failing constraint is one of
those six. A missing weight, a withdrawn consent, a permanent deferral or an
incompatible group does not resolve by waiting, so returning a date would promise
something untrue. In those cases `eligible_from` is `None` and the donor does not
appear in a recall window at all — someone has to update the register.

The `under_age` case returns the donor's eighteenth birthday, which the register
already knows and essentially nobody acts on.

## Overriding

```python
from raktdaan.policy import Policy, DEFAULT_DEFERRAL_DAYS

bank_policy = Policy(
    whole_blood_to_apheresis_days=28,        # this bank's SOP
    min_weight_kg=50.0,                      # 450 mL collections
    min_hb_male_g_dl=12.5,                   # Schedule F, read literally
    deferral_days={**DEFAULT_DEFERRAL_DAYS, "tattoo": 365},
    platelet_allowlist={"B+": frozenset({"B+", "AB+"})},
)
```

`Policy` is frozen, so an override is a new object and the defaults cannot be
mutated out from under another run in the same process. Pass it to `screen()`,
`build_plan()`, `next_eligible_date()` and `becoming_eligible_between()`.

Fork the table, not the skill.
