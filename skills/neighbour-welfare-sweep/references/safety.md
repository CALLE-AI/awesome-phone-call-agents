# Safety

This skill places real outbound calls to frail people during an emergency. Every rule below is required.

## The human-authorisation boundary — read this one first

**No software in this workflow may contact an emergency service.** Not on a timer, not on a critical triage band, not because a transcript contained the word "help".

The ladder has three rungs and only the first is dialled by the agent:

| Rung | Who | What the agent may do |
| --- | --- | --- |
| `EMERGENCY_CONTACT` | the person the neighbour nominated | **call them** |
| `BLOCK_CAPTAIN` / coordinator | the volunteer or officer running the sweep | **notify them** |
| `RESPONDER` | 911, EMS, fire, a police welfare check | **prepare a page and stop** |

The third rung produces a **handoff packet**: the address, the access note, the medical dependency, the person's verbatim last words, every call attempt, and a script written to be read aloud. It is created with `released_at = null`, and a packet in that state **has told nobody anything**. It is a document on a screen.

Make that structural rather than intentional:

- **One function assigns `released_at`, and it takes a person's name.** Refuse an empty name, refuse anything with no letters in it, and refuse `system`, `automation`, `auto`, `bot`, `service`, `api`, `cron`, `admin`, `test` and their friends. `released_by` is the only record that a human accepted responsibility for what a stranger is about to be told about a frail person's home; a service account in that field means nobody did. Have a test pin the fact that this is the only assignment site.
- **The escalation module imports no call provider.** If it cannot reach one, it cannot dial one by accident. Keep it that way and say so in the module docstring, so the next person to add an import has to argue with it.
- **Provide the gate as a named function** — `require_released(packet)` — that any future transmit path must call. One obvious thing to call, and one obvious thing to have failed to call in review.
- **State the fact in the payload**, not as a null a client has to interpret: `released: false` plus a `status_note` saying "prepared only — no emergency service has been contacted and nobody has been sent". A UI that renders a prepared packet as sent has done the harm the design was meant to prevent.
- **Put the count in the audit record**: packets prepared, packets released, and `emergency_services_contacted: 0` as a stated fact of the document.
- If you also dispatch resources: an agent may commit **community** resources (a volunteer with water, a ride, a portable battery, an outreach nurse) because sending a neighbour to a hot house is a recoverable mistake. It may never commit an ambulance, a fire crew, or a police welfare check. A false ambulance call takes a unit away from someone else's emergency. Stamp "requires authorisation" on the row at proposal time and never recompute it, so a later policy edit cannot retroactively un-authorise something a human approved. Reuse **this same** `released_by` validator on the authorising name — "system" must fail to approve an ambulance for exactly the reason it fails to release a packet. And go one step past flagging: refuse to *offer* an agency unit unless the incident justifies one, or the arithmetic will betray the policy, because an ambulance is faster than a volunteer's van on almost every street and a pure ETA race hands every water drop to a rescue unit. The full engine, the two gates and the implementation checklist are in `references/dispatch-and-authorisation.md`; read it before writing dispatch code rather than reconstructing it from this bullet.

## What the call itself may never imply

The task text must say, in words the model will follow:

- **"You cannot summon anyone and you must not suggest you can."** If it is an emergency, tell them to hang up and dial the emergency number themselves if they are able, stay with them until they do, and say the coordinator will be told right away. Do not offer to make that call for them.
- **Never promise a visit, a delivery, or a time** that is not in the supplied help text. Offer only help that exists, in the exact words supplied, which is the only place a time or an address may come from.
- **Never give medical advice.**
- On the call to a nominated contact: **never say or imply that an ambulance, the fire service, the police, or any other service has been called or is on its way.** None has been. The failure mode here is a family standing down because they believe help is coming.

## Consent

- Call only people who have opted in to automated check-in calls. Record the consent flag on the row.
- Enforce it **twice**: drop non-consenting people when building the call order, and check again on the row at the moment of dialling. A guard that exists only one layer up is one an off-by-one gets past, and the thing on the other side of it is somebody's phone ringing after they said no.
- Keep them visible in the output anyway, with `may_call: false` and the reason. They are on the coordinator's list; pretending they are not there is a different failure.

## Identity, and who might be listening

- Say in the first sentence that this is an automated call, from whom, and why. A check-in call from nobody in particular is a call people hang up on. Name the coordinator: *"Alma Reyes asked me to ring round."*
- If they ask whether you are a real person, say plainly that you are not, and that a named human reads what you find out.
- **On voicemail, or to anyone who is not the person you rang for**: say only that the check-in programme called about the hazard and will try again. Do not say why they are on the list, and never mention health, medicine, or equipment. You do not know who is listening to that machine.
- If they ask you to stop calling, stop, and record it.

## Health data

Conditions, medications, power dependency, and addresses are sensitive health information about named people.

- **Redact at egress, never at the source.** A triage reason with "oxygen concentrator" removed is useless to the coordinator it was written for. Mask phone numbers and credential-shaped keys on everything that leaves the process.
- **The call task is the exception in the other direction.** It is persisted and published on event streams, so build it from *derived* facts (power-dependent, mobility, lives alone) and never interpolate a condition, a medication, or an address into it. First name only.
- **The handoff packet is the exception in the first direction.** Do not redact it beyond phone numbers: its entire job is to put an address and a medical dependency in front of a responder in the first sentence. Restrict who can read it instead.
- Audit traces contain both. They are records for the coordinator, not public artifacts; say so where you publish them.

## Allowlist, budget, idempotency

- A real provider may only dial numbers in an explicit allowlist. Anything else is refused **before** the dial, with a visible "skipped" event that is never confused with "did not answer" — their phone never rang.
- A hard cap on real calls is checked against the database before every dial. Reaching it ends the sweep with a stated reason and the remaining people named in the unaccounted list.
- Count the budget from a ledger of calls the provider actually accepted, and keep that ledger **outside** the demo data. A reset that wipes the demo must not hand a metered free tier back.
- The default provider is a mock. Tests and CI never reach a real one.
- Committed sample data uses fictional `+1 555-01xx` numbers. Real demo numbers come from environment variables only, must also be in the allowlist, and are never committed.
- Write the idempotency key before dialling and reuse it on retry or restart. A sweep interrupted mid-roster resumes from the person it had reached; it does not start again and ring the first half of the block twice.
- Never give a nominated emergency contact a real number in a demo. The ladder can place that second call on its own, and a demo must not spend the tier on somebody who never agreed to be rung.

## Silence, handled honestly

- An unanswered call gets an outcome, a reason, an escalation and a row. Never retry silence away, never let it exit the loop early, and never leave a person with no outcome and no entry in the unaccounted list.
- Distinguish, in the data and in the interface, between *not dialled* (no consent, not allowlisted, budget spent) and *did not answer*. Conflating them tells a coordinator someone was checked when nobody checked them.
- Compute the unaccounted list **after** the sweep reaches its terminal state. Computed a moment early, it tells a coordinator whose budget just ran out that eleven people are "next in the queue" when nobody is going to ring them.

## Human control

- A sweep can be cancelled; a cancelled sweep stops consuming results. A call already connected at the provider is not cut off by this skill.
- Closing an escalation requires the name of the person who decided the neighbour is accounted for.
- "We reached the contact" is a fact about reaching a contact. It is never a statement that the neighbour is safe.
