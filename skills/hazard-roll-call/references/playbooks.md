# Hazard playbooks

A playbook is a JSON file in `apps/typescript/canopy/playbooks/`. The CALL-E task for a wave is
rendered from the playbook plus each person's facts (name, language, age band, living alone) and the
event (organisation, area, headline, emergency number, resource). The agent is given a goal and
four questions, not a line-by-line script.

| Playbook | Life safety | Trigger | Questions (short form) | Red flags |
| --- | --- | --- | --- | --- |
| `heat` | yes | NWS Extreme/Excessive Heat Warning, Heat Advisory; Open-Meteo apparent temperature 40 C+ | Cool place and fan/AC working? Drinking water? Dizzy, nauseous, headache, cramps, faint, confused? Need water/fan/ride/medication/visit? | Confusion, fainting, hot dry skin, breathing difficulty or chest pain |
| `flood` | yes | NWS Flash Flood / Flood Warning | Water entering home? Can reach higher ground alone? Medications, water, phone with you? Need help moving/shelter/medication/visit? | Trapped, cannot move away from water, confusion, breathing/chest pain |
| `outage-medical` | yes | Manual (utility PSPS notice, emPOWER outreach list) | Power out and device working? Hours of backup left? Short of breath, dizzy? Need power/battery/cold storage/visit? | Device not working with no backup, under four hours of backup, breathing difficulty, confusion |
| `smoke` | yes | NWS Air Quality Alert, Air Stagnation Advisory, Red Flag Warning; Singapore NEA 24-hour PSI 100+ | Indoors, windows closed, filtration running? Inhaler with you and enough of it? Coughing, wheezing, chest tightness? Need mask/medication/clean-air centre/visit? | Breathing difficulty, chest pain, blue lips, out of medication with symptoms |
| `boil-water` | no | Manual (utility notice) | Heard about the notice? Can boil or have bottled water? Stomach pain, vomiting, diarrhoea? Need water delivered/help/visit? | Vomiting or diarrhoea with dehydration, no safe water and no way to boil |

Every playbook also carries: `hazard_noun` (spoken in the disclosure), the confusion probe ("Can you
tell me what day it is today?"), the public-health advice lines, the red-flag instruction (always
recites `{{emergency_number}}` and says the emergency contact is being alerted), the voicemail message
(always names `{{org}}`), the follow-up interval in hours, and the three escalation reason templates
(`red`, `unreachable`, `unverified`). `life_safety` decides whether quiet hours may be overridden.

## Triage schema (per recipient)

`answered_by` (person | other_person | voicemail | ivr | unknown), `is_cool` (yes | no | unknown),
`hydrated` (yes | no | unknown), `symptoms[]`, `confusion_suspected` (boolean), `needs[]`,
`tier` (green | yellow | red), `notes`. The field descriptions carry the enum-selection rules and are
passed to CALL-E's extraction model. Canopy's verdict is computed from these fields with fail-closed
rules; the agent's `tier` is kept beside it.

## Adding a playbook

1. Copy `heat.json`, change `id` to a new value and add that value to `HAZARD_IDS` in `src/types.ts`.
2. Set `hazard_noun` and `life_safety`. Keep three to five questions. Keep `{{emergency_number}}` in
   `red_flag_instruction` and `{{org}}` in `voicemail_message`; validation fails otherwise.
3. Map official alert names in `triggers.nws_events` if a feed exists; otherwise leave the array empty
   and trigger by hand.
4. Add a test in `test/playbooks.test.ts` and run `npm test`.
