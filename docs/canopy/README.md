# Canopy: hazard-triggered welfare roll call

Long-form guide for [`apps/typescript/canopy`](../../apps/typescript/canopy/) and the
[`hazard-roll-call`](../../skills/hazard-roll-call/) skill.

## The problem, with numbers

Heat is the deadliest weather hazard in most of the world, and it kills quietly, indoors, one person
at a time.

| Fact | Source |
| --- | --- |
| 61,672 heat-related deaths in Europe in summer 2022; 47,690 in 2023 | Ballester et al., Nature Medicine 2023; Nature Medicine 2024 |
| 739 deaths in Chicago in five days in July 1995, concentrated among isolated older people | Klinenberg, Heat Wave (2002) |
| 645 heat deaths in Maricopa County (Phoenix) in 2023, 602 in 2024 | Maricopa County Department of Public Health |
| Only 30% of older people were phoned about their welfare during a heat wave | Nitschke et al., 2013 (South Australia) |
| Proactive phone contact with over-80s cut excess heat-wave mortality: RR 0.70 (95% CI 0.54-0.92), adjusted IRR 0.44 | Orlando et al., IJERPH 2021, Rome "Viva gli Anziani" |
| Paris keeps a registry of about 10,650 vulnerable people and phones them through an outsourced call centre within 48 hours of an alert | Mairie de Paris (REFLEX, ex-CHALEX) |
| Philadelphia's inbound Heatline took 81 calls in a three-day heat emergency | WHYY, 2023 |
| Ahmedabad's Heat Action Plan averts about 1,190 deaths a year, but its outreach is one-way messaging with weak last-mile follow-up | Hess et al., 2018; Urban Science 2020 |
| 4.5 million at-risk US Medicare beneficiaries, over 3 million dependent on electricity-powered medical devices, are reached by hand during outages | HHS emPOWER |

The pattern is consistent: the registry exists, the evidence that a two-way phone call saves lives
exists, and the bottleneck is the hours it takes humans to dial. Inbound hotlines reach dozens; outbound
registries reach thousands.

## What already exists, and where Canopy sits

Two-way AI welfare calls are not hypothetical. In July 2026, EmblemHealth reached 16,000 members in 24
hours during a New York heat wave with Hippocratic AI's climate agents; 10% needed further help. Naver's
CLOVA CareCall runs in 128 Korean municipalities and, in the 2026 summer, caught up to five times as
many warning signs as the year before; one unconscious person was found after missed checks. Those
products are sold to US health insurers and Korean city governments.

The organisations that actually own emergency registries elsewhere, such as city emergency management
offices, district health departments, Red Cross chapters, Meals on Wheels programmes and community
health worker networks, cannot buy them. Canopy is that capability as an open, hazard-agnostic
workflow on CALL-E, in any language CALL-E speaks, for any registry that fits in a CSV.

## How it works

```
alert feed or operator  ->  hazard event  ->  risk-ordered waves
                                                    |
                                   one CALL-E call task per wave
                                   recipients[], per-recipient schema,
                                   task-level aggregate, idempotency key
                                                    |
                              terminal webhook (checked, de-duplicated,
                              re-fetched) or polling, whichever comes first
                                                    |
                                   fail-closed verdict per person
                                   green | yellow | red | unreachable | unverified
                                                    |
                   +----------------+---------------+------------------+
                 close          follow-up       escalation call     door-knock list
                                (due time)      to the contact      for a human
                                                (CALL-E again)
                                                    |
                                    dispatch tickets; a human approves
                                    anything involving emergency services
                                                    |
                                   append-only ledger -> live dashboard
                                                     -> after-action report
```

### CALL-E usage in detail

| Surface | Use in Canopy |
| --- | --- |
| `POST /v1/calls` via `@call-e/calle` `client.calls.create` | One task per wave. `recipients[]` with `phones`, `locale`, `region` per person. |
| `recipient_result_schema` | `answered_by`, `is_cool`, `hydrated`, `symptoms[]`, `confusion_suspected`, `needs[]`, `tier`, `notes`. Enum descriptions carry the selection rules. |
| `result_schema` | `green_count`, `yellow_count`, `red_count`, `not_reached_count` for the wave. |
| `metadata` | `event_id`, `wave`, `attempt`, `person_ids`; in dry-run also the scenario hints for the fake server. |
| `Idempotency-Key` | `canopy:<event>:wave<n>:attempt<m>` and `canopy:<event>:escalation:<person>`. |
| `webhook_url` | Terminal events to `/calle/webhook`; header checked, de-duplicated, then `GET /v1/calls/{id}`. |
| `GET /v1/calls/{id}/events` | Developer events streamed into the ledger and dashboard timeline while a call is in flight. |
| `completion_confidence`, `evidence[]`, `transcript_turns[]` | Confidence gates green; user turns become the report's "in their words" quotes; first bot-turn offsets flag silent starts. |
| A second `client.calls.create` | The escalation call to the emergency contact, with its own schema (`reached`, `will_check`, `eta_minutes`, `wants_emergency_services`). |
| Agent Skill | `skills/hazard-roll-call` lets Claude Code, Codex or any Agent-Skills host drive the same workflow with the same safety rules. |

### Why the decisions are not left to the agent

The fake-server drill in `test/e2e.test.ts` shows the reason in one line: Harold's agent-assigned tier
is `yellow`, but `confusion_suspected` is `true`, so Canopy's verdict is `red` and his daughter is
phoned. Confusion is the heat-stroke sign that kills; a model that under-rates it once is one too many.
Every rule in `classify.ts` and `cascade.ts` is a pure function with a test, and the agent's own tier is
kept beside the verdict so the report shows every disagreement.

## Demo guide (about three minutes)

1. `npm run plan`: the registry is scored and the wave order is printed with masked numbers and the
   reasons. Point at the rendered task: the disclosure line, the four questions, the emergency number.
2. `npm run serve`, open the dashboard, press "Start drill". Watch the map fill: green, yellow, two reds,
   one grey. The timeline shows the CALL-E call task ids, the dialing events, the webhooks arriving.
3. Open the dispatch queue: Miguel asked for emergency services for Rosa, and that ticket is waiting for
   a human. Approve it. Sarah is on her way to Harold, ETA 15 minutes. Samuel has no contact and is on
   the door-knock list.
4. Open the after-action report. Reach rate, tiers, "in their words" quotes, tickets, platform
   observations (one recipient's first bot turn started 23 seconds in).
5. For a live demonstration, set `CANOPY_MODE=live`, an API key, `CANOPY_LIVE_ALLOWLIST` with the
   consenting demo participants, and run with `--confirm`. Real phones ring, in the language on each
   registry row, and the same dashboard fills from real CALL-E results.

## Ethics and compliance notes

- Opt-in registry only; consent and its date are stored per row.
- The AI discloses itself in the first sentence of every call.
- Emergency-purpose calls fall under the TCPA emergency exception in the US; Canopy discloses anyway.
- No diagnosis, no dosing advice. Red flags: call the emergency number, and a human is alerted.
- Canopy never contacts emergency services itself; a person approves that ticket.
- Phone numbers are masked everywhere except the operator's own registry file.

## Feedback for the CALL-E team (collected while building)

1. No cancel operation on the Calls API. A roll call needs to stop a wave that has not started dialing
   when an operator says so; today the only mitigation is small sequential waves.
2. No server-side scheduling on the Calls API, so follow-up waves must be driven by a host scheduler.
   A `scheduled_at` on `POST /v1/calls`, matching the MCP `plan_call` field, would close the gap.
3. No `answered_by` disposition from the platform; voicemail detection has to be delegated to the
   extraction schema, which is weaker than a platform signal.
4. Webhooks are unsigned; the `CALL-E-Event-Id` equality check is a consistency check, not
   authentication. An HMAC header would let receivers trust the payload without a re-fetch.
5. `failure_code` is not a published enum, so a client cannot distinguish "declined" from "carrier
   rejected" without heuristics.
6. A queued call can dial long after the client's wait timed out (issue #283). Canopy therefore never
   trusts `waitForResult` and drives everything from webhooks plus polling; documentation could steer
   developers the same way.
7. The delay before the first bot word (issue #295) matters more for elderly recipients than for
   businesses; a configurable "speak first" behaviour or a faster connect path would help welfare
   use cases.

## Roadmap

- Registry import from Everbridge, Rave and emPOWER exports.
- A Goal-Runs variant of the per-person check so `no_answer` and `declined` arrive as typed codes.
- Volunteer pools: when a contact cannot go, call the nearest registered volunteer.
- Pilot with one city emergency management office or one community health worker network, measuring
  reach rate and time-to-reach against their manual baseline.
