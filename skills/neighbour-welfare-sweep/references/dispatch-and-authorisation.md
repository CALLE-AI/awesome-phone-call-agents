# Dispatch and the authorisation boundary

Read this before writing any code that assigns a resource to an address. The sweep tells you who is
in trouble; this is what happens next, and it is where a well-meaning automation does its real
damage.

One sentence carries it:

> **Community resources auto-dispatch. Agency resources need a named human.**

Sending a volunteer with a case of water to a hot house is a recoverable mistake — the worst case is
a wasted trip. A false ambulance call is not recoverable, because the unit that rolls to her door is
the unit that does not roll to somebody else's cardiac arrest. So the first is committed by software
and the second is prepared by software and committed by a person whose name goes on the row.

Everything below is how to make that structural rather than intentional. A policy that lives in a
comment is a policy one refactor from being gone.

---

## Two objects, not one

An **escalation** is about reaching a human being: the nominated contact, the coordinator, eventually
a responder. An **incident** is about sending resources to an address. They have different
lifecycles, different failure modes and different people watching them, and collapsing them into one
row means the question "has anybody actually gone?" has no place to live.

Derive incidents from escalations with a **reconciler, not a callback**: a function that reads the
escalations and makes the incident table agree with them, idempotent, keyed on the escalation id,
runnable from anywhere at any time. A bus listener makes "did the sweep produce incidents?" a timing
question, puts database work on the path your event stream reads, and leaves a subscriber holding ids
for rows a reset has just deleted. A reconciler has none of those failure modes. Run it twice and
nothing happens the second time.

Two rules on the incident row:

- **Priority never goes down.** A re-synced incident takes the graver of what it had and what the
  record now derives; needs are unioned, never replaced. A coordinator who raised something by hand
  must not have a background pass quietly lower it.
- **Coordinates are copied, not joined.** Write the address and the lat/lon onto the incident when it
  opens, so it still describes the place somebody was sent to after the roster row is edited.

---

## Code filters, the model ranks, code validates

The same division of labour the understanding step uses, for the same reason. Never let a model
choose from the open world.

```
filter to legal candidates   deterministic: available, uncommitted, capable, capacity left,
                             in radius, and allowed for this incident at all
        ↓
model ranks and justifies    among those candidates only, by fit and by what the person said
        ↓
validate the choice          the SAME filter, re-run against live rows, before anything commits
        ↓
commit or hold for a human
```

Make the model unable to do four things:

1. **Invent a resource.** The shortlist is the whole world; an id not in it is refused.
2. **Do arithmetic.** Hand it the computed distances and ETAs and copy them back **from the record**,
   never from the reply. A model confidently wrong about a number puts a wrong ETA on a
   coordinator's screen, and they will plan around it once and then stop believing the screen.
3. **Authorise anything.** Re-derive "does this need a human?" from your policy function, never from
   the candidate payload and never from the model's own `agency_request` field.
4. **Break the workflow.** Every failure path — no key, a timeout, a dead gateway, prose instead of
   JSON, a choice that does not validate — returns the deterministic pick. A model outage must
   degrade the prose and never the dispatch.

**Use one evaluation function for both the filter and the gate.** An engine whose filter and whose
gate can disagree will eventually commit something the filter would have refused, and the
disagreement surfaces at the worst possible moment.

**Do not re-rank in the model layer.** If the filter already returned candidates in a deterministic
order, the fallback is `candidates[0]` and a second ranker quietly disagreeing with the first is the
split-brain that makes a coordinator stop trusting the board.

**Do not hold a database transaction open across the model call.** A free-tier gateway runs 20-100s.
Read the world into plain data, close the session, await the model, then reopen and re-validate. The
re-validation is not belt and braces: it is the nurse who got committed to another incident during
the twenty seconds the model spent thinking.

### Exclusions are output, not silence

Return why each resource was **not** offered, by name, with a code and a full sentence:

> *WV-2 is en route, not available*
> *R-15 is an agency unit and this incident does not justify one: it needs water, ice, and taking a
> crew off the street for that removes them from somebody else's emergency*

A coordinator who asks "why didn't you send WV-2?" and gets silence stops using the tool. The answer
has to already be on the screen.

---

## The authorisation boundary

### One function is the source of truth

```python
AUTHORISATION_REQUIRED = frozenset({EMS_UNIT, FIRE_UNIT, POLICE_WELFARE})

def requires_authorisation(kind) -> bool:
    return AssetKind(kind) in AUTHORISATION_REQUIRED
```

Every caller asks that function. Nobody re-derives it from a list of kinds that looks similar,
because a kind added later would quietly become auto-dispatchable in five of the six places.

**Needs a human:** ambulances, fire units, police welfare checks — anything that spends a public
emergency resource or puts a uniform at a frightened person's door.

**Does not:** volunteers, drivers, water and ice, portable power, shuttles, and a community nurse who
can assess but is not a paramedic. Note that last one deliberately: a clinician looking in on a
confused woman is an errand. The boundary is about spending an emergency unit, not about clinical
seniority, and drawing it in the wrong place makes the whole rule feel arbitrary and therefore
negotiable.

**An unreadable or unknown kind fails closed** — treat it as needing a human. Failing closed costs a
click; failing open sends an unidentified vehicle on its own authority.

### Two gates, and you need both

**Gate 1: an agency unit is not merely flagged, it is not offered.** Refuse to *consider* one unless
the incident justifies it — a life-safety finding, equipment that has already stopped, a person who
said something is wrong right now, or silence from somebody triage put in the critical band.

Without this gate the arithmetic betrays the policy. An ambulance is faster than a volunteer's van on
almost every street, so a pure ETA race offers a rescue unit for a water drop, a coordinator is one
click from approving it, and the click takes a unit away from somebody else's emergency. **Being
faster is not a licence.**

Everything gate 1 passes still needs a human. It only decides whether the request is worth putting in
front of one at all.

**Gate 2: `PROPOSED` is where an agency unit stops.** Give it no code path out except a verb that
takes a person's name.

- `commit()` — the auto-dispatch path — **refuses an agency kind outright**, with a sentence, rather
  than quietly doing nothing.
- `authorise(name=…)` is the only door. It is a separate endpoint, not a flag on `commit`.
- Check **both** the flag stamped on the row and the live policy function. Either one saying "a
  person must decide" is enough to stop.

### Stamp the flag once and never recompute it

Write `requires_authorisation` onto the dispatch row at proposal time and read it from the column for
the rest of that row's life. A later edit to the policy must not retroactively bless a request nobody
approved, nor un-bless one somebody did. The column is what a human approved *against*; the function
is the policy as it stands *now*; you need both readings and they answer different questions.

### The name is the record, and it is the same validator

Reuse the **same** name validator the responder handoff uses. Reject an empty name, a name with no
letters in it, and `system`, `automation`, `auto`, `bot`, `service`, `api`, `cron`, `admin`, `test`
and their friends. `"system"` must fail to approve an ambulance for exactly the reason it fails to
release a handoff packet, and two validators will eventually disagree about which names are people.

**No configuration value may authorise anything.** A settings field naming the duty officer is fine
for printing "prepared by" on a form. If it can also approve an ambulance, the ambulance was approved
by a config file. The name comes from the request, from the human making the decision, at the moment
they make it.

### Declining is a decision too

Require a name **and** a reason, record both on the row, and mark the agent's provenance record as
not accepted. A coordinator who says no to an ambulance and is asked about it a week later needs the
answer on the row, not in somebody's memory.

Accept a decline only from the proposed state. Cancelling a unit that is already rolling is a
different act — the resource has to be released, its position reconciled, its assignment cleared —
and if your state machine permits the transition but your handler does not do that work, the vehicle
freezes on the map for the rest of the evening. Either implement recall properly or refuse it and say
so.

### Say it in the payload

Do not leave a client to infer "nobody has been asked" from a null. Ship a `status_note`:

> *prepared only — an agency unit stays proposed until a named human approves it, and nobody has been
> asked*

and emit a distinct event (`dispatch.awaiting_authorisation`) alongside the proposal, so a board that
is watching does not have to notice a boolean. Any verb in the interface that implies dispatch — "en
route", "sent", "help is coming" — must be unreachable for a proposed agency unit.

---

## Provenance

Every agent call writes a record: agent, model, the inputs it was given, what it returned, its
rationale, the latency, the error, and whether a human accepted it.

Write it on **every** path, including the ones where the model was never reached. *"The gateway timed
out so the deterministic default was used"* is one of the answers that has to be on the record.
Emergency management runs on being able to say who decided what, when, on what basis; an agent that
assigns a unit without leaving that trail is not usable in this domain.

Mark the record accepted when a human authorises and not-accepted when they decline, so the trail
says not just what the machine proposed but whether a person agreed with it.

---

## The paperwork, if you generate it

Use the forms the people reading them already know — ICS-214 (activity log), ICS-213 (general
message), a situation report. A document a duty officer can read at a glance beats a prettier one
they have to learn.

- **Ground every statement in the record.** *"Not recorded"* is a correct and useful entry; a
  plausible guess is a defect. This is a document somebody may have to defend to a family, to an
  after-action review, to an inquest.
- **Check the grounding in code; do not trust the instruction.** Quoted speech must trace to
  something in the record, and every number in the body must appear in the record. An invented count
  and an invented time are the two failure modes that matter and both are mechanically detectable.
- **Render the form deterministically too**, and fall back to it. An operations centre is never left
  without its log because a gateway was busy. The model's contribution is readable narrative, not the
  facts.
- **A generated document is unsigned.** Leave no code path that could fill the approver field.

For drafted messages to a family or an agency, two properties are enforced by code rather than asked
for in a prompt: **a draft is not a message** (no "sent" field anywhere in what the drafter returns),
and **a draft may never imply it was already sent or that help is already coming.** That second one
is the failure that turns a helpful note into a harmful one — a daughter who reads *"we've let the
paramedics know"* stops making her own calls. Check the generated text for that claim and send it
back to the template if it makes it. Do not send the recipient's phone number or email to the model;
the wording does not depend on it.

---

## Checklist

- [ ] One `requires_authorisation()` function; nobody re-derives the list.
- [ ] An unknown kind fails closed.
- [ ] Agency units are filtered out of consideration unless the incident justifies one.
- [ ] The auto-commit path refuses agency kinds outright, by kind and by column.
- [ ] `authorise()` is a separate verb, takes a person's name, and shares the handoff packet's validator.
- [ ] No configuration value can authorise anything.
- [ ] The flag is stamped at proposal time and never recomputed.
- [ ] Decline requires a name and a reason and is recorded.
- [ ] The payload states, in words, that nothing has been sent.
- [ ] Every agent call leaves a provenance record, including the failures.
- [ ] Every model failure path lands on the deterministic answer.
- [ ] A test asserts that committing an agency unit raises, and that a service-account name is refused.
