---
name: neighbour-welfare-sweep
description: Check on a list of vulnerable people by phone during a hazard — a heat warning, a power cut, a flood, smoke, a boil-water notice. Triage the roster against that specific hazard so the calls go out worst-first, compile the facts the hazard makes non-negotiable into a typed call result schema, read under-reported distress by meaning rather than by phrasing, treat a call nobody answered as a finding that escalates rather than a gap to skip, climb an escalation ladder that ends by preparing a responder handoff a named human must release, and send community resources to the addresses that need them while every ambulance, fire crew and police welfare check stays proposed until a named human approves it. Use for welfare check-in calls, emergency-management outreach to a registry of at-risk residents, resource dispatch off the back of those calls, and any call round where silence matters and no software may summon emergency services.
license: MIT
---

# Neighbour Welfare Sweep

Use this skill when a hazard is affecting an area, someone holds a list of people who may be in danger because of it, and the agent has to reach all of them by phone, work out who actually needs something, and get the ones in trouble to a human.

The people on that list are frail, elderly, isolated, or dependent on equipment that needs electricity. They will under-report. Some of them will not pick up. **Both of those are the point**, and the two rules below are what separate this from an automated call round.

## The two rules

### 1. Silence is a finding, not an error

In an outbound sales or staffing cascade, a call nobody answers means "move on" and costs nothing. Here it is frequently the most important thing the sweep learns. An unanswered call to a man whose oxygen concentrator is plugged into a wall socket, during a blackout, is the finding.

So: `UNREACHABLE` is a first-class outcome, not an exception. An unanswered, failed, or unreadable call goes **into** the decision function with the person's triage attached, comes back with an outcome and a reason, and escalates. And every person on the roster with no outcome at all — never dialled, opted out, budget ran out — is named in the output with the reason. A sweep is judged by whether anybody was quietly dropped, not by how many calls it made.

### 2. The agent never summons emergency services

The ladder is `EMERGENCY_CONTACT` (the agent may call the person the neighbour nominated) → `BLOCK_CAPTAIN` (the agent notifies the coordinator) → `RESPONDER` (the agent **prepares a page and stops**). A responder handoff is a document with `released_at = null`, which means it has told nobody anything, and the only way out of it is a named human releasing it.

The same boundary applies to anything the workflow *sends*. Community resources — a volunteer with water, a ride to a cooling centre, a portable battery, an outreach nurse — may be committed by the agent, because a wasted trip is a recoverable mistake. An ambulance, a fire crew or a police welfare check may be proposed, routed and fully prepared, and then stays proposed until a named human approves it, because a false ambulance call takes a unit away from somebody else's emergency and that is not recoverable.

This is structural, not a policy note. Read `references/escalation-ladder.md` for the ladder, `references/dispatch-and-authorisation.md` for the dispatch engine and the authorisation gates, and `references/safety.md` for the boundary and how to make it hold in code.

## When To Use

- a hazard is declared over an area and somebody holds a list of at-risk residents
- an outage, heat event, or evacuation order needs a check-in round tonight, and the list is longer than the evening
- a coordinator needs to know **who is unaccounted for**, not just who answered
- the people on the list have consented to automated check-in calls
- what a person needs (water, a cool place, a ride, someone to look in) can be offered and recorded
- resources exist that could be sent to an address, and something has to choose which one goes where — including the case where the right answer is an emergency unit that only a person may commit

## When Not To Use

- as an emergency reporting channel, a replacement for 911, or anything a person in danger is expected to rely on
- cold outreach to people who have not consented to check-in calls
- medical triage, medical advice, or any clinical decision — this establishes facts and hands them to a human
- an evacuation order where minutes matter and the correct action is knocking on doors
- any workflow where the software would be permitted to dispatch an emergency service

## Core Workflow

1. **Parse the hazard into something you can compute on and say out loud.** Kind, severity, and the few facts that change the danger: temperature, humidity, outage estimate, air quality. Nothing here may raise — a missing or unparseable fact degrades to "we do not know", said out loud in the triage reasons. A crash in hazard parsing means nobody gets called at all. See `references/triage.md`.
2. **Triage the whole roster against *this* hazard.** Deterministic rules, no model. Every point carries the sentence that justifies it. The output is a score, a band, an optional time-to-harm clock, and the reasons — and the same roster must reorder when the hazard changes. There is no "high-risk person" field. Read `references/triage.md`.
3. **Drop anyone who has not consented, at ordering time**, with the reason recorded — not sorted to the bottom where an off-by-one can reach them. Keep them visible in the output: the coordinator still needs to see them.
4. **Compile the call contract per person.** The hazard decides which facts become `required` fields in the result schema; the person's own file adds more (powered equipment, mobility, living alone). `required` means *the call may not come home without this fact* — never *this must be yes*. Use `references/contract-schema.md`.
5. **Check consent, the dial allowlist and the call budget at the moment of dialling**, write an idempotency key before the dial, and place one call. See `references/safety.md`.
6. **Validate the returned object locally** against the exact schema you sent. A null or invalid result is not a rejection of the person — it is a person you could not read, which is a kind of silence.
7. **Only if fields came back unknown or invalid, run an understanding pass** over the transcript on those fields only. It may resolve an unknown; it may never overturn a definite answer the provider gave, and any quote it proposes is discarded unless the person can be shown to have said it. Where it cannot resolve, the unknown is passed on as a finding. See `references/reading-distress.md`.
8. **Decide deterministically, one of five outcomes**: `SAFE`, `HELP_DECLINED`, `NEEDS_HELP`, `URGENT`, `UNREACHABLE`. Never `SAFE` on a call you could not read, and never `SAFE` on a hazard-required fact you never established. The full table, with the orderings that matter and why, is in `references/escalation-ladder.md`.
9. **Work the roster to the end.** There is no early exit. A heat warning does not become safe because the first person answered. Only a spent call budget or a provider failure that applies to every recipient stops the sweep.
10. **Escalate everything that is not SAFE.** One ladder per person per sweep. Call the nominated contact only for the outcomes that justify telling a third party about someone's health. Notify the coordinator. For the worst outcomes at the highest bands, prepare a responder handoff — and stop.
11. **Emit who is unaccounted for**, with the reason for each, after the sweep reaches a terminal state and not before: "still to be called" and "the sweep ended before reaching them" are different sentences and only the finished sweep knows which one is true.
12. **If you also send resources**, derive an incident per escalation with a reconciler rather than a callback, filter the fleet to legal candidates deterministically, let the model rank and justify among *those only*, re-validate the pick before committing, commit community resources, and stop every agency unit at "proposed" until a named human approves it. Follow `references/dispatch-and-authorisation.md`; it is the half of this workflow where an automation does real-world harm.

```text
parse hazard -> triage roster (worst first, reasons attached) -> drop non-consenting
   -> per person: compile contract -> consent + allowlist + budget + idempotency -> call
   -> validate -> understand (only if unknown) -> decide -> escalate if not SAFE
   -> next person, to the end of the list
   -> unaccounted report

not SAFE -> incident (address + needs + priority)
   -> filter to legal candidates (code) -> rank and justify (model) -> validate (code)
   -> community resource: committed and moving
   -> agency unit: PROPOSED, prepared, and nobody has been asked until a person signs
```

## Required Fields

For the hazard: `kind` (heat, cold, power_outage, flood, smoke, storm, boil_water), `severity`, `area`, a human `headline`, a loose `facts` dict, and `help_offered[] {key, label, text}` — where `text` is spoken **verbatim** and is the only place a time, an address or a promise may come from.

For each person: `name`, `phone`, `address` and access notes, `age_band`, `lives_alone`, `conditions[]` (free text is fine — see the triage reference), `power_dependent` with `power_backup_hours`, `cooling`/`heating`, `mobility`, `has_transport`, `preferred_language`, the nominated contact's name, relation and phone, and `check_in_consent`.

## Output

Per call: the compiled task and result schema, the triage assessment that put this person at this place in the queue, the structured result, validation errors, the transcript, the outcome and its reason, and the person's own words.

Per sweep: an outcome for every person called, **the unaccounted list**, the escalations with every rung including the skipped ones, and every prepared handoff packet with its release state — `prepared: n, released: 0` is the normal, healthy reading.

Per dispatch, if you send resources: which unit, the sentence saying why that one, the computed distance and ETA, **the named list of units that were not offered and why not**, whether the choice came from the model or from the deterministic fallback, and — for anything that needs a person — a state that says in words that nobody has been asked yet. A declined request keeps the name and the reason.

## Reading What People Actually Say

An older person alone in a hot house will tell you three times that she is fine. Judging by phrasing rather than by meaning is the failure mode this skill exists to prevent, and it is fixed in the *field descriptions*, which reach the extraction model. Read `references/reading-distress.md` before writing any of them.

## Safety

Read `references/safety.md` before wiring this to a real provider. It covers consent, the human-authorisation boundary on emergency dispatch, what the agent may never imply on a call, health data handling, allowlist and budget, and what a voicemail may say when you do not know who is listening.

If the workflow sends resources as well as making calls, read `references/dispatch-and-authorisation.md` too. It has the checklist an implementation has to pass before an agent is allowed anywhere near a fleet.

## Examples

See `references/examples.md` for a compiled contract, the same roster reordered by two different hazards, an under-reported-distress result next to the transcript that produced it, a silence that escalates, and a prepared-but-unreleased handoff packet.

## Reference Implementation

A runnable app implementing all of the above — FastAPI backend, deterministic triage engine, CALL-E integration, mock provider, escalation ladder, handoff packets, a deterministic dispatch engine with the two authorisation gates, three AI operator agents that propose but never decide, ICS-214/ICS-213/situation-report generation, a wall-clock movement simulator, and a test suite for every rule here — lives at `apps/python/buddye/` in this repository. Its `docs/DISPATCH.md` and `docs/MAP.md` are the worked versions of `references/dispatch-and-authorisation.md`.
