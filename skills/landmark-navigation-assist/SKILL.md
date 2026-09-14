---
name: landmark-navigation-assist
description: Turns a pre-written, building-level location config into a CALL-E outbound phone-call task that guides a delivery driver through the last few hundred metres to a specific building using landmarks instead of GPS or postal text. Use when a driver requests navigation help for an address that already has known landmark/approach notes; not for addresses with no config, and not as a replacement for turn-by-turn GPS on the earlier, unambiguous part of a route.
license: MIT
---

# Landmark Navigation Assist

**Purpose:** Turns a pre-written, building-level location config into a CALL-E `task` instruction that guides a delivery driver (or repeat ride-hailing pickup) through the last few hundred meters to a specific building, using landmarks instead of GPS/text directions. Built for addresses where map pins and postal text routinely fail — landmark-based, informally-numbered, or newly-built areas — and the driver's own support call would otherwise be the fallback.

Not an address-reader. It's a guided conversation: the agent asks which direction the driver is approaching from, gives turn-by-turn landmark instructions for that direction, confirms the building by its distinguishing features, and only offers a human escalation contact if the driver is still stuck after being guided.

## Key Features

- **Config-driven, not hardcoded.** One JSON config per physical building (see `references/location-config.schema.json`), authored once and reused for every delivery to that address — this is what makes the skill reusable across locations rather than a one-off script for a single address.
- **Direction-aware disambiguation.** The config supports multiple `approach_from` entries; the agent asks the driver which landmark they recognize and picks the matching guidance, rather than reading one fixed set of directions regardless of where the driver actually is.
- **In-call escalation only, driver-confirmed.** If the driver is still stuck after being guided, the agent *offers* a human contact number — it never escalates automatically, and escalation resolves entirely within the same call (the agent reads the number aloud, the driver dials it themselves after hanging up). No webhook, no second outbound call, no SMS.
- **Structured result, not free-text parsing.** Pairs with CALL-E's `resultSchema` to return `escalation_offered`, `escalation_number_revealed`, and `resolution_summary` as typed fields instead of requiring you to parse a transcript.

## When to Use

- Recurring deliveries/pickups to the same physical address, where investing in a one-time config pays off over repeat visits.
- Addresses where the failure mode is specifically "driver is nearby but can't identify the exact building" — not a wrong address, not a closed business, not a road closure.
- Opt-in, driver-initiated help (e.g. a "request navigation help" button in a delivery app) — this skill assumes the call is triggered by an explicit driver action, not a proactive push CALL-E makes to every delivery.

## When Not to Use

- One-off deliveries to addresses with no config authored yet — there's no fallback to generic map directions built in; if there's no config for the address, this skill has nothing to say.
- As a replacement for real-time GPS navigation for the earlier, non-ambiguous part of a route — this is specifically for the "last few hundred meters" failure mode, not full trip navigation.
- Anywhere a live human handoff (warm transfer) is required — this skill only reveals a callback number for the driver to dial themselves; it does not transfer the call.

## How It Works

1. Author a location config matching `references/location-config.schema.json` (see `assets/sample-location-config.json` for a filled-in example). One config per building, not per delivery or per resident — unit-specific details live in the config's optional `units[]` array and are looked up at call time.
2. Validate it — `scripts/locationConfigSchema.js` is a Zod schema mirroring the JSON Schema, useful if you're loading configs at runtime in a Node.js project and want a readable validation error instead of a malformed call task.
3. Call `buildCallTask(config, { appName })` from `scripts/buildCallTask.js` to get the `task` string and matching `resultSchema`.
4. Fire the call with the CALL-E SDK:

   ```js
   import { buildCallTask, resultSchema } from "./scripts/buildCallTask.js";

   const { task } = { task: buildCallTask(config, { appName: "YourApp" }) };

   const call = await client.calls.createAndWait({
     task,
     recipient: {
       phone: driverPhone,
       region: config.address.region_code,
       locale: config.language.locale,
     },
     resultSchema,
   });
   ```

## Output Structure

`structuredResult` on the completed call:

```json
{
  "escalation_offered": false,
  "escalation_number_revealed": false,
  "resolution_summary": "The driver was guided to the building and confirmed finding it before the call ended."
}
```

## Safety and Side Effects

This skill places a real outbound phone call. See `references/safety.md` for
the full safety contract (explicit user intent, phone number handling,
escalation boundaries, cancellation behavior). Summary: outbound-only,
driver-initiated, no automated escalation action, no webhook/second call/SMS,
no recurring schedule to cancel.

## Compatibility Notes

- Plain Node.js (ESM), no build step, no framework dependency for `scripts/`. Requires `zod` if you use `locationConfigSchema.js`.
- Requires a CALL-E API key and the `@call-e/calle` SDK (or equivalent HTTP calls to `POST /v1/calls`).
- **Check `docs.heycall-e.com/regions` before deploying to a new country** — CALL-E currently classifies destination countries as "Local line" (reliable, production-ready) or "International line" (testing-only, lower reliability). Build and demo this skill with that in mind; don't assume every region behaves identically.

## Requirements

- Node.js 18+ (uses `node:fs`, ESM, top-level `await` in examples).
- `@call-e/calle` SDK and a CALL-E API key.
- `zod` (only if using the provided schema validator).

## Full Demo Application

A complete reference implementation — including a second real-world config, a "request help" trigger page with masked-number escalation reveal, and real-call test tooling — lives at [github.com/sadiq1745/call-E](https://github.com/sadiq1745/call-E).
