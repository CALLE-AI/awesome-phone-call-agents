# Safety & Crisis Boundaries

This skill operates in a high-stakes context. These rules are mandatory.

## 1. This is routing, not rescue
`crisis-lifeline-bridge` connects a person to **ongoing human services** (shelters, food banks, DV advocates, legal aid, warmlines). It does **not** handle a live emergency, provide medical/legal/financial advice, counsel or diagnose, or act as the crisis line itself. If there is **imminent danger or active self-harm**, stop this workflow and direct the person to emergency services and the national crisis line for their country immediately (e.g. US: 911 and 988). Verification calls are never a substitute for an emergency.

## 2. Verify before refer
No local resource is given to the person until a call has confirmed it is real and reachable **this run**. A dead, wrong, or disconnected number handed to someone in crisis is worse than none. If verification fails, the agent must not present that number — it researches another candidate, or falls back to a known standing national line, and is honest that a local option could not be confirmed.

## 3. Consent & the person's own number
- The verification call is placed to a **service agency**, never to the person in crisis.
- To ever call the person, the agent needs the person's **explicit consent and their own number**, provided by them. Never infer, store, or reuse it.
- The caller on a verification call represents **nobody** — it confirms public service details (is this line real, intake hours, capacity). It never shares or implies the identity, location, or situation of the person in crisis.

## 4. No guessing
Never infer phone number, country code, region, timezone, or language from locale, IP, UTC offset, message text, or unrelated context. If a required field is missing, ask or fall back to a verified national resource. Pass the user's own words to CALL-E `plan_call` via `user_input` and let missing fields surface as plan questions.

## 5. Phone numbers
- E.164 format for any real call (`+<country><number>`).
- All samples in this repo are fictional reserved samples (`+1 555 01xx`) and never dialed.
- Mask numbers in any summary or log.

## 6. Side effects & recurrence
- A `--live` verification is a single one-off outbound call. There is no recurring job.
- Dry-run (default) places no call at all, so there is nothing to cancel.
- This skill never creates a schedule, daemon, or background worker.

## 7. Credentials
- CALL-E auth is handled by the local `calle` CLI token cache. Never print, log, or embed tokens.
- Research endpoint credentials (`RESEARCH_TOKEN`) come from the environment. Never hardcode them.

## 8. Data minimization
Log only what is needed to operate: the need type, the (masked) agency number, the verification result. Do not persist the crisis person's message content, identity, or location beyond the run.
