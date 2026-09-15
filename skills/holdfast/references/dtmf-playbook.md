# DTMF and Hold Playbook

Practical notes for writing CALL-E call instructions that navigate IVR phone
trees and survive hold queues. Entries marked `(measured YYYY-MM-DD)` come
from live test calls against the HoldFast demo phone tree; entries marked
`(unverified)` are expectations that still need a live test. Nothing here may
be presented to judges as measured before the date it was actually measured.

## How CALL-E handles DTMF

- CALL-E added IVR/DTMF keypad navigation on 2026-08-15 (changelog). The
  model behind the call decides keypresses from the instructions and the
  audio it hears; there is no separate DTMF API parameter. `(unverified)`
- So navigation quality likely depends on how the goal text instructs the
  call: state the menu logic, the known path, and the fallback policy in
  plain language. `(unverified)`

## Candidate instruction patterns (to be validated)

- Put the known map path in the instructions as a numbered sequence with the
  meaning of each step, and ask the call to confirm each menu prompt before
  pressing. `(unverified)`
- State stop conditions explicitly: "If no menu option matches billing after
  hearing the full menu twice, stop pressing keys and wait for an agent."
  `(unverified)`
- For digit entry (reference numbers), spell out the digits and ask for the
  read-back to be captured in the transcript. `(unverified)`

## Hold behavior

- Hold music and repeated announcements are not a human pickup. The call
  instructions should say: wait silently through hold audio; respond only
  when a person or an interactive prompt addresses the call. `(unverified)`
- CALL-E does not document a maximum call duration. Measure the hold ceiling
  in the demo run and record it here before relying on long holds.
  `(unverified)`

## Recovery

- If a call drops mid-navigation, do not redial blindly. Recover the original
  run through the CLI recovery path; if a redial is truly needed, it is a new
  plan and needs a new user confirmation. `(unverified)`

## Field notes

_Append dated, measured observations below this line during testing._

- 2026-09-11 `(measured, call 001, NWS Boulder +13034944221)` Line plays a
  full menu (press 1 Denver Metro/Boulder ... press 9 climate info), then
  auto-plays the Denver Metro/Boulder forecast with no keypress. The call
  treated the recording as a conversation partner ("is this the NWS line?",
  "I'll wait", "No rush") — recorded-line mode instructions are required.
  Forecast captured anyway. Total elapsed ~2 min, most of it in PREPARING.
- 2026-09-11 `(measured, call 002, NWS Wilmington OH +19373830031)` The
  documented "press 2, press 3" path was not needed: the line cycled
  regional forecasts automatically (Whitewater Valley, then Southwest Ohio).
  Documented paths can go stale; treat map data as hints, not guarantees.
  ASR error observed: "Muggy" transcribed as "Monkey" — verification must
  tolerate mis-transcription of modifier words, not just numbers.
- 2026-09-11 `(measured, call 003 attempt)` `call start` failed at plan
  stage with `plan_not_ready`: "Insufficient CALL-E balance". Plan-stage
  probes do NOT check balance; the shortage surfaces only at run time. A
  fresh hackathon account's promised 20 free calls did not appear after 2
  completed calls.
