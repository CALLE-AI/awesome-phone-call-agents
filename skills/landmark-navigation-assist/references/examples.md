# Examples — landmark-navigation-assist

All phone numbers below are the reserved fictional number `+14155550199`.
The config is `assets/sample-location-config.json`, a fully fictional
address — no real location or personal data.

## 1. Building `task` from a config

```js
import { readFile } from "node:fs/promises";
import { buildCallTask, resultSchema } from "../scripts/buildCallTask.js";

const config = JSON.parse(
  await readFile("../assets/sample-location-config.json", "utf8"),
);

const task = buildCallTask(config, { appName: "Zing" });
```

This produces (verbatim output, generated from the sample config above —
not fabricated):

```
You are Zing's address assistant, calling a delivery driver who just requested navigation help. Speak in the driver's language, allowing code-switching if the config permits it. Assume they may be on a bike in moving traffic: keep the conversation short, no chit-chat, but speak at a measured, unhurried pace throughout — don't rush any sentence.

**Introduction:** "Hi, I'm the address assistant for Priya, delivering via Zing. I can help you find the exact building — where are you coming from, or how far out are you right now?"

**Step 1 — Orient.** Ask about ONE identifying landmark at a time, not all at once, to work out which direction they're approaching from:
  - Apollo Pharmacy?
  - the flyover?

**Step 2 — Guide**, based on their answer:
- If they mention "Coming from the main road / Botanical Garden side" (or the landmark above): Pass Apollo Pharmacy, take the second left. The building is on your right after 100 meters.
- If they mention "Coming from the flyover side" (or the landmark above): Take the service road exit, go straight for two blocks. The building is on the left, opposite a small park.

**Step 3 — Confirm the building.** Blue and white building. XYZ Apartments signboard above the entrance. Entrance: Main gate on the left — XYZ Apartments sign above the entrance. (Security allows delivery drivers in without calling up)

**Step 4 — In-building.** Once through the entrance:
- Flat 302 (3rd floor): Take the lift to the 3rd floor, it's the 2nd door on the left. No nameplate — look for the door with a black gate.

**Step 5 — Escalate only if truly stuck.** ... (asks, and if the driver confirms, reads +14155550199 aloud digit by digit, then ends the call)

**Step 6 — Close, but only on explicit confirmation.** ... (confirms the driver actually reached Flat 302 before ending the call)

At the end, record: `escalation_offered`, `escalation_number_revealed`, and `resolution_summary`.
```

(Full text omitted here for length — run the snippet above to see the
complete generated task, including all six numbered steps.)

## 2. Firing the call and reading the result

```js
import { createCalleClient } from "@call-e/calle"; // or your own client setup

const client = createCalleClient();

const call = await client.calls.createAndWait({
  task,
  recipient: {
    phone: "+14155550199", // driver's number, E.164
    region: config.address.region_code,
    locale: config.language.locale,
  },
  resultSchema,
});
```

## 3. Expected `structuredResult` — successful navigation, no escalation needed

```json
{
  "escalation_offered": false,
  "escalation_number_revealed": false,
  "resolution_summary": "The driver was guided from the main road side to XYZ Apartments and confirmed reaching Flat 302 before the call ended."
}
```

## 4. Expected `structuredResult` — driver stuck, escalation offered and used

```json
{
  "escalation_offered": true,
  "escalation_number_revealed": true,
  "resolution_summary": "The driver could not locate the building after both approach directions were tried; the agent offered and read out the escalation contact number, then ended the call."
}
```

Note that the real escalation number is never present in `structuredResult`
— only the two booleans and a text summary. The caller's own integration is
responsible for deciding what, if anything, to do with a confirmed
escalation (e.g. this skill's reference implementation reveals the number
in a UI only after `escalation_number_revealed` is `true`; see the full
demo app linked from `SKILL.md`).
