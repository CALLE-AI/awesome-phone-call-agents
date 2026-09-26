# Safety Reference — Watchtower

This document expands on the "Safety design" section of `SKILL.md` with the
full detail a reviewer, integrator, or real deployer needs. It follows the
same consent, credential, and human-approval principles used elsewhere in
this repository (see `deployment-approval-call` and the repo-wide
`docs/safety.md` and disclosure-budget patterns).

## 1. Consent

Watchtower involves three people, each of whom needs to consent to a
different thing before deployment:

| Person | What they're consenting to |
|---|---|
| **Resident** (the person being monitored) | Being observed by a camera running continuous computer vision in a specific room, and having a fall event trigger an automated phone call about them to someone else. |
| **Primary caregiver** | Receiving automated phone calls from CALL-E on the resident's behalf, and understanding they may be asked to make a real-time decision (dismiss / escalate) during the call. |
| **Secondary contact** | Receiving an automated escalation call if the primary caregiver escalates or can't be reached with a clear decision. |

Consent should be collected and documented **outside of Watchtower**, at
setup time — e.g. a signed agreement, a recorded verbal confirmation, or a
family/care-team conversation. Watchtower itself does not manage, verify,
or store consent records. Do not deploy this skill for a real person
without that consent already in place.

## 2. What gets disclosed, and to whom

Watchtower discloses a narrow, fixed set of information on each call:

- That Watchtower (identified by name) is an automated home safety system
- The room a possible fall was detected in
- The approximate time of detection
- On the escalation call only: that the primary caregiver escalated

It does **not** disclose:

- The resident's name, medical history, or any other personal detail
- Video, images, or transcripts from the camera
- Anything beyond what's needed for the caregiver to make a dismiss/escalate
  decision

This is a fixed, minimal disclosure budget by design — the call script in
`calle_trigger.py` is the single source of truth for what CALL-E is told
to say, so reviewing that file is equivalent to reviewing exactly what
gets disclosed on every call.

## 3. No autonomous emergency calls

This is the most important safety property of the skill, and it's
structural, not just a instruction to CALL-E:

- Watchtower's code only ever places calls to **two configured human
  phone numbers**: `WATCHTOWER_CAREGIVER_PHONE` and
  `WATCHTOWER_SECONDARY_PHONE`.
- There is no code path, in any file in this skill, that dials emergency
  services directly. The word "911" or an emergency number never appears
  as a call target anywhere in `calle_trigger.py`.
- The escalation call's entire purpose is to ask a human to make that
  decision and, if appropriate, place that call themselves.

This mirrors `deployment-approval-call`'s pattern of using a phone call as
a **verified human-approval gate** before anything irreversible happens —
here, "irreversible" means involving emergency services, and the gate is
a real person's spoken decision, not a model's inference.

## 4. Handling ambiguous or missing decisions

If CALL-E cannot extract a clear `dismiss` / `escalate` decision from the
caregiver call — due to no pickup, a bad connection, an unclear response,
or the call itself erroring — the result is `unknown`. **Watchtower stops
here.** It does not retry the caregiver call, and it does not
automatically call the secondary contact.

Earlier versions of this skill treated `unknown` as an automatic
escalation. On review, that turned out to be the wrong default: an
automated system deciding on its own to place a second phone call,
without any human having actually said "escalate," is itself an
unauthorized escalation — the opposite of the human-approval principle
this skill is supposed to enforce. An ambiguous result is logged with
`call_status = 'resolved'` and `decision = 'unknown'` and is meant to be
followed up on by a human operator, not resolved automatically by
placing another call.

## 5. False-positive mitigation

Because every triggered event results in a real phone call to a real
person, false positives have a real cost (alarm fatigue, unnecessary
calls). Watchtower reduces them with three layered checks in
`fall_detector.py`, all of which must pass together:

1. **Confidence threshold** (`FALL_CONFIDENCE_THRESHOLD`) — the model
   must be reasonably confident it's seeing a fall, not just any
   detection above zero.
2. **Consecutive frames** (`CONSECUTIVE_FRAMES_REQUIRED`) — the fall
   class must be seen across multiple frames in a row, filtering out
   single-frame flickers from motion blur or momentary misclassification.
3. **Cooldown window** (`EVENT_COOLDOWN_SECONDS`) — once an event fires,
   repeat detections are suppressed for a period, so one fall doesn't
   trigger a stream of duplicate calls while the person is still on the
   ground in frame.

These thresholds are deliberately exposed as constants at the top of
`fall_detector.py` so they can be tuned per camera angle, room, and
model — there is no universally correct value.

## 6. Network and API failure handling

CALL-E's call lifecycle involves two separate network steps: placing the
call, and polling for its final result. A failure in either step means
`calle_trigger.py` **stops and treats the result as `unknown`** — it
does not retry the call. Retrying a call that may have already reached
and rung a distressed caregiver risks placing a duplicate, confusing
call; per Section 4, an ambiguous outcome is surfaced for manual review
rather than automatically resolved by trying again or escalating.

The video stream in `fall_detector.py` also wraps the entire call
sequence in a try/except, so a total CALL-E failure (e.g. API outage)
degrades to "log the failure, keep monitoring" rather than crashing the
whole detection pipeline.

## 7. Credential handling

- `CALLE_API_KEY` is read from an environment variable, never hardcoded,
  and is only required for live calls — dry runs need no credentials.
- `WATCHTOWER_API_KEY` protects every network-reachable route
  (`/detect`, `/status`, `/history`, `/`) and must be set explicitly; the
  server refuses to start without it.
- `WATCHTOWER_CAREGIVER_PHONE` and `WATCHTOWER_SECONDARY_PHONE` are also
  environment variables, defaulting to NANP's officially reserved
  fictional range (`+12125550123`, `+12125550199` — the 555-0100 through
  555-0199 block reserved for fiction and documentation) so the code
  never ships with a real number committed to version control, per this
  repository's contribution rules.
- Both numbers must additionally appear, exactly, in
  `WATCHTOWER_AUTHORIZED_NUMBERS` before a live call will be placed to
  them — a well-formed number is not automatically an authorized one.
- Real calls require an explicit `WATCHTOWER_CONFIRM_LIVE_CALL`
  confirmation phrase set for that run. Without it, Watchtower always
  runs in dry-run mode, regardless of whether `CALLE_API_KEY` is present.
- All FastAPI routes (`/detect`, `/status`, `/history`, `/`) require an
  API key (`WATCHTOWER_API_KEY`), since they are reachable by anyone on
  the same network otherwise.
- Phone numbers, structured call results, and error text are masked
  before being printed or logged.

## 8. Data handling and retention

- Every event (timestamp, room, confidence, call status, decision) is
  logged to a local SQLite database (`watchtower.db`) in the working
  directory.
- This database is **not encrypted at rest** and has no access control
  beyond the filesystem permissions of the machine it runs on. For a real
  deployment involving a real person's health-adjacent data, this should
  be hardened (encryption at rest, access-controlled storage, a defined
  retention/deletion policy) before use — this reference implementation
  does not include that hardening.
- No video or images are stored; only structured event metadata.

## 9. Known limitations (safety-relevant)

- This is a computer-vision system and inherits CV's usual failure modes:
  poor lighting, occlusion, unusual camera angles, and out-of-distribution
  scenes can all reduce detection accuracy in either direction (missed
  falls or false alarms).
- Single-camera, single-room, single-resident design. It has no way to
  distinguish between residents if more than one person is in frame, and
  no multi-room correlation.
- This skill should not be presented or relied upon as a certified
  medical device or a sole safety measure for a high-risk individual. It
  is a reference implementation demonstrating a CV-triggered,
  human-approved CALL-E workflow — additional safeguards (wearable fall
  detectors, scheduled check-ins, professional medical alert systems)
  are strongly recommended alongside it, not instead of it.

## 10. Before deploying for a real person

Checklist:

- [ ] Resident, caregiver, and secondary contact consent collected and documented
- [ ] Real phone numbers configured via environment variables (never committed)
- [ ] Model tested against real lighting/camera conditions in the actual room
- [ ] Confidence, consecutive-frame, and cooldown thresholds tuned and validated
- [ ] A plan in place for what happens if the machine running Watchtower loses
      power or network connectivity (this skill has no offline fallback)
- [ ] Data retention/encryption reviewed if used beyond a demo/test context