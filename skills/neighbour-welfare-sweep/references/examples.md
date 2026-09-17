# Examples

All people are fictional and all phone numbers are fictional `+1 555-01xx` numbers. The area, the streets and the community center are real Maryvale, Phoenix, because a coordinator has to be able to check a map against the world.

## The hazard

```json
{
  "kind": "heat",
  "headline": "Excessive Heat Warning - 114F, monsoon humidity",
  "area": "Maryvale, Phoenix",
  "severity": "warning",
  "facts": {"temp_f": 114, "humidity_pct": 41, "overnight_low_f": 93,
            "note": "Monsoon moisture pushed dewpoints up overnight; evaporative coolers will not keep up."},
  "help_offered": [
    {"key": "cooling_center", "label": "Cooling center",
     "text": "There's a cooling center open at the Maryvale Community Center, 4420 North 51st Avenue, from ten in the morning until eight at night. It's air conditioned, there's cold water, and you can stay as long as you like."},
    {"key": "ride", "label": "Volunteer ride",
     "text": "One of our volunteer drivers can pick you up and take you over to the cooling center, and bring you home again after. Would you like me to put you on the list for a ride?"},
    {"key": "water_ice_drop", "label": "Water and ice drop",
     "text": "We've got a truck going round the block this evening with drinking water and bags of ice. They can leave a case of water and some ice at your door."}
  ],
  "source": "NWS Phoenix AZZ537",
  "declared_by": "Alma Reyes"
}
```

`text` is spoken **verbatim**. It is the only place a time or an address may come from.

## Two people

```json
{"name": "Rosa Delgado", "phone": "+15550100", "address": "5137 W Osborn Rd",
 "access_notes": "Side gate is unlatched. The doorbell hasn't worked in years - knock on the kitchen window.",
 "age_band": "75_plus", "lives_alone": true, "conditions": ["heat sensitive", "high blood pressure"],
 "power_dependent": false, "power_backup_hours": 0.0,
 "cooling": "swamp_cooler", "heating": "wall_furnace", "mobility": "cane_walker", "has_transport": false,
 "contact_name": "Elena Delgado", "contact_relation": "daughter", "check_in_consent": true,
 "notes": "Widowed. Daughter Elena is in Glendale, about forty minutes out. Plays everything down on the phone."}
```

```json
{"name": "Walter Brzezinski", "phone": "+15550101", "address": "4713 N 55th Ave",
 "access_notes": "Ramp at the carport side. Front door sticks; push at the bottom. Two cats - don't let them out.",
 "age_band": "65_74", "lives_alone": true, "conditions": ["COPD", "oxygen"],
 "power_dependent": true, "power_backup_hours": 4.0,
 "cooling": "window_unit", "heating": "wall_furnace", "mobility": "wheelchair", "has_transport": false,
 "contact_name": "", "contact_relation": "", "check_in_consent": true,
 "notes": "Retired machinist. No family on file."}
```

Walter's blank contact is not an oversight in the example — it is the case the ladder has to handle honestly.

## The same roster, two hazards

Heat warning, 114F at 41% humidity:

```text
100  critical            Rosa Delgado      cools with a swamp cooler and humidity is 41% - an evaporative
                                           cooler loses most of its cooling in damp air, so at 114F that
                                           house may only be a few degrees below outside
 92  critical            Ernesto Salgado   a fan and nothing else at 114F - moving hot air is not cooling
 87  critical            Walter Brzezinski lives alone - nobody in the house to notice if this goes wrong
 86  critical            Hazel Nakamura    is bedbound - getting to a cooling centre is not simple
```

Power outage, six-hour estimate, 108F, **same fourteen people, nothing precomputed**:

```text
100  critical  4.0h      Walter Brzezinski oxygen concentrator runs 4h on battery against an outage expected
                                           to last 6h - it stops about 2h before the power comes back
 93  critical            Hazel Nakamura    108F outside and the air conditioning is off with the power
 68  high                Rosa Delgado      108F outside and the swamp cooler is off with the power
 63  high     10.0h      Yolanda Cruz      108F outside and the air conditioning is off with the power
```

Rosa's full factor list under the heat warning — the score is the sum of its reasons, ceiling included:

```text
cools with a swamp cooler and humidity is 41% - ... may only be a few degrees below outside
lives alone - nobody in the house to notice if this goes wrong
114F is dangerous for anyone, indoors or out
heat sensitivity, which a heat warning makes worse
75 or older - older bodies lose their margin fastest in exactly this kind of hazard
no vehicle - no way to get to a cooling centre alone
gets around with a cane or walker - getting to a cooling centre is not simple
"high blood pressure" on file - no rule for that one, so it is scored conservatively and left for you to read
on the roster for a heat warning in Maryvale, Phoenix
capped at 100 - past this point the reasons matter and the number does not
```

## Under-reported distress: the transcript, and what was recorded

Rosa says she is fine three times.

```text
bot   Hello, is that Rosa? This is an automated call from the neighbourhood check-in. Alma asked me
      to phone everyone on the block because of the heat.
user  Oh. Hello? Who is this again, love?
bot   It's an automated call, not a person. Alma Reyes asked me to ring round and see how everyone's
      doing today.
user  Alma, yes. She's a good girl. I'm fine, dear, don't you worry about me.
bot   That's good to hear. How warm is it in the house today?
user  Well. It's warm. The cooler quit yesterday, but I'm alright, I just sit still.
bot   The cooler stopped yesterday? Has anyone been able to look at it?
user  No, no. My daughter's in Glendale, she works. I'll manage. It's only the heat.
bot   Have you been able to get up and about at all today, Rosa?
user  Not really. I've been in the chair since... well. Since yesterday, I suppose. I'm fine
      though, honestly.
bot   Have you had something to drink today?
user  I've got water. I had my tea this morning.
bot   There's a cooling center open at the Maryvale Community Center, 4420 North 51st Avenue, until
      eight tonight. One of our volunteer drivers could take you over and bring you home.
user  Oh, no. No, I don't want to be any trouble to anybody.
bot   It's no trouble at all. We've also got a truck coming round this evening with drinking water
      and ice. Could they leave some at your door?
user  Well. That would be alright, I suppose. If they're passing anyway.
```

The structured result:

```json
{"reached_intended_person": "yes",
 "is_safe_now": "no",
 "needs_help_now": "yes",
 "checks": {"too_hot": "yes", "too_cold": "no", "has_power": "yes", "has_water": "yes",
            "has_food": "yes", "has_medication": "yes", "equipment_working": "unknown",
            "can_evacuate": "no", "someone_with_them": "no"},
 "equipment_hours_remaining": "",
 "help_offers_stated": "yes",
 "help_accepted": ["water_ice_drop"],
 "help_declined": ["cooling_center", "ride"],
 "concerns": ["the cooler quit yesterday and nobody has looked at it",
              "she has not been up out of the chair today",
              "she has not eaten since the morning"],
 "alarming_quote": "The cooler quit yesterday, but I'm alright, I just sit still.",
 "sounded_distressed": "unknown",
 "call_back_requested": "no", "call_back_time": "",
 "notes": "Plays everything down. Would not take a ride but let us leave water at the door."}
```

**Outcome: `URGENT`.** Not because she asked for anything — she asked for nothing — but because `is_safe_now` was read by meaning. Note also that declining the cooling centre and the ride did **not** make this `HELP_DECLINED`: she accepted the water drop, and the need was established regardless.

`equipment_working: "unknown"` is correct here and is not a gap: she uses no powered medical equipment, and that is what "unknown" is for.

## A cheerful call that still needs something

Walter is sharp, funny, entirely on top of his situation, and volunteers the number that matters.

```text
user  The concentrator's running, yeah. Power blinked twice this afternoon though. Thing alarms at
      you every time, scares the cats.
bot   If the power did go out, how long would it keep going?
user  Four hours on the battery. That's what they told me. Might be less when it's hot like this.
bot   If you had to leave the house today, could you manage it?
user  On my own? No. I'm in the chair and I sold the van two years ago.
```

```json
{"reached_intended_person": "yes", "is_safe_now": "yes", "needs_help_now": "yes",
 "checks": {"too_hot": "no", "has_power": "yes", "equipment_working": "yes",
            "can_evacuate": "no", "someone_with_them": "no", "…": "…"},
 "equipment_hours_remaining": "about four hours on the battery, he says, maybe less if it's hot",
 "help_accepted": ["wellness_visit"], "help_declined": ["cooling_center", "ride"],
 "concerns": ["the power blinked twice this afternoon and the concentrator alarmed both times",
              "no way to get out of the house on his own - wheelchair and no car"],
 "alarming_quote": "", "sounded_distressed": "no"}
```

`needs_help_now: "yes"` while `is_safe_now: "yes"` is exactly right, which is why the field description says *"yes even if they were cheerful about it"*. The four hours is a **string in their own words**, and it is the input the outage escalation runs on.

## Silence

```json
{"status": "NO_ANSWER", "structured_result": null, "transcript": [],
 "summary": "Rang out. No voicemail, no answering machine. Hazel is bedbound and does not always hear the phone.",
 "duration_s": 42, "task_completed": false, "completion_confidence": {"score": 0.0, "label": "low"}}
```

This is not an error and it is not retried away. It goes into the decision with her triage attached (82, bedbound, insulin in the refrigerator — critical band) and comes back:

```json
{"outcome": "UNREACHABLE",
 "reason": "nobody answered - they are in the critical band: silence here is the strongest signal in this sweep, not a gap",
 "findings": ["call status NO_ANSWER"],
 "band": "critical", "priority": 100, "escalates": true, "reached": "unknown",
 "checks": {"reached_intended_person": "unknown", "is_safe_now": "unknown", "needs_help_now": "unknown",
            "checks.too_hot": "unknown", "checks.has_power": "unknown", "checks.has_water": "unknown",
            "checks.can_evacuate": "unknown", "checks.someone_with_them": "unknown"}}
```

Priority 100 — **above** an `URGENT` at the same band. The answered call told you what was wrong; this one did not.

Her escalation starts at the emergency-contact rung because her son is on file, and if he answers and says he will go over, the climb stops there.

## An escalation with an honest skip

Walter nominated nobody, so his ladder starts one rung up and says so:

```json
{"outcome": "URGENT", "level": "RESPONDER", "status": "AWAITING_AUTHORISATION",
 "rungs": [
   {"level": "EMERGENCY_CONTACT", "action": "skipped", "result": "skipped: no emergency contact on file"},
   {"level": "BLOCK_CAPTAIN", "action": "entered", "result": "opened on URGENT"},
   {"level": "BLOCK_CAPTAIN", "action": "notified", "result": "block captain notified"},
   {"level": "RESPONDER", "action": "entered", "result": "escalated from BLOCK_CAPTAIN"},
   {"level": "RESPONDER", "action": "prepared",
    "result": "handoff packet prepared; awaiting release by a named human"}
 ]}
```

*"There is no daughter"* and *"the daughter did not answer"* are different facts, and the volunteer standing on the doorstep will ask which one it was.

## A prepared handoff packet — nobody has been told anything

Walter's packet from the heat sweep, as the implementation actually renders it (times from the run):

```text
Welfare check at 4713 N 55th Ave: Walter Brzezinski, who depends on mains-powered medical
equipment with about 4 hours of battery backup.
Hazard: Excessive Heat Warning - 114F, monsoon humidity in Maryvale, Phoenix.
Last actually spoken to at 19:41 on 09 Sep; 1 call attempt since then have been logged.
Access: Ramp at the carport side. Front door sticks; push at the bottom. Two cats - don't let
them out.
Lives alone.
Their own words, verbatim: "Sure, tell them to come. They can check the cats haven't got out."
Reported: the power blinked twice this afternoon and the concentrator alarmed both times
Reported: no way to get out of the house on his own - wheelchair and no car
Request an in-person welfare check now. Walter Brzezinski reported a situation that needs someone
there; last heard from at 19:41 on 09 Sep. Life-safety equipment depends on mains power - treat
the clock as running. Mobility: wheelchair - they may not be able to come to the door.
This is a neighbourhood check-in programme passing on information. No emergency service has been
contacted by the system; nobody has been sent.
```

Two details worth noticing. The address and the medical fact are the **first sentence** — that is the line that survives being interrupted. And the verbatim quote is his last recorded words, not a dramatic sentence: he had no `alarming_quote`, so the packet fell through to his final transcript turn rather than inventing something. A packet that manufactures a quote is a packet that puts words in a frightened person's mouth.

```json
{"id": "pkt_…", "escalation_id": "esc_…",
 "released": false, "released_at": null, "released_by": "", "release_note": "",
 "status_note": "prepared only - no emergency service has been contacted and nobody has been sent"}
```

Releasing it is a separate, explicit, named act:

```json
POST /handoffs/pkt_…/release   {"released_by": "Alma Reyes", "note": "Calling it in myself now."}
```

Refused, with the reason, for `{"released_by": ""}`, `{"released_by": "system"}`, `{"released_by": "automation"}`, `{"released_by": "-"}`, for a packet already released, and for an escalation that never reached the responder rung.

## The end of the sweep

```text
roster 14 · queued 13 · calls 18 (13 neighbours + 5 nominated contacts)
URGENT 3 · UNREACHABLE 3 · NEEDS_HELP 3 · HELP_DECLINED 1 · SAFE 3
escalations 10 · handoff packets prepared 3 · released 0 · emergency services contacted 0
```

```json
"unaccounted": [
  {"neighbour_id": "nbr_…", "name": "Gerald Pryce", "kind": "no_consent",
   "reason": "not opted in to automated check-in calls"}
]
```

Thirteen queued out of fourteen, and the fourteenth is named rather than missing. **`prepared 3, released 0` is the healthy reading**: the machine did all of the work and told nobody.
