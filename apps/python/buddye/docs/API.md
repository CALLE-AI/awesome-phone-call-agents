# BuddyE backend API

Base URL in dev: `http://localhost:8000`. **Local-only:** every endpoint except `POST /api/calle/webhook/{token}` returns `403` unless the request comes from a loopback peer with a loopback `Host`, carries no forwarding header (`X-Forwarded-For`, `Forwarded`, `CF-Connecting-IP`, …), and has no non-loopback `Origin` (`app/api/local_only.py`). All responses are JSON. CORS is open to ports 5173 and 5174 on localhost by default (`CORS_ORIGINS`).

Two conventions hold everywhere:

- **Phones are masked.** Every response carries `phone_masked`, never a raw number. `app.obs.redact` runs on the way out of anything that assembles a payload by hand.
- **Health facts are returned on purpose.** `conditions`, `power_dependent`, `access_notes` and addresses are in the roster, the escalations and the handoff packet because that is what makes them useful to the person reading them. They are not redacted, and the responses that carry them are not public artifacts.

---

## Hazards and sweeps

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/hazards` | Every hazard, newest first, each with `active_sweep_id` and a parsed `profile`. |
| POST | `/api/hazards` | Declare one. `201`. **Declaring calls nobody** — a sweep does. Body: `HazardIn`. |
| GET | `/api/hazards/{id}` | One hazard. |
| POST | `/api/hazards/{id}/sweep` | Start the sweep. `202 {sweep_id, hazard_id, state, created}`. Idempotent twice over: the handler looks for a live sweep, and a unique partial index on `sweep(hazard_id) WHERE is_active = 1` catches the double-click that gets past it. `created:false` returns the sweep already running. `404` unknown hazard, `409` if the roster is empty. |
| GET | `/api/hazards/{id}/sweeps` | Sweep summaries for this hazard, oldest first. |
| GET | `/api/hazards/{id}/calls` | Every call under this hazard — neighbours and emergency contacts alike, distinguished by `callee`. |
| GET | `/api/hazards/{id}/contract?neighbour_id=` | **Compile the call contract without dialling anybody.** The same code path the runner uses, so this is what CALL-E would be sent. Without `neighbour_id`, whoever triage puts first. |
| GET | `/api/sweeps/{id}` | One sweep summary, plus its full `triage` map and `call_order`. |
| GET | `/api/sweeps/{id}/trace` | The whole evening in one document. See below. |

### `HazardIn`

```json
{"kind": "heat", "headline": "Excessive Heat Warning — 114F, monsoon humidity", "area": "Maryvale, Phoenix",
 "severity": "advisory | watch | warning | emergency", "starts_at": "2026-09-09T10:00", "ends_at": "",
 "facts": {"temp_f": 114, "humidity_pct": 41},
 "help_offered": [{"key": "cooling_center", "label": "Cooling center", "text": "There's a cooling center open at …"}],
 "source": "NWS Phoenix AZZ537", "declared_by": "Alma Reyes"}
```

`kind` is one of `heat | cold | power_outage | flood | smoke | storm | boil_water`; anything else parses as `unknown` and is still swept, scored conservatively. `facts` is a loose dict — only `temp_f`, `humidity_pct`, `outage_eta_h` and `aqi` are computed on, everything else rides along for the UI. `help_offered[].text` is **spoken verbatim on the call**, so it is the only place a time, an address or a promise may come from.

### `HazardOut`

As above, plus `id`, `status` (`OPEN | SWEEPING | CLOSED`), `created_at`, `closed_at`, `active_sweep_id`, `sweeps` (count), and:

```json
"profile": {
  "label": "heat warning",
  "describe": "Excessive Heat Warning — 114F, monsoon humidity in Maryvale, Phoenix. It's forecast to hit 114 degrees and humidity is around 41 percent, high enough that an evaporative cooler won't cool the way it usually does.",
  "speakable_facts": ["it's forecast to hit 114 degrees", "humidity is around 41 percent, high enough that …"],
  "cuts_power": false, "may_evacuate": false, "swamp_cooler_compromised": true, "severity_weight": 1.0,
  "kind": "heat", "severity": "warning", "facts": {"temp_f": 114, "humidity_pct": 41, "outage_eta_h": null, "aqi": null},
  "derived": {"apparent_temp_f": 118.4, "evaporative_effectiveness": 0.31, "outage_eta_h_effective": 0.0,
              "outage_eta_h_assumed": false, "cuts_power": false, "may_evacuate": false, "severity_weight": 1.0},
  "description": "…"
}
```

`profile` is the hazard as triage and the caller see it, available without running a sweep. `derived.evaporative_effectiveness` is the swamp-cooler curve; `derived.outage_eta_h_assumed: true` means the hazard gave no estimate and one was assumed, which triage says out loud in its reasons.

### Sweep summary

```json
{"sweep_id": "swp_…", "hazard_id": "haz_…", "state": "COMPLETE", "is_active": false, "provider": "mock",
 "roster_size": 14, "queued": 13, "calls_made": 18, "current_index": 13,
 "outcomes": {"nbr_…": "URGENT"}, "outcome_counts": {"URGENT": 3, "UNREACHABLE": 3, "NEEDS_HELP": 3, "HELP_DECLINED": 1, "SAFE": 3},
 "unaccounted": [{"neighbour_id": "nbr_…", "name": "Gerald Pryce", "kind": "no_consent",
                  "reason": "not opted in to automated check-in calls"}],
 "escalations": 10, "escalations_open": 10, "handoffs_prepared": 3, "handoffs_released": 0,
 "error": null, "created_at": "…", "updated_at": "…", "completed_at": "…"}
```

`state` ∈ `CREATED | TRIAGING | CALLING | ESCALATING | AWAITING_HUMAN | COMPLETE | BUDGET_EXHAUSTED | FAILED`.

**`unaccounted` is a first-class field, not a footnote.** It names everyone on the roster with no outcome and why, with `kind` ∈ `no_consent` (they opted out — nobody should knock either), `not_dialled` (budget, allowlist, or the sweep ended before reaching them), `still_running` (mid-roster, they are next). `calls_made` counts every leg including calls to emergency contacts, so it exceeds `queued` on an evening with escalations.

### Contract preview (`/api/hazards/{id}/contract`)

```json
{"neighbour": {"id": "nbr_…", "name": "Walter Brzezinski", "phone_masked": "*******0101",
               "preferred_language": "en-US", "check_in_consent": true},
 "contract": {
   "task": "You are an automated check-in call from the Maryvale, Phoenix neighbourhood check-in programme…",
   "result_schema": { "…": "the exact object sent to CALL-E" },
   "objectives": ["Establish whether Walter is safe right now", "…"],
   "hard_fields": ["reached_intended_person", "is_safe_now", "needs_help_now", "checks.has_power",
                   "checks.has_medication", "checks.equipment_working", "checks.can_evacuate",
                   "checks.someone_with_them", "help_offers_stated", "call_back_requested"],
   "soft_fields": ["checks.too_hot", "…"],
   "must_return": ["…every leaf the schema marks required, arrays and quotes included"],
   "locale": "en-US",
   "help_offers": [{"key": "ride", "label": "Volunteer ride", "text": "A volunteer driver can come and take you…"}],
   "offer_keys": ["resource_center", "ride", "ice_drop", "wellness_visit"]}}
```

`hard_fields` means *the call may not come home without this fact* — **not** "this must be yes". `checks.has_power == "no"` during a blackout is not a failed requirement, it is the finding the ladder exists for. See [`CALL-CONTRACT.md`](CALL-CONTRACT.md).

---

## The roster

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/neighbours?hazard_id=` | The board. Without a hazard: a list of people, alphabetical. With one: every row carries `risk`, and the list is sorted worst-first. |
| GET | `/api/neighbours/{id}?hazard_id=` | One person: their row, their risk, every call, their escalations and any packet. |

Everyone is listed, including the neighbour who never opted in — he is on the captain's list and she still needs to see him. `check_in_consent: false` with `risk.may_call: false` says plainly that BuddyE will not ring him, which is different from pretending he is not there.

```json
{"id": "nbr_…", "name": "Rosa Delgado", "phone_masked": "*******0100", "address": "5137 W Osborn Rd", "unit": "",
 "access_notes": "Side gate is unlatched. The doorbell hasn't worked in years — knock on the kitchen window.",
 "lat": 33.4874, "lon": -112.1706, "age_band": "75_plus", "lives_alone": true,
 "conditions": ["heat sensitive", "high blood pressure"], "power_dependent": false, "power_backup_hours": 0.0,
 "cooling": "swamp_cooler", "heating": "wall_furnace", "mobility": "cane_walker", "has_transport": false,
 "preferred_language": "en-US", "contact_name": "Elena Delgado", "contact_relation": "daughter",
 "has_contact_phone": false, "check_in_consent": true, "notes": "…", "is_demo": false,
 "risk": {"neighbour_id": "nbr_…", "name": "Rosa Delgado", "hazard_id": "haz_…", "hazard_kind": "heat",
          "severity": "warning", "score": 100, "band": "critical",
          "reasons": ["cools with a swamp cooler and humidity is 41% — an evaporative cooler loses most of its cooling in damp air, so at 114F that house may only be a few degrees below outside", "…"],
          "factors": [{"key": "cooling_swamp_cooler", "points": 28.0, "reason": "…"}],
          "time_to_harm_h": null, "may_call": true, "skip_reason": "", "engine": "rules/v1"},
 "outcome": "URGENT", "outcome_reason": "…", "last_call_at": "…"}
```

`risk` is present only when the request named a hazard — triage is about a person *under a hazard*, and there is no "high-risk neighbour" field anywhere in this system. When a sweep exists, the **stored** triage is returned rather than a fresh score: it is what the calls were actually ordered by, and re-scoring live would quietly disagree with the record if the roster has been edited since. `time_to_harm_h: null` means no clock, **not** no risk.

`has_contact_phone` (not the number) says whether the escalation ladder has a first rung to work at all.

---

## Escalations and handoffs

**Nothing in this section contacts anybody.** These routes read the ladder back, let a captain close an escalation with her name on it, and expose the one transition that turns a prepared handoff packet into a released one. The interesting property is what is missing: there is no endpoint here, or anywhere in this codebase, that places a call to an emergency service.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/escalations?hazard_id=&sweep_id=&open_only=` | The ladder, per neighbour, with every rung. |
| GET | `/api/escalations/{id}` | One escalation. |
| POST | `/api/escalations/{id}/resolve` | Close it. Body `{resolved_by, note?}`. **`resolved_by` is required and must be a person.** `400` without one, `409` on an illegal transition. |
| GET | `/api/handoffs?hazard_id=&unreleased_only=` | Prepared responder packets. |
| GET | `/api/handoffs/{id}` | The whole page a responder would be given, including snapshots and attempts. |
| POST | `/api/handoffs/{id}/release` | **The only path from prepared to released.** Body `{released_by, note?}`. `400` if the name is empty, is not a name, or is `"system"` / `"automation"` / any other non-human. `409` if the escalation is not `AWAITING_AUTHORISATION`, or the packet was already released. |

### Escalation

```json
{"id": "esc_…", "sweep_id": "swp_…", "hazard_id": "haz_…", "neighbour_id": "nbr_…", "name": "Walter Brzezinski",
 "address": "4713 N 55th Ave", "outcome": "URGENT",
 "level": "EMERGENCY_CONTACT | BLOCK_CAPTAIN | RESPONDER",
 "status": "OPEN | CONTACT_REACHED | AWAITING_AUTHORISATION | RELEASED | RESOLVED | CANCELLED",
 "reason": "…", "trigger_call_id": "call_…",
 "rungs": [{"level": "EMERGENCY_CONTACT", "action": "skipped", "at": "…",
            "result": "no emergency contact on file", "note": "", "call_id": null}],
 "contact_name": "", "contact_relation": "", "resolved_by": "", "resolved_note": "",
 "created_at": "…", "updated_at": "…", "resolved_at": null,
 "handoffs": [ /* packets, shape below */ ]}
```

`rungs` is the audit trail and it distinguishes *"we called her daughter and nobody picked up"* from *"she never gave us a daughter"* — a captain standing on a doorstep will ask exactly that.

### Handoff packet

```json
{"id": "pkt_…", "escalation_id": "esc_…", "neighbour_id": "nbr_…", "hazard_id": "haz_…",
 "recommended_action": "Request an in-person welfare check now. Walter Brzezinski reported a situation that needs someone there; last heard from at 19:41 on 09 Sep. Life-safety equipment depends on mains power — treat the clock as running. Mobility: wheelchair — they may not be able to come to the door.",
 "spoken_script": "Welfare check at 4713 N 55th Ave: Walter Brzezinski, who depends on mains-powered medical equipment.\nHazard: Power outage — 6,100 customers out across Maryvale in Maryvale, Phoenix.\n…\nThis is a neighbourhood check-in programme passing on information. No emergency service has been contacted by the system; nobody has been sent.",
 "last_words": "The concentrator's got about four hours in it and then that's that.",
 "concerns": ["…"], "last_contact_at": "…", "prepared_at": "…",
 "released": false, "released_at": null, "released_by": "", "release_note": "",
 "status_note": "prepared only — no emergency service has been contacted and nobody has been sent"}
```

`GET /api/handoffs/{id}` adds `neighbour_snapshot`, `hazard_snapshot` and `attempts_summary`. The packet is a **snapshot**: what was true when it was cut is what a responder would be told, and it stays that way even if the roster row is edited afterwards.

`released` and `status_note` are stated in the payload rather than left to be inferred from a null, because a client that renders a prepared packet as though it had been sent is the exact failure this design exists to prevent.

---

## Incidents

An escalation is about reaching a human being; an **incident** is about sending resources to an
address. The prose is in [`DISPATCH.md`](DISPATCH.md); the shapes are here.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/incidents?hazard_id=&sweep_id=&open_only=` | Sorted worst-first — priority 1 is life safety, and a board sorted by time of arrival buries it. |
| POST | `/api/incidents/sync` | `{sweep_id?, hazard_id?}` — reconcile escalations into incidents. **Idempotent**, keyed on `escalation_id`; safe to call repeatedly. Omit both to sync every active hazard. |
| GET | `/api/incidents/{id}` | Full: the incident, its dispatches, its operator actions, its documents and correspondence. |
| GET | `/api/incidents/{id}/candidates` | **The eligibility report.** `{candidates[], excluded[], needs{}, radius_miles, error}` — who could legally go, in deterministic rank order, and a named sentence for everybody who could not. |
| POST | `/api/incidents/{id}/resolve` | `{resolved_by, resolution}`. A name, because "resolved" with nobody attached says somebody checked when nobody did. |

An incident carries `status` (`OPEN | TRIAGED | DISPATCHED | ON_SCENE | RESOLVED | HANDED_OFF |
CANCELLED`), `priority` 1-5 with `priority_label` (`life safety … routine`), `needs[]`, `outcome`,
`summary`, `address`, `lat`, `lon`, and the ids tying it back to the hazard, sweep, neighbour and
escalation.

`candidates[]` entries carry `asset_id`, `call_sign`, `kind`, `matched[]`, `preferred_matched[]`,
`unmet[]`, `distance_miles`, `eta_minutes`, `spare_capacity`, `capacity`, `fit`,
`requires_authorisation` and a written `reason`. `excluded[]` entries carry `asset_id`, `call_sign`,
`kind`, a `code` (`status | committed | capacity | authorisation | capability | radius | speed |
no_needs | no_location`) and a full sentence. **Show the exclusions.** A coordinator who asks "why
didn't you send WV-2?" and gets silence stops using the tool.

## Assets

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/assets?available_only=&kind=` | The whole fleet, static fields plus a live `destination` block when a unit is moving. |
| GET | `/api/assets/positions` | **What the map polls.** Deliberately small: only the fields that change. |
| GET | `/api/assets/{id}` | One asset plus its dispatch history. |

Every coordinate here is a column on the `Asset` row that the movement simulator advanced on a wall
clock. It is not a seed for a browser animation — see [`MAP.md`](MAP.md). `requires_authorisation` on
each asset comes from `domain.state.requires_authorisation`, not from a hand-written list, and an
unreadable kind returns `true`.

```json
// GET /api/assets/positions
{"assets": [{"id": "ast_…", "call_sign": "WV-1", "kind": "WELLNESS_VAN", "status": "EN_ROUTE",
             "lat": 33.4996, "lon": -112.1723, "heading_deg": 214.6,
             "requires_authorisation": false, "dispatch_id": "dsp_…", "progress": 0.4137,
             "last_moved_at": "2026-09-09T…Z"}],
 "count": 12, "en_route": 3}
```

`GET /api/assets` adds `operator_name`, `capabilities[]`, `capacity`, `served_this_shift`,
`spare_capacity`, `speed_mph`, `base_lat/base_lon`, `notes`, and when moving:

```json
"destination": {"incident_id": "inc_…", "address": "…", "lat": 33.49, "lon": -112.17,
                "progress": 0.41, "remaining_miles": 0.83, "eta_minutes": 2.5,
                "route": [[33.50, -112.17], …], "status": "EN_ROUTE"}
```

`eta_minutes` here is recomputed from the **remaining** length of the route, not read off the
dispatch row: the stored value is the promise made at departure, this is the answer to "when will it
be here?" asked now. Both are on the wire and they mean different things.

## Dispatch

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/dispatch?hazard_id=&incident_id=&status=` | |
| GET | `/api/dispatch/pending` | **The queue of things waiting on a human.** Prepared agency units: routed, timed, justified, and not requested. |
| POST | `/api/dispatch/propose` | `{incident_id, auto: true}` — filter, ask the agent to rank among the legal candidates, re-validate, write `PROPOSED`. With `auto` it also commits and starts community resources. |
| GET | `/api/dispatch/{id}` | |
| POST | `/api/dispatch/{id}/commit?start=true` | Community resources only. **409 with a sentence** for an agency unit. |
| POST | `/api/dispatch/{id}/authorise?start=true` | `{name, note}` — the only door an agency unit can take. A blank name is a 400 and so is `"system"`. Also releases any unreleased handoff packet behind the same incident. |
| POST | `/api/dispatch/{id}/decline` | `{name, reason}` — both required. Only from `PROPOSED`. |
| POST | `/api/dispatch/{id}/start` | `COMMITTED → EN_ROUTE`: computes the route and the ETA and hands the asset to the simulator. |
| POST | `/api/dispatch/{id}/complete?note=` | `ARRIVED → COMPLETED`; frees the asset. |

A dispatch payload:

```json
{"id": "dsp_…", "incident_id": "inc_…", "asset_id": "ast_…", "call_sign": "R-15",
 "kind": "EMS_UNIT", "operator_name": "Phoenix Fire Rescue 15", "status": "PROPOSED",
 "reason": "R-15 covers medical, assess, 1.9 mi out, about 4 min, 1 of 1 stops left this shift — agency unit: stays proposed until a named human approves it",
 "proposed_by": "agent", "committed_by": "", "requires_authorisation": true,
 "authorised_by": "", "authorised_at": null, "decline_reason": "",
 "distance_miles": 1.9, "eta_minutes": 3.6, "route": [[…]], "progress": 0.0,
 "proposed_at": "…Z", "committed_at": null, "arrived_at": null, "completed_at": null,
 "address": "…", "incident_lat": 33.49, "incident_lon": -112.17,
 "asset_lat": 33.506, "asset_lon": -112.149,
 "status_note": "prepared only — an agency unit stays proposed until a named human approves it, and nobody has been asked"}
```

`POST /api/dispatch/propose` additionally returns `source` (`model | deterministic`),
`fallback_reason`, `model`, `latency_ms`, `action_id` and `justification`. A coordinator reading
"WV-2 is on its way" is entitled to know whether that was a judgment or a default, and which model
made it if either.

**`status_note` is stated, not inferred**, for the same reason the handoff packet states `released`.
No verb in the interface may imply dispatch for a `PROPOSED` agency unit.

## Documents and correspondence

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/documents?hazard_id=&incident_id=` | |
| POST | `/api/documents/generate` | `{form, hazard_id?, incident_id?, to, to_position, subject, prepared_by}`. `form` ∈ `ICS-214 | ICS-213 | situation_report`. |
| GET | `/api/documents/{id}` | |
| POST | `/api/documents/{id}/approve` | `{approved_by}` — a human signs it. Same name rule; a form signed by `"system"` is a form nobody signed. |
| GET | `/api/correspondence?hazard_id=&incident_id=` | |
| POST | `/api/correspondence/draft` | `{kind, incident_id, agency, channel, to_name}`. `kind` ∈ `contact | family | agency`. |
| GET | `/api/correspondence/{id}` | |
| POST | `/api/correspondence/{id}/approve` | `{approved_by}`. |

A generated document has `approved_by: ""` and there is no path in the agent that could fill it. A
drafted message has `sent_at: null` and **there is no send path in this codebase**: approving a
message means a named person read the words and is willing to have them go out under their name. It
does not mean anybody was contacted, and `sent_at` stays null after approval — exactly the boundary
`HandoffPacket.released_at` draws.

Both approve endpoints run the name through the escalation ladder's `_validate_releaser`, so a
service account is a 400 on all four of these surfaces: releasing a packet, authorising a dispatch,
signing a form, and approving a message.

---

## Observability, demo, health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/stream/hazards/{id}?since_event_id=N` | **SSE.** Replays events with id > N from the DB, then streams live. |
| GET | `/api/stream/hazards/{id}/history?since_event_id=N` | The same events as one JSON array (initial load, or a polling fallback). |
| GET | `/api/dashboard` | Derived counts for the tiles. |
| GET | `/api/health` | `{ok, provider, calls_recorded, active_sweeps[], emergency_contacts_callable, handoff_min_band}` |
| POST | `/api/demo/reset` | Cancels in-flight sweep drivers, wipes, re-seeds. The `SpentCall` ledger survives. |
| POST | `/api/demo/outage` | Declares the power cut over the same roster. Idempotent by kind. **Dials nobody.** |
| GET | `/api/calle/status` | CALL-E connection preflight. **Never places, plans, or schedules a call.** Served from a background snapshot; the budget count is always fresh. |
| POST | `/api/calle/webhook/{token}` | CALL-E terminal webhook receiver. Not for the UI. |

### Dashboard

```json
{"neighbours": 14, "consenting": 13, "hazards_open": 2, "active_sweeps": 0, "calls_made": 18,
 "outcome_counts": {"URGENT": 3, "UNREACHABLE": 3, "NEEDS_HELP": 3, "HELP_DECLINED": 1, "SAFE": 3},
 "unaccounted": 1, "escalations_open": 10, "handoffs_prepared": 3, "handoffs_released": 0,
 "real_calls_used": 0, "real_calls_budget": 4, "provider": "mock",
 "block_captain": "Alma Reyes", "area": "Maryvale, Phoenix"}
```

`handoffs_prepared` next to `handoffs_released` is deliberate: `3 / 0` is the healthy reading.

### CALL-E status

```json
{"provider": "mock | calle_sdk | calle_mcp", "ready": true, "live": false,
 "sdk": {"importable": true, "version": "0.7.0", "api_key_present": false, "base_url": "https://api.heycall-e.com"},
 "cli": {"found": true, "authenticated": true, "expires_at": "…", "server_url": "…"},
 "mcp": {"reachable": true, "tools": ["plan_call", "run_call", "get_call_run"], "server_url": "…"},
 "allowlist_count": 0, "budget": {"max": 4, "used": 0, "remaining": 4, "enforced": true},
 "webhook_configured": false, "reconciler": "none | glm | anthropic", "checked_at": 1757000000.0}
```

Booleans only; no key is ever returned. `live` is false for the mock provider; `ready` means the selected provider has what it needs.

### The trace (`/api/sweeps/{id}/trace`)

One JSON document answering *"did the CALL-E integration really work, and did it behave?"* without anyone having had to watch the screen. Per call it carries what was **sent** (`task`, `result_schema`, `risk_snapshot` — why this person was called when they were, `help_offered`), what was **returned** (`structured_result`, `provider_raw`, `task_completed`, `completion_confidence`, `evidence`, the transcript, CALL-E's own developer events), and what was **done with it** (`validation_errors`, `reconcile_meta`, `outcome`, `outcome_reason`, `concerns`, `poll_count`, `webhook_received`).

Top level: `sweep`, `hazard`, `triage` (worst-first, with reasons), `calls[]`, `escalations[]`, `handoffs[]`, `unaccounted`, `summary`, `timeline`, and:

```json
"safety": {"handoffs_prepared": 3, "handoffs_released": 0, "released_by": [],
           "emergency_services_contacted": 0,
           "note": "BuddyE prepares responder handoffs and never sends them. A packet with released_at = null has told nobody anything."}
```

Redacted on the way out (phones, credential-shaped keys), which is honestly less than it sounds: `obs.redact` does not know that `address` or `conditions` are sensitive, and this document contains both by design. It is an audit record for the captain, not a public artifact.

---

## SSE events

Each message: `id: <event id>`, `event: <type>`, `data: <json>` where data is

```json
{"id": 12, "hazard_id": "haz_…", "sweep_id": "swp_… | null", "neighbour_id": "nbr_… | null",
 "type": "<type>", "payload": {}, "created_at": "…"}
```

**The topic is the hazard, not the sweep**, so a captain who opens the board mid-evening gets the triage, the calls, the escalations and any second sweep of the same block on one connection; `sweep_id` and `neighbour_id` ride along so a client filters without a second stream. A `ping` (`{"last_event_id": N}`) is sent every 15 s of silence. Reconnect with `?since_event_id=<last id you saw>` and the server replays what you missed from the `AgentEvent` table, in order.

### Sweep lifecycle

| type | payload | meaning |
| --- | --- | --- |
| `hazard.declared` | `{kind, headline, severity, facts}` | A hazard exists. Nobody has been called. |
| `sweep.created` | `{provider}` | A sweep was requested. |
| `hazard.status` | `{status}` or `{status, open_escalations}` | `OPEN` / `SWEEPING` / `CLOSED`. |
| `sweep.state` | `{from, to, …}` | State-machine transition. `to` ∈ the `SweepState` values. `FAILED` carries `{error}`. |
| `sweep.resumed` | `{state}` | A driver re-attached after a restart. |
| `sweep.triaged` | `{hazard{kind,headline,severity}, queued, roster, order[{neighbour_id, name, score, band, time_to_harm_h, may_call, skip_reason, reasons[]}]}` | **The whole roster scored against this hazard**, worst first, including the people who will not be dialled. |
| `neighbour.skipped` | `{neighbour_id, name, band, reason, dialled: false}` | On the roster, not in the call order — no consent. Emitted at triage time so nobody vanishes silently. |
| `sweep.advanced` | `{next_index, remaining}` | Moving to the next neighbour. |
| `sweep.unaccounted` | `{count, people[{neighbour_id, name, kind, reason}]}` | Emitted whenever the sweep reaches a terminal state. `kind` ∈ `no_consent | outcome_unknown | not_dialled | still_running`. **Read this one.** |
| `sweep.provider_error` | `{call_id, code, message, details, fatal: true}` | CALL-E rejected something that applies to everybody (`result_schema_invalid`, `unauthorized`, `insufficient_balance`). The sweep ends before another dial. |
| `sweep.halted_outcome_unknown` | `{call_id, neighbour_id, name, reason, note}` | A call's outcome could not be established: an ambiguous create (timeout, 5xx, no call id), a poll deadline, or a restart that found a dial with no provider id. The sweep ends `FAILED` (terminal, never resumed) with no escalation and no further dial; the person is `outcome_unknown` in `sweep.unaccounted`. |
| `demo.reset` | `{headline, kind, neighbours, sweeps_cancelled[]}` | The board was wiped and re-seeded. |

### One call

| type | payload | meaning |
| --- | --- | --- |
| `call.started` | `{call_id, neighbour_id, name, callee, phone_masked, provider, idempotency_key, locale, risk{…}, contract{task, result_schema, objectives[], hard_fields[], soft_fields[], must_return[], help_offers[]}}` | **The call contract, before the dial.** Render `contract.result_schema` as the "schema in", and `risk` as why this person is being called now. |
| `call.skipped` | `{neighbour_id, name, callee?, dialled: false, reason}` | Not dialled: no consent on file, not allowlisted, or the budget is spent. Never confused with "did not answer" — their phone never rang. |
| `call.resuming` | `{call_id, neighbour_id, callee}` | Re-attaching to a call that was in flight when the process restarted. |
| `provider.<type>` | `{call_id, neighbour_id, callee, message, status, provider_call_id, details}` | Provider lifecycle, forwarded verbatim. Mock emits `provider.call.queued`, `.dialing`, `.in_progress`, `.transcript_turn` (details `{speaker, text, offset_seconds}`), `.completed`, `.no_answer`. The SDK provider emits `provider.call.created`, `provider.call.status.<status>`, `provider.call.resumed`, `provider.call.events_unavailable`, and CALL-E's own developer events under their own type. The MCP provider emits `provider.mcp.plan_call` / `provider.mcp.run_call`. |
| `call.completed` | `{call_id, neighbour_id, name, callee, status, structured_result, validation_errors[], summary, duration_s, transcript[], failure_code, failure_message, task_completed, completion_confidence, evidence[]}` | **The structured result.** `status` ∈ `COMPLETED | NO_ANSWER | FAILED | INVALID_RESULT`. A `NO_ANSWER` is a completed *event* with a `null` result — not an error, and not the absence of an event. |
| `call.failed` | `{call_id, neighbour_id, name, callee, code, message, details}` | The provider rejected this recipient (`invalid_phone`, `recipient_blocked`, …). This becomes a `FAILED` leg, goes to `decide()`, and comes back `UNREACHABLE`. |
| `call.outcome_unknown` | `{call_id, neighbour_id, name, callee, status: "UNKNOWN", provider_call_id, failure_code, failure_message, note}` | We cannot tell whether the phone rang. Not a finding and not a skip: it never reaches `decide()`, the roster stops, and this person is not dialled again from this database until a human has checked the call in CALL-E. A definite `4xx` refusal is not this: it stays a `FAILED` leg reported as "no call was placed". |
| `reconcile.started` | `{call_id, fields[], reconciler}` | An LLM pass over the transcript, on the failing fields only. |
| `reconcile.finished` | `{call_id, patched_fields[], structured_result, validation_errors[], meta}` | Merged result. It may resolve unknowns; it may not overturn a definite answer. |
| `reconcile.skipped` | `{call_id, fields[], reason}` | Unknown fields, no reconciler configured — the unknowns stay and are escalated as findings. |
| `check.decided` | `{call_id, neighbour_id, name, outcome, reason, concerns[], last_words, findings[], checks{}, unresolved[], help_accepted[], help_declined[], reached, band, priority, escalates}` | **The finding.** Deterministic, no model. `outcome` ∈ `SAFE, HELP_DECLINED, NEEDS_HELP, URGENT, UNREACHABLE`. See [`ESCALATION.md`](ESCALATION.md) for the table. |

### The ladder

| type | payload | meaning |
| --- | --- | --- |
| `escalation.opened` | `{escalation_id, neighbour_id, name, outcome, level, band, priority, reason}` | Anything that is not SAFE opens one. `level` is the *starting* rung — `BLOCK_CAPTAIN` when no emergency contact is on file. |
| `escalation.exists` | `{escalation_id, neighbour_id, name, status, level, note}` | Already escalated in this sweep; a second ladder is not opened. |
| `escalation.rung` | `{escalation_id, neighbour_id, level, result, note}` | A rung was worked. `result: "reached"` on the emergency-contact rung stops the climb: a human with a key is on their way. |
| `escalation.notified` | `{escalation_id, neighbour_id, name, level, captain, outcome, reason, concerns[], last_words}` | The block captain has been told. This is a notification, not a dispatch. |
| `handoff.not_prepared` | `{escalation_id, neighbour_id, band, reason}` | Below `HANDOFF_MIN_BAND`, so no responder packet was cut. Cutting one for every routine no-answer would train the captain to ignore them. |
| `handoff.prepared` | `{packet_id, escalation_id, neighbour_id, name, outcome, band, recommended_action, spoken_script, released: false, note: "prepared only — no emergency service has been contacted and nobody has been sent"}` | **A page exists on a screen. Nobody has been told anything.** |
| `handoff.released` | `{packet_id, escalation_id, released_by, note, recommended_action}` | A **named human** decided a responder should be told. This event can only ever follow `POST /api/handoffs/{id}/release`. |
| `escalation.resolved` | `{escalation_id, resolved_by, note}` | A named human closed it: this neighbour is accounted for. |

### The operator layer

| type | payload | meaning |
| --- | --- | --- |
| `incident.opened` | `{incident_id, escalation_id, neighbour_id, sweep_id, outcome, priority, priority_label, needs[], address, lat, lon, summary, status}` | An address that needs something. One per escalation; a second sync does not emit it again. |
| `dispatch.proposed` | the dispatch payload above, plus `source`, `fallback_reason`, `model`, `latency_ms`, `action_id`, `justification` | A unit has been chosen and written as `PROPOSED`. **Nothing has been committed.** |
| `dispatch.awaiting_authorisation` | the same, plus `note` | **An agency unit is prepared and NOT requested.** Emitted as its own event so a board does not have to notice a boolean. This is the one to make loud. |
| `dispatch.none_available` | `{incident_id, needs[], error, excluded[], note}` | Nothing legal to send. "Nobody was sent" arrives with the sentences saying why — not silence. |
| `dispatch.committed` | the dispatch payload | A community resource was committed. `committed_by: "agent"` when nobody clicked. |
| `dispatch.authorised` | the dispatch payload | **A named human approved it.** `authorised_by` is a person. This event cannot occur without `POST /api/dispatch/{id}/authorise`. |
| `dispatch.declined` | the dispatch payload with `decline_reason` populated | A named human said no, and why. |
| `dispatch.en_route` | the dispatch payload with `route[]` and `eta_minutes` | Rolling. The route is the polyline the ETA was measured along and the one the simulator walks. |
| `dispatch.completed` | the dispatch payload | Job done, asset freed. |
| `asset.moved` | `{dispatch_id, asset_id, call_sign, lat, lon, heading_deg, progress, remaining_miles, eta_minutes, arrived: false, incident_id}` | One tick of real movement. Position is server state; see [`MAP.md`](MAP.md). |
| `asset.arrived` | the same with `arrived: true`, `eta_minutes: 0.0` | On scene. Also moves the incident to `ON_SCENE` on the first arrival. |

`asset.moved` fires every `MOVEMENT_TICK_S` (default 2.0s) per moving unit. A client may interpolate
between two of them for smoothness; it must never invent a position, and it never needs to.

**One gap worth knowing about.** `POST /api/dispatch/{id}/authorise` also releases any unreleased
handoff packet behind the same incident's escalation — the `HandoffPacket` row gets `released_at` and
`released_by` set to the same person — but it emits **no `handoff.released` event**. That event is
published only by `POST /api/handoffs/{id}/release`. A board that tracks release state purely from
the stream will show that packet as still prepared until it refetches
`GET /api/escalations/{id}` or `GET /api/handoffs/{id}`. Refetch on `dispatch.authorised`.

### A typical mock evening

```text
hazard.declared → sweep.created → hazard.status SWEEPING → sweep.state TRIAGING → sweep.triaged
  → neighbour.skipped (Gerald, no consent) → sweep.state CALLING
  → call.started (Rosa) → provider.call.queued/dialing/in_progress → provider.call.transcript_turn ×18
  → provider.call.completed → call.completed → check.decided URGENT
  → escalation.opened (EMERGENCY_CONTACT) → call.started (Elena, callee=emergency_contact)
  → escalation.rung reached → sweep.advanced
  → … Walter: check.decided URGENT → escalation.opened (BLOCK_CAPTAIN — no contact on file)
       → escalation.notified → handoff.prepared  ← released: false, and it stays false
  → … Hazel: provider.call.no_answer → call.completed NO_ANSWER → check.decided UNREACHABLE
       → escalation.opened → call.started (Dennis) → escalation.rung reached
  → sweep.advanced … to the end of the roster …
  → sweep.unaccounted → sweep.state COMPLETE → hazard.status OPEN
```

and, on the operator side, running alongside it from the moment the first escalation opens:

```text
incident.opened (Rosa, priority 1, needs water/ice/assess)
  → dispatch.proposed WV-1  ← source: model | deterministic, either way it is legal
  → dispatch.committed → dispatch.en_route
  → asset.moved ×N (every 2 s, real progress along the real route)
  → asset.arrived → incident goes ON_SCENE

incident.opened (Walter, priority 1, UNREACHABLE + critical)
  → dispatch.proposed 812A
  → dispatch.awaiting_authorisation  ← and it stays there. Nobody has been asked.
       … a coordinator clicks, with their name …
  → dispatch.authorised (authorised_by: a person) → dispatch.en_route
       (the linked handoff packet is released by the same click — refetch it, see the note above)
```

That last transition is not a bug. A hazard goes to `CLOSED` only when **every neighbour has an outcome and every escalation is resolved**; on the seeded evening ten escalations are open and Gerald opted out, so it settles back to `OPEN`. Anything else would be a tidy ending the block has not earned.

The sweep does not stop when someone answers, and it does not stop when a packet is prepared: `AWAITING_HUMAN` transitions straight back to `CALLING`, because a prepared handoff must never be the reason the rest of the block goes unchecked.
