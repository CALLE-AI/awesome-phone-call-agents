# BuddyE console: the design contract

This is not a pixel spec. `frontend/src/` is the source of truth for layout, tokens and components; what follows is the set of rules the console has to satisfy **whatever it looks like**, because in this product a display choice is a safety choice. A UI that renders a prepared handoff packet as though it had been sent has done real-world harm that no amount of correct backend behaviour undoes.

## Principle

Every string names a thing or states a value. No explainers, no taglines, no instructions in the UI. The facts a judge — or a captain at 9pm — should see are shown **as facts**, not as claims: `Decisions deterministic`, `Packets prepared 3 · released 0`, `Emergency services contacted 0`.

The reader is a volunteer with one evening. Sentences the backend already wrote (triage reasons, the recommended action, the spoken script) are shown verbatim rather than re-summarised in the client. They were written to be read by exactly this person.

## Non-negotiable: nothing may look like a dispatch

1. **A prepared packet must never render as sent.** Every packet payload carries `released` and `status_note`; use them. The unreleased state needs its own visual treatment and its own words — *"prepared only — nobody has been contacted"* — not a greyed-out version of the released state.
2. **`released_by` is shown wherever a released packet is shown.** The name is the record that a human decided; a released packet with no visible name is a packet that looks like it released itself.
3. **The release control is an explicit act with a name field.** It cannot be a one-click toggle, and it must never be pre-filled with a default, a session user, or anything that is not a person typing who they are. The 400 the API returns for `"system"` should never be reachable from the UI because the UI never offers it.
4. **No verb in the interface may imply dispatch.** No "sent", "dispatched", "en route", "help is coming", no ambulance iconography anywhere near an unreleased packet. The backend's own wording — *"Request an in-person welfare check"* — is phrased as a request to a person on purpose; do not shorten it into something that sounds done.
5. **A `PROPOSED` agency dispatch follows every rule above.** The dispatch surface exists, so this is not a conditional. `requires_authorisation` is on the row, `status_note` says *"prepared only — an agency unit stays proposed until a named human approves it, and nobody has been asked"* in words, and `dispatch.awaiting_authorisation` arrives as its own event so a board does not have to notice a boolean. Render that state as **not sent**, with its own treatment and its own words — not as a greyed-out version of a committed dispatch. No verb in the interface may imply dispatch for it: no "en route", no "sent", no vehicle moving on the map. `authorised_by` is shown wherever an authorised dispatch is shown, and the authorise control is an explicit act with a name field that is never pre-filled — the 400 the API returns for `"system"` should be unreachable because the UI never offers it. Declining requires a name *and* a reason, and the reason stays visible on the row afterwards. See [`DISPATCH.md`](DISPATCH.md).

6. **The map draws server state and nothing else.** Every coordinate, heading, route, progress value and ETA comes from `GET /api/assets/positions`, `GET /api/assets`, or the `asset.moved` / `asset.arrived` events. Never a hardcoded coordinate, never a client-computed ETA, never a scripted path or a timer that advances a vehicle. Interpolating between two polled positions for smoothness is fine and is what a real AVL console does; inventing the next one is not, and it is never necessary. If the backend stops, the vehicles must stop where they were. See [`MAP.md`](MAP.md).

## Non-negotiable: silence is visible

7. **`unaccounted` is a panel, not a footnote.** Every sweep summary, the dashboard and the trace carry it. A board that shows thirteen outcomes and hides the fourteenth person has reproduced the spreadsheet BuddyE exists to replace.
8. **`UNREACHABLE` is styled as a finding, not as a failure or an empty state.** It is not greyed out, it is not an error toast, and at the critical band it sorts **above** `URGENT` — that is what `decide()`'s priority number is for. Sort by it rather than inventing a client-side ordering.
9. **"Not dialled" and "did not answer" are never the same badge.** `call.skipped` means their phone never rang (no consent, not allowlisted, budget spent). `UNREACHABLE` means it rang and nobody came. Conflating them tells a captain someone was checked when nobody checked them.
10. **The person who opted out stays on the board**, with `check_in_consent: false` and `may_call: false` stated plainly. He is on her list. She still needs to see him. What she must not be shown is a system pretending he is not there.

## What each surface has to carry

**The board (roster under a hazard).** One row per person, worst-first from `risk.score`, showing at minimum: name, band, the **top triage reason in full**, `time_to_harm_h` when there is one, the outcome once there is one, and whether they may be called. The reasons are the argument — a row that shows only a number has thrown away the product.

**The hazard switch.** Declaring the outage must visibly reorder the same roster. That reordering is the demonstration; a transition that hides it (a spinner, a full remount, a page navigation) throws away the only moment where the idea is legible.

**One neighbour.** Their row, their risk with the full factor list, every call with its transcript, the ladder with **every rung including the skipped ones** (*"no emergency contact on file"* is not noise — it is the answer to the question the captain is about to ask), and any packet with its release state.

**One call.** Schema in, structured result out, side by side; the transcript as it was actually spoken; the outcome with its reason and the `concerns` in the person's own words. The gap between what Rosa said ("I'm fine", three times) and what the result recorded (`is_safe_now: no`) is worth seeing, and a UI that only shows the conclusion hides the interesting half.

**A handoff packet.** The whole page: address, access note, medical fact, last words verbatim, attempts, recommended action, spoken script. It is deliberately unredacted beyond phones — a packet with the address masked helps nobody — and the release state is the loudest thing on it.

**The connection strip.** From `GET /api/calle/status`: provider, ready, and `live calls used / max` from `budget`. When a real provider is selected, the allowlist count belongs next to it. This is a status readout, not a marketing badge; it never places a call to find out.

**One incident.** The address, the priority with its label in words (`life safety`, not just `1`), the needs *with the sentence that justifies each one*, and the dispatches against it. A needs list showing `water, ice` and not *"it is dangerously hot inside their home"* has thrown away the same half of the product a bare risk score throws away.

**The authorisation queue.** From `GET /api/dispatch/pending`: the units an agent has prepared and not requested. This is the surface the whole operator layer exists for, so it gets the coordinator's attention, not a tab. Each row carries the call sign, the address, the person, the computed distance and ETA, and **the agent's specific justification** — the fact that needs a paramedic rather than a neighbour with water. The person clicking has seconds; a form to fill in is not a decision aid, and neither is "high risk". Approve and decline are equally weighted controls, both taking a name, and decline additionally requires a reason.

**Why not that unit.** Wherever a proposal is shown, `GET /api/incidents/{id}/candidates` gives `excluded[]` with a written sentence per asset. Show them. A coordinator who asks "why didn't you send WV-2?" and gets silence stops using the tool, so the answer is on the screen before they ask.

**The map.** Positions, headings and routes straight from the API — see rule 6 and [`MAP.md`](MAP.md). Agency units are visually distinct from community units *before* anything is dispatched, because which resources need a human is a fact about the board and not a state of one row. `progress`, `remaining_miles` and `eta_minutes` all arrive computed; do not recompute them from coordinates.

## Live data

The stream is per **hazard** (`/api/stream/hazards/{id}`), and every event carries `sweep_id` and `neighbour_id` so one subscription serves the whole board. Reconnect with `since_event_id` — the server replays from the event table, so a laptop that slept comes back to a correct board rather than one frozen where it left off. The one thing a client must not do is derive state it was told: the outcome, the priority, the band and the release state all arrive in payloads.

## Copy rules

- Phone numbers appear only as `phone_masked`.
- Health facts appear where they help the reader act (the board, the neighbour page, the packet) and nowhere decorative.
- Never paraphrase a person's words in the UI. `concerns`, `alarming_quote` and `last_words` are quoted or not shown.
- Timestamps that matter are stated as facts with their meaning attached: *"last heard from 16:05"* is not *"last called 16:41"*, and the packet distinguishes them for a reason.
