# Dispatch: sending something to an address

`backend/app/domain/fleet.py`, `app/orchestrator/{incidents,dispatch}.py`, `app/agents/`, `app/seed_assets.py`.
Tests: `tests/test_fleet.py`, `tests/test_agents.py`, `tests/test_incidents.py`, `tests/test_dispatch_api.py`.

The sweep half of BuddyE finds out who is in trouble. This half sends someone. It is the part of an
emergency operations centre that is not a phone call: a fleet, a queue of addresses, an argument
about which unit goes where, and the paperwork all of that generates.

One sentence carries the whole design:

> **Community resources auto-dispatch. Agency resources need a human.**

Sending a volunteer with a case of water to a hot house is a recoverable mistake — the worst case is
a wasted trip on a hot evening. A false ambulance call is not recoverable, because the unit that
rolls to Rosa's door is the unit that does not roll to somebody else's cardiac arrest. So the first
is committed by software and the second is prepared by software and committed by a person with a
name. Everything below is the machinery that makes that true rather than intended.

---

## The three objects

**`Asset`** — something a coordinator can actually move. A call sign (`WV-2`, `WATER-1`, `R-15`), a
kind, a crew, a list of capabilities, a capacity for the shift, a road speed, a base, and a live
`lat`/`lon` that is server state. Twelve of them are seeded — eight community, four agency — all from real Maryvale staging points.

**`Incident`** — a check-in that ended badly enough to need something done about it. Distinct from
the `Escalation` that raised it, and the distinction is the point: **an escalation is about reaching
a human being; an incident is about sending resources to an address.** Rosa's daughter is an
escalation. The water truck is an incident. They have different lifecycles, different failure modes
and different people watching them.

**`Dispatch`** — one asset committed to one incident, carrying the route, the distance, the ETA, the
provenance (`proposed_by`, `committed_by`, `authorised_by`), and — when a human said no — the
`decline_reason`.

## The fleet

Twelve units, seeded by `app/seed_assets.py` from five real places: the Maryvale Community Center /
Palo Verde Library campus at 51st & Campbell, the Cartwright Elementary School District #83 bus
yard, Phoenix Fire Stations 15 and 25, and the Maryvale Estrella Mountain police precinct. Look them
up; that is the point of using them. The crews are fictional and nobody is really driving, but every
mile and every minute this system quotes is computed from those coordinates.

| Call sign | Kind | Carries | Cap | Base | Human needed |
| --- | --- | --- | --- | --- | --- |
| `WV-1` | `WELLNESS_VAN` | assess, water, transport | 8 | Community Center | no |
| `WV-2` | `WELLNESS_VAN` | assess, water | 8 | Community Center | no |
| `RIDE-3` | `VOLUNTEER_DRIVER` | transport | 4 | Community Center | no |
| `RIDE-5` | `VOLUNTEER_DRIVER` | transport, wheelchair | 4 | Cartwright yard | no |
| `WATER-1` | `WATER_ICE_TRUCK` | water, ice | 20 | Community Center | no |
| `PWR-1` | `POWER_CART` | battery, power | 2 | Community Center | no |
| `NURSE-1` | `NURSE_OUTREACH` | assess, medication | 6 | Community Center | no |
| `SHUTTLE-1` | `COOLING_SHUTTLE` | transport, wheelchair | 12 | Cartwright yard | no |
| `R-15` | `EMS_UNIT` | medical, assess, transport | 1 | Fire Station 15 | **yes** |
| `R-25` | `EMS_UNIT` | medical, assess, transport | 1 | Fire Station 25 | **yes** |
| `E-15` | `FIRE_UNIT` | medical, assess, forced_entry | 1 | Fire Station 15 | **yes** |
| `812A` | `POLICE_WELFARE` | welfare_check, forced_entry | 2 | Maryvale precinct | **yes** |

Capabilities are written from what the vehicle can honestly do, and two of the entries are
deliberately narrower than they could be:

- **`NURSE-1` is a community asset and dispatches itself.** Ana Whitfield is a clinic nurse who
  volunteers evenings. She can assess a person and she can carry a prescription; she is *not* a
  paramedic and does not claim `medical`. A clinician looking in on a confused woman is an errand;
  it is not the thing the authorisation boundary exists to stop.
- **`E-15` does not claim `water`.** There is water on a fire engine and it is for fires. A
  coordinator who watched an engine win a water drop on capability match would stop trusting the
  board, and they would be right to.

`RIDE-3` is a minivan and does not claim `wheelchair`. `SHUTTLE-1` and `RIDE-5` do, which is what
makes "we can move somebody who cannot walk out" a true sentence rather than an aspiration.

## Which kinds need a human, exactly

`app/domain/state.py` is the single source of truth, and it is one function:

```python
AUTHORISATION_REQUIRED = frozenset({AssetKind.EMS_UNIT, AssetKind.FIRE_UNIT, AssetKind.POLICE_WELFARE})

def requires_authorisation(kind) -> bool:
    return AssetKind(kind) in AUTHORISATION_REQUIRED
```

**Needs a named human:** `EMS_UNIT`, `FIRE_UNIT`, `POLICE_WELFARE`.
**Auto-dispatchable:** `VOLUNTEER_DRIVER`, `WELLNESS_VAN`, `WATER_ICE_TRUCK`, `COOLING_SHUTTLE`,
`POWER_CART`, `NURSE_OUTREACH`.

Nothing re-derives that list. `app/api/assets.py` marks the board with it, `app/domain/fleet.py`
filters with it, `app/orchestrator/dispatch.py` stamps the row from it. A kind added later without
being added to the frozenset becomes auto-dispatchable, which is why the answer lives in one place
that is easy to audit rather than in six lists that look similar.

An unreadable kind fails **closed**: `fleet._AssetView` catches the `ValueError` and treats an
unknown kind as requiring authorisation, as does `app/api/assets.py:_agency`. Failing closed costs a
click. Failing open sends an unidentified vehicle on its own authority.

---

## From a bad call to an incident

`app/orchestrator/incidents.py` is a **reconciler, not a callback**. `sync_sweep(session, sweep_id)`
reads the escalations of a sweep and makes the incident table agree with them: one incident per
escalation, keyed on `escalation_id`, idempotent, runnable from anywhere at any time. A background
loop runs it every `INCIDENT_SYNC_S` seconds (default 2.0).

Hooking a listener onto the event bus was the obvious alternative and would have been worse in four
separate ways: "did the sweep produce incidents?" becomes a timing question; database work lands on
the event path SSE clients read; a 20-100 s model call could end up there too; and a subscriber
holds ids for rows a demo reset has just deleted. A reconciler has none of those. Run it twice and
nothing happens the second time. It is also the reason `app/orchestrator/runner.py` did not have to
be touched to add this entire layer.

Three rules on the incident row:

- **Priority never goes down.** A re-synced incident takes the graver of what it had and what the
  record now derives, and its needs are unioned rather than replaced. A coordinator who raised an
  incident by hand must not have a background pass quietly lower it.
- **Coordinates are copied, not joined.** `Incident.lat/lon/address` are written from the neighbour
  at open time, so an incident still describes the place a van was sent to even if the roster row is
  later edited.
- **An incident with no coordinates is opened anyway**, and `fleet.eligible` then refuses to consider
  anybody for it, loudly. A visible incident nobody can be dispatched to beats a silent one.

`stalled_incidents()` names the ones that are open, have had nothing sent, and could now be served by
somebody who has since come free. That list is the honest answer to "is anything stuck?".

---

## The deterministic engine

`app/domain/fleet.py`. No model, no network, no clock. Same rows in, same answer out — which is what
lets it be both the fallback and the referee.

Four functions, in the order a dispatch actually happens:

```python
needs = fleet.needs_for(incident, outcome=…, decision=…, result=…, risk=…, neighbour=…)
report = fleet.eligible(assets, incident, needs)        # -> candidates + exclusions
ranked = fleet.rank(report.candidates, priority=needs.priority)
check  = fleet.validate_choice(asset, incident, needs)  # the gate before anything is committed
```

### 1. `needs_for` — what has to physically arrive, and why

A `NeedSet` of `Need(capability, reason, life_safety)`. Every need carries the sentence that
justifies it, for the same reason every triage point does: the sentence is what a coordinator acts
on and the capability is only how it matches.

Derived, in weight order, from what the call actually established:

1. **What they said yes to.** `help_accepted` keys from the hazard's own offer list, mapped through
   `HELP_TO_CAPABILITY`. A person asking for a ride is the least ambiguous signal in this product.
   An offer key the fleet does not recognise is never dropped — somebody said yes to something, so
   it becomes an `assess` need with the unrecognised key quoted back.
2. **What the condition checks found.** `CHECK_TO_NEEDS` copies its polarity from
   `orchestrator.decide.CHECK_ALARM` rather than re-deriving it: for `too_hot` the alarming answer
   is `"yes"`, for `has_power` it is `"no"`, and inverting one of those would send water to the
   people who do not need it and nothing to the people who do.
3. **Power, equipment, and the clock triage put on it.** Equipment that has *stopped*
   (`equipment_working == "no"`) is the one derivation that is `life_safety` on its own: that is not
   a delivery, it is an emergency. Power off in a home that runs equipment off the wall is a
   `battery` need, life-safety when triage put them within two hours of harm.
4. **Silence.** `UNREACHABLE` in the critical band is a life-safety `welfare_check` need with
   `forced_entry` as a *preference*, because if there is no answer at the door then getting in is
   the next question and a volunteer cannot answer it.

Two shapes matter here. **Preferences never filter** — a wheelchair user's `wheelchair` preference
picks between two equal drivers and never excludes anybody, because a fleet that refuses to take a
wheelchair user anywhere when no lift is on shift has failed at the only thing that mattered. And
**notes** are things worth saying that nothing in the fleet can fix; a coordinator reads them.

`NeedSet` iterates as capability strings, so `list(needs)` is what goes straight onto
`Incident.needs` and `"water" in needs` reads the way it should.

### 2. `eligible` — who could legally take it

Legal means five things at once:

| Gate | Exclusion code |
| --- | --- |
| `AVAILABLE` and not already committed to something else | `status`, `committed` |
| carries at least one capability this incident needs | `capability` |
| has capacity left this shift | `capacity` |
| inside the radius for this priority | `radius` |
| for EMS/fire/police: the incident justifies an agency unit at all | `authorisation` |

plus `speed` (no road speed means no arrival time and nothing that can be promised to anybody) and
`no_location` / `no_needs` for an incident that cannot be answered.

**Exclusions are first-class output.** `eligible()` returns why each asset was passed over, by name,
with a code and a full sentence:

> *WV-2 is en route, not available*
> *R-15 is an agency unit and this incident does not justify one: it needs water, ice, and taking a
> crew off the street for that removes them from somebody else's emergency*

A coordinator who asks "why didn't you send WV-2?" and gets silence stops using the tool. The answer
has to already be on the screen.

Capability matching goes through `NEED_SATISFIED_BY` rather than string equality, because the
fleet's vocabulary is looser than the need vocabulary and always will be — volunteers wrote it.
`PWR-1` carries `["battery", "power"]`; `WV-1` carries `assess` and is exactly who does a door
knock. If a need could only be met by an identically-spelled capability, a welfare check in the
seeded demo would match no community asset at all and the only thing left standing would be the
police unit, which is precisely backwards.

Radius is priority-scaled, `RADIUS_BY_PRIORITY`: 15 miles at life safety, 4 at routine. At life
safety you take the unit that exists even if it is across the village; at routine you do not send a
van forty minutes for a case of water it could have dropped on its own block.

### 3. `rank` — the order to offer them in

`(eta_bucket, -fit, -spare_capacity, requires_authorisation, call_sign)`.

ETA is quantised into fixed bins before comparison — `ETA_TIE_MINUTES`, from 0.25 min at life safety
to 2 min at routine — so units arriving within one bin are a tie, and the tie is won by the vehicle
that can actually do the job rather than by floating-point noise. `fit` counts every met need double
a met preference. Agency units lose an otherwise exact tie, because they cannot move until a human
clicks and that click is time the ETA does not show.

The order is total down to the call sign. The same fleet always produces the same list, which is
what lets a model's answer be diffed against it and lets a coordinator learn what the machine will
say next.

### 4. `validate_choice` — the gate

Every proposal passes through it: the model's pick, a coordinator's manual override, and the
deterministic pick alike. It calls **the same `_evaluate`** that built the candidate list, and that
is not tidiness. A dispatch engine whose filter and whose gate can disagree will eventually commit
something the filter would have refused, and the disagreement will surface at the worst possible
moment.

The interesting return is `ok=True, requires_authorisation=True`: **legal to prepare, illegal to
send.** The caller writes it as `PROPOSED` and waits for a name.

### Priority

`INCIDENT_PRIORITY[outcome][band] -> 1..5`, 1 = life safety. It is written out as a table rather than
computed, so changing what counts as life safety is a visible edit. It must not contradict
`orchestrator.decide.PRIORITY`, the 0-100 score the captain's board already sorts on — two screens
disagreeing about who is most urgent is worse than either ordering being slightly wrong — so this
table is that score bucketed at 85/60/45/25, and `tests/test_fleet.py` asserts the two stay monotonic
with each other.

`UNREACHABLE` + `critical` is priority 1, alongside `URGENT`. Same inversion as the sweep half:
silence from somebody triage put hours from harm is unbounded, and a call you answered at least
tells you what is wrong.

Unknown inputs degrade toward *more* urgent. Not knowing what happened on a call is not evidence
that nothing did.

---

## The LLM proposes, deterministic code disposes

Same discipline as the reconciler, for the same reason, on the same gateway.

```
   fleet.eligible()          code filters to legal candidates only
        ↓
   dispatch_agent            the model ranks among those and writes one sentence
        ↓
   fleet.validate_choice()   code checks the choice is still legal
        ↓
   Dispatch(status=PROPOSED)
```

The model runs on TokenRouter (`https://api.tokenrouter.com/v1`, `z-ai/glm-5.3-free`), and the
client discipline in `app/agents/client.py` is lifted from `app/orchestrator/reconcile_glm.py` —
injectable client so tests never touch the network, `json_mode` with a fallback that fires **only**
on a gateway rejection (`is_response_format_rejection`) and never on a timeout, `extract_json_object`
tolerating markdown fences, and fail-open on every path.

`is_response_format_rejection` and `extract_json_object` are *imported* from the reconciler, not
copied. A second copy would drift from the tested one, and the drift would show up as a dropped
ambulance request rather than as a failing test.

### What the model cannot do

- **Invent an asset.** The shortlist is the whole world. An id that is not in it is refused and the
  deterministic pick is used.
- **Do arithmetic.** Distances and ETAs are given to it and copied back from the *record*, never from
  the reply. A model confidently wrong about a number would put a wrong ETA on a coordinator's
  screen, and they would plan around it once and then stop believing the screen.
- **Auto-dispatch an ambulance.** `requires_authorisation` is re-derived in the agent from
  `domain.state.requires_authorisation(kind)` — never copied from the candidate and never from the
  reply.
- **Break a sweep.** Every failure path returns the deterministic answer. No key, a timeout, a dead
  gateway, prose instead of JSON, a choice that does not validate: all of them land on
  `candidates[0]`, which is fleet's own top pick.

`dispatch_agent` deliberately does **not** re-sort the candidates. Fleet's rank weighs capability and
priority as well as ETA, and a second ranker quietly disagreeing with the first is exactly the
split-brain that makes a coordinator stop trusting the board.

### What the model actually adds

The judgment between two legal options, and the sentence that makes an agency request a single
informed click instead of a form. The nurse four minutes further out is the right call for the woman
who sounded confused; the water truck is right for the man who just needs water. Both are legal;
only one is right; the difference is in what she said, not in the arithmetic.

For an agency request the prompt sets an explicit standard, and it is worth quoting because it is the
part that keeps the request honest:

> Name what specifically about THIS person, RIGHT NOW, needs a paramedic rather than a neighbour with
> water — the finding, the condition it acts on, and how long it has been going on, in the record's
> own terms. "High risk", "elderly and alone", "to be safe" and "seems serious" are not
> justifications; they are why she was called in the first place.

**A model outage degrades the prose, never the dispatch.** Nobody watching the board can tell the
difference except that the justification is terser, and `Dispatch.reason` says which it was
(`source: model | deterministic`, plus `fallback_reason` when the model's answer was not used).

### No session is held across the model call

The free tier runs 20-100 s. SQLite is in WAL mode with a five-second busy timeout, and an open
transaction spanning that await would stall every other writer in the process. So `propose()` runs
in three phases: **read the world into plain dicts and close the session → await the agent →
reopen and re-validate against live rows.**

The re-validation is not belt and braces. It is the nurse who was committed to another incident
during the twenty seconds the model spent thinking. When the chosen unit has stopped being legal,
`propose()` falls back to whatever is legal *now*, writes an `OperatorAction` explaining the swap,
and puts `(re-picked at commit time: …)` in the dispatch reason.

### Every agent call leaves a row

`OperatorAction`: `hazard_id`, `incident_id`, `kind`, `agent`, `model`, `inputs`, `output`,
`rationale`, `latency_ms`, `error`, `accepted`, `accepted_by`, `created_at`.

Written on **every** path, including the ones where the model was never reached. "The model timed
out so the deterministic default was used" is one of the answers that has to be on the record.
`accepted` is `None` until a human reviews it, `True` when they authorise, `False` when they decline
— so the trail says not just what the machine proposed but whether a person agreed.

Emergency management runs on being able to say who decided what, when, on what basis. An agent that
assigns a truck without leaving that trail is not usable in this domain.

---

## The authorisation boundary

Two gates, and both are needed.

### Gate 1 — an agency unit is not merely flagged, it is not offered

`fleet._evaluate` refuses to *consider* an EMS, fire or police unit at all unless
`needs.agency_justified` is true. `_agency_justification` is deliberately narrow:

| Condition | Reason recorded |
| --- | --- |
| `equipment_working == "no"` | powered medical equipment they depend on has stopped |
| `is_safe_now == "no"` | they told us something is wrong right now |
| outcome is `URGENT` | the check-in came back urgent |
| `UNREACHABLE` + critical band | nobody answered and triage put them in the critical band |

Without this gate the arithmetic betrays the policy: `R-15` runs at 32 mph against a wellness van's
20, and on almost every street in Maryvale an ambulance wins a pure ETA race. A water drop would be
offered a rescue unit, a coordinator would be one click from approving it, and the click would take a
unit away from somebody else's emergency. **Speed is not a licence.**

Everything this gate answers `True` for still needs a named human. It only decides whether the
request is worth putting in front of one at all.

### Gate 2 — `PROPOSED` is where an agency unit stops

`app/orchestrator/dispatch.py` is the only place in BuddyE where a `Dispatch` changes state. No other
module assigns `Dispatch.status`, `Asset.status`, `authorised_by` or `decline_reason`, and every one
of those assignments goes through an `assert_*_transition` helper.

| Verb | What it does | Agency unit? |
| --- | --- | --- |
| `propose()` | writes `PROPOSED` with route, distance, ETA and reason | yes — that is the whole point |
| `commit()` | community resource → `COMMITTED` | **refuses outright**, with a sentence |
| `authorise(name=…)` | the only door an agency unit can take | requires a person's name |
| `decline(name=…, reason=…)` | a recorded no | requires a name **and** a reason |
| `start()` | `COMMITTED` → `EN_ROUTE`; computes the route and hands it to the simulator | after either door |
| `complete()` | `ARRIVED` → `COMPLETED`; frees the asset | |

`commit()` checks **both** the stamped column and the live policy function, and either one saying "a
person must decide" is enough to stop:

```python
if dispatch.requires_authorisation or requires_authorisation(asset.kind):
    raise DispatchRefused(
        f"{asset.call_sign} is an agency unit: it stays PROPOSED until a named human authorises it. "
        f"Software does not commit an ambulance, a fire crew or a police welfare check.")
```

### The flag is stamped once

`Dispatch.requires_authorisation` is written at proposal time from
`domain.state.requires_authorisation(kind)` and read from the column for the rest of the row's life.
If a later edit to the policy made an ambulance auto-dispatchable, it would not retroactively bless a
request a human never approved — nor un-bless one they did. The column is what a human approved
against; the function is the policy as it stands now.

### The name is the record

`authorise()` and `decline()` both validate the name with `escalate._validate_releaser` — the
escalation ladder's own validator, shared deliberately rather than reimplemented. `"system"`,
`"automation"`, `"bot"`, `"api"`, `"cron"` and their friends fail to authorise an ambulance for
exactly the reason they fail to release a handoff packet, and two validators would eventually
disagree about which names are people.

`OVERSEER_NAME` in settings is the name that goes on generated paperwork as "prepared by". It can
**never** authorise anything. An agency dispatch and a handoff packet both require a name supplied in
the request, by the human making the decision, at the moment they make it. A settings value that
could approve an ambulance would mean the ambulance was approved by a config file.

### Declining is a decision too

`decline()` requires both a name and a reason, cancels the dispatch, and marks the agent's
`OperatorAction` as `accepted=False`. A coordinator who says no to an ambulance and is asked about it
a week later needs the answer on the row, not in somebody's memory.

It accepts **only** `PROPOSED`. `DISPATCH_TRANSITIONS` permits `CANCELLED` from `COMMITTED`,
`EN_ROUTE` and `ARRIVED` as well, and cancelling one of those here would leave the asset `ASSIGNED`
or `EN_ROUTE` with `current_dispatch_id` pointing at a dead row: fleet would exclude it as committed,
the simulator would not move it (it walks `EN_ROUTE` dispatches only), and the van would freeze on
the map for the rest of the evening. Recalling a unit that is already rolling is a different act with
a different state path, **and it is not implemented.** Stating that gap is better than implying a
verb that does not exist.

### Authorising also releases the packet

`authorise()` releases any unreleased `HandoffPacket` behind the same incident's escalation, through
`escalate.release()` with the same name. A coordinator approving an ambulance should not then have to
approve the page that goes with it. A packet that is not in a releasable state is logged and is not
an error — most incidents never climbed to the responder rung and have no packet at all, and turning
that into a 500 would mean an ambulance could not be approved for anybody who did not also have one.

One rough edge to know about: that release writes `released_at` and `released_by` on the packet but
publishes **no `handoff.released` event** — only `POST /api/handoffs/{id}/release` does. A client
tracking release state from the stream alone will show the packet as still prepared until it
refetches. Refetch on `dispatch.authorised`. The database is right; the stream is quiet.

### The payload says it out loud

Every dispatch payload carries `status_note`, exactly as the handoff packet does, rather than leaving
a client to infer it from a null:

> *prepared only — an agency unit stays proposed until a named human approves it, and nobody has been
> asked*

And `dispatch.awaiting_authorisation` is published as its own event alongside `dispatch.proposed`, so
a board that is watching does not have to notice a boolean.

---

## Auto-dispatch

`auto_dispatch(incident_id)` is the line the product is built on:

```python
proposal = await propose(incident_id)
if proposal is None:               # nothing legal to send; the reason is in the OperatorAction row
    return None
if proposal["requires_authorisation"]:
    return proposal                # fully prepared, visible, stopped dead at PROPOSED
commit(...); start(...)            # a van, a truck, a ride: rolling, nobody clicked
```

The background sync loop calls it for newly opened incidents when `AUTO_DISPATCH` is on (the
default). Turning it off means every dispatch, including a case of water, waits for a coordinator to
press send. **Agency units are unaffected by that setting in either direction** — they stay
`PROPOSED` whatever it says. A config flag that could change that would be a config flag that
approves ambulances.

`propose()` returning `None` means the fleet had nothing legal to send, not that nothing was tried.
A `dispatch.none_available` event carries the full exclusion list, so "nobody was sent" arrives with
twelve sentences saying why.

---

## The paperwork

Incident management is largely paperwork, and the forms are not arbitrary. ICS-214 (Activity Log) and
ICS-213 (General Message) are what a US emergency operations centre, a fire department and a county
emergency manager have all been trained to read. A document a duty officer can read at a glance beats
a prettier one they have to learn.

| `form` | Renderer | What it is |
| --- | --- | --- |
| `ICS-214` | `render_activity_log` | The activity log: every call, decision and dispatch on one incident, in time order |
| `ICS-213` | `render_general_message` | A general message to a named recipient at an agency — to, from, subject, message, with a reply block |
| `situation_report` | `render_situation_report` | The hazard as a whole: outcomes, incidents, dispatches, what is outstanding |

`IncidentDocument.form` also documents `after_action` as a value. **Nothing writes it** — there is no
renderer and no API branch — and it is listed here so a reader who greps the model does not go
looking for a feature that is not there.

Three properties, and the third is the one that makes this different from a summariser:

- **Every statement is grounded in the record.** The agent is given the outcomes, the times, the
  dispatches and what the person actually said, and may use nothing else. *"Not recorded"* is a
  correct and useful entry; a plausible guess is a defect.
- **Code checks the grounding; it does not trust the instruction.** Quoted speech in a generated body
  must trace to something in the record (`quote_is_grounded`, the same function the reconciler uses
  on transcripts) and every number in it must appear in the record. An invented count and an invented
  time are the two failure modes that matter here, and both are mechanically detectable —
  `ungrounded_quotes()` and `ungrounded_numbers()`.
- **The document exists either way.** Each form has a deterministic renderer laying out the same
  record in the same ICS structure with no model involved. A failed, unparseable or ungrounded
  generation falls back to it. An EOC is never left without its log because a free-tier gateway was
  busy. The model's contribution is readable narrative, not the facts.

**`approved_by` is blank until a human signs it**, and there is no code path in the agent that could
fill it. `POST /api/documents/{id}/approve` runs the name through the same `_validate_releaser`: an
ICS form signed by "system" is a form nobody signed.

## Correspondence

Messages to the people around a neighbour — the nominated contact, a son or daughter, an agency.
These are the messages a block captain writes at eleven at night and gets wrong, because writing to
somebody's daughter about their mother is hard: too little and she does not understand why you rang,
too much and she is driving across town at midnight for a woman who is sitting down with a glass of
water.

Two properties are enforced by code rather than asked for in the prompt:

- **A draft is not a message.** Returned dicts are keyed by `Correspondence` columns and neither
  `sent_at` nor `approved_by` is among them. There is no path in the module that could populate
  either. `sent_at = null` means nobody has been contacted, whatever the draft says — the same
  boundary the handoff packet draws.
- **A draft may never imply it was already sent, or that help is already coming.**
  `implies_already_sent()` checks the generated text and sends it back to the template if it makes
  that claim. This is the failure that turns a helpful note into a harmful one: a daughter who reads
  *"we've let the paramedics know"* stops making her own calls.

The recipient's phone number or email is set from the record by code and never goes to the model. The
wording of a message to Rosa's daughter does not depend on her phone number, so it does not leave the
process.

---

## Health data

`needs` and incident summaries are derived from health facts about a named person — an oxygen
concentrator, insulin in a warming fridge, a door somebody cannot reach. They are stored unredacted
because that is exactly what makes them useful to a coordinator, and redacted at egress by
`app.obs.redact`, never in the engine. Same rule as triage.

The one payload that carries a named person's health information *off this machine* is the agent
prompt, so it goes through `obs.redact` on the way out and the stored `inputs`/`output` go through it
again on the way into the database.

---

## Where to look

| Question | File |
| --- | --- |
| Which kinds need a human? | `app/domain/state.py` — `requires_authorisation` |
| Why was this unit offered / not offered? | `app/domain/fleet.py` — `eligible`, `Exclusion` |
| Who should go, and why in words? | `app/agents/dispatch_agent.py` |
| Where does a proposal become a commitment? | `app/orchestrator/dispatch.py` |
| Where do incidents come from? | `app/orchestrator/incidents.py` — `sync_sweep` |
| What is on the street and where is it? | `app/api/assets.py`, and [`MAP.md`](MAP.md) |
| Routes and payload shapes | [`API.md`](API.md) |
| The escalation ladder this boundary mirrors | [`ESCALATION.md`](ESCALATION.md) |
