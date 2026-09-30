# Personalized morning briefings

The local `/briefings` workspace prepares current information before a CALL-E call. It does not claim to browse during the telephone conversation. CALL-E receives a saved, dated briefing as its task context and can answer follow-up questions from that evidence.

## Design

This adapts the daily-generation pattern inspected in the maintainer's `hackthonTakeaway` project: fresh source collection, evidence-backed synthesis, comparison with a dated archive, explicit source failures, and saved daily output. It does not reuse that project's technology feeds, commercial scoring, bilingual copy, credentials or personal data.

Each senior has a separate preferred name, country and country code, state/region, city/suburb, IANA timezone, interests, topic preferences, consent and preparation time. The default time shown in a new form is 06:00; saving a profile with **Prepare daily** selected explicitly enables read-only daily preparation. A missing location is a validation error. No real senior profile is seeded or inferred from the operator's location.

| Topic | Sources and behavior |
| --- | --- |
| News | Current national and local reporting, with publication dates; a concise selection rather than a full news feed. |
| Activities | Council, library and organiser listings near the senior, within the next seven days, including cost, booking and reported accessibility. Availability is not guaranteed. |
| Interests | Recent stories or practical ideas relevant to the senior's declared interests. |
| Benefits | Official older-person benefits and concessions, with eligibility caveats and effective dates. |
| Retirement | General official pension or superannuation information; no account access, personal balances, fund selection or individual financial advice. |
| Health prompts | Only senior/carer-provided dates and agreed clinician follow-up plans. Unknown history stays unknown, and elapsed time alone never establishes an overdue check. |

For Australia, benefit searches use [Services Australia](https://www.servicesaustralia.gov.au/age-pension), myGov and DSS; retirement searches use [Moneysmart](https://moneysmart.gov.au/plan-for-your-retirement), ATO and Services Australia. Additional trusted government/regulator domains can be entered per profile. Other countries require their own verified official domains; Australian policy sources are not substituted. See [Healthdirect's screening overview](https://www.healthdirect.gov.au/health-screening-tests) for general background; this implementation deliberately does not calculate a clinical screening interval.

## Local operator flow

1. Run the existing Next.js app with `SENIOR_PHONE_AI_MODE=live`, `OPENAI_API_KEY` and `CALLE_API_KEY` configured on the server.
2. Open `/briefings`, enter the senior's confirmed details and record personalization consent. Only add health dates with permission. Save the profile.
3. Select **Prepare fresh briefing**, or explicitly enable daily preparation. Each preparation may make up to five billable read-only searches; manual refresh makes new searches.
4. Review dated sections and source links. Failed or unsourced topics are marked unavailable. An entirely unavailable brief cannot be used for a call. Partial briefs can be reviewed with their gaps visible.
5. Enter the authorized destination, select **Review briefing call**, inspect the exact instructions and masked destination, then **Confirm and place one call**.
6. Follow the accepted call on `/calls`. Generic calls placed from `/calls` do not automatically attach a profile or briefing.

The briefing snapshot ID is included in the outbound intent fingerprint. A refresh creates a new immutable snapshot; it never silently changes a previously reviewed briefing. A changed profile, withdrawn consent, deleted snapshot or different local day blocks reuse. CALL-E task context is resolved only from server-owned stored evidence, never from a client-supplied task override. Names and health dates are excluded from search queries; the confirmed CALL-E call receives the necessary profile and optional health prompt.

## Daily preparation and hosting

Next.js instrumentation starts a one-minute preparation check in the long-running Node.js server in live mode. It runs only for saved profiles with both personalization consent and daily preparation enabled. Each profile uses its own timezone and calendar date, including DST. A completed daily attempt is cached by profile fingerprint and local date. The worker never dials, sends SMS, books appointments or creates recurring phone calls.

The server must remain running for preparation to occur on time. A restart catches up for the current local day after the configured preparation time; missed historical days are not generated. Allow several minutes between preparation and a planned call. This process timer and local storage are suitable for the existing local harness, not ephemeral/serverless hosting or a production multi-tenant service. A production deployment needs a durable host scheduler and shared authenticated datastore. No operating-system scheduled task or Codex automation is installed by this feature.

Prior prepared summaries help avoid unchanged content. They are not evidence that a senior heard a topic and are not trusted as fresh facts. Search evidence is not independently fact-checked beyond source presence, official-domain checks for benefits/retirement, and synthesis instructions. Event dates and factual claims still require review before a live pilot.

## Privacy, cancellation and recovery

- Profiles and up to 14 recent snapshots per profile are AES-256-GCM encrypted in ignored `data/senior-briefings.enc.json`, using a purpose-separated key derived from the server's CALL-E key. Rotating that key requires migration or deleting the local encrypted store first; do not rotate it without considering stored profiles and existing scheduled-call data.
- The API requires exact same-loopback origin and live mode. This is a local operator workspace, not public authentication or family-scoped RLS.
- Turning off daily preparation stops future searches; deleting a profile removes its stored briefings. Already-started read-only searches may finish. Neither action cancels a CALL-E call already accepted.
- Call creation retains the existing explicit confirmation, E.164 validation, masked summaries and uncertain-dispatch handling. No automatic callback or duplicate retry is added.
- A cross-process exclusive file lock prevents overlapping preparation/profile writes. If the process crashes while holding it, stop all app instances and verify that no preparation remains active before manually removing `data/senior-briefings.lock`; restart afterward. Do not delete a live lock. The worker logs only a generic failure and will not steal stale locks.
- Clinical advice, investment recommendations, benefit eligibility decisions and automatic appointment booking are outside this feature. Optional health prompts ask whether a recorded follow-up happened and offer discussion with the usual clinician; they never claim a booking was made.

## Verification

Offline tests cover local dates/DST, consent, country source isolation, source failures, missing citations, health-date boundaries, encrypted persistence, same-day deduplication, immutable refreshes, changed-profile/stale-brief rejection, deletion, and actual CALL-E request construction through an injected fake transport. Tests place no calls and run no live searches. A consented real-profile briefing and phone conversation remain separate acceptance checks.
