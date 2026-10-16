---
name: verify-by-phone
description: Verify a directory listing, database record, or any published claim about an organization by placing one disclosed CALL-E phone call and returning a span-grounded structured answer with a calibrated confidence or an explicit abstention. Use when stored information about a business must be checked against reality by phone, such as provider directory entries, accepting-new-patients status, insurance participation, hours, or availability, and when a wrong answer is more costly than no answer.
license: MIT
---

# Verify By Phone

Use this skill when an agent must establish whether stored information about an organization is still true, and a phone call to the organization's published line is the way to find out.

`verify-by-phone` is a verification workflow skill. It places exactly one disclosed outbound CALL-E call per record, extracts the answer from the transcript with a verbatim supporting span, reconciles it against the stored record with transparent match-weight arithmetic, and returns either a calibrated confidence or an explicit abstention. The design goal is an agent that never converts an uncertain phone answer into a confident database write.

## When To Use

Use this skill for:

- verifying a provider directory listing: is this practice real, reachable, accepting new patients, taking a given insurance plan
- checking whether a stored business record (hours, services, availability) still matches reality
- refreshing any dataset where the phone is the source of truth and the record is suspected stale
- workflows where an "unknown" outcome must be recorded honestly instead of guessed
- one record at a time, with a human-authorized recipient list

## When Not To Use

Do not use this skill to:

- place undisclosed or pretext calls; every call announces that it is an automated assistant and why it is calling, in the same breath
- call wireless or personal numbers; verification targets published organizational lines
- run marketing, sales, lead generation, or any promotional outreach
- batch-dial a list without per-record human authorization
- overwrite a stored record directly from a call result; the output is a verdict with evidence, and the write decision stays with the operator
- guess an answer the respondent did not give; if the call yields no usable answer, the result is an abstention, and that is the correct output

## Consent And Disclosure Rules

These are load-bearing, not boilerplate:

1. The call opens by stating the AI identity and the purpose together, before anything else, and announces that the call may be recorded.
2. If the respondent objects to speaking with an automated caller, the call thanks them and ends immediately. The result records the refusal as an unverifiable outcome.
3. Hold time is capped. If the respondent asks the caller to wait, it waits briefly, then reports back rather than waiting indefinitely.
4. The agent never invents information it was not given, on the call or in the result. Concretely: a clinic will often ask the caller for a name, a date of birth, an insurance member or card number, or a reason for the visit. The agent says plainly that it does not have that information, because this is a directory verification call and not an appointment request, and then repeats the question it called to ask. A placeholder is an invention.
5. Voicemail is not an answer. On reaching voicemail or an answering machine the call ends immediately without leaving a message: a directory fact cannot be established from a recording, and nobody should find a robot message on their line.
6. Calls are informational verification, never promotional. Treat every call as recorded with all-party consent requirements in mind.

## Verification Workflow

1. Calibrate the abstention threshold first, with `scripts/calibrate.py` on labeled scenario data, so "confident" means something measurable: at the default level, the true answer falls inside the prediction set at least 90 percent of the time on held-out data. It prints a `qhat` that step 6 consumes. This runs with no credentials and no calls, so it can be done once, ahead of any dialing.
2. Collect the record to verify: organization name, published phone number in E.164, and the claims to check (for example accepting new patients, accepts a named plan).
3. Confirm the operator authorizes this specific call to this specific number.
4. Build the call task with `scripts/place_verify_call.py`. The script defaults to a dry run that prints the exact task and recipient without dialing; pass `--live` only after the dry run looks right.
5. Poll with `scripts/poll_result.py` until `result_status` is no longer `pending`, even if execution already says `completed`. It saves the full Calls V2 payload to a private local file. An unavailable result is a normal outcome; extraction still reads any recorded transcript.
6. Extract the answer with `scripts/extract_answer.py --qhat` from step 1. Every extracted field carries the verbatim transcript span and character offsets that support it. Hedged answers ("I think so") keep their polarity at a dampened trust score. Non-responsive turns (wrong number, refusal, "call back later") never count as answers. The answer is served only when the calibrated prediction set is a single value and that value is not "unknown"; otherwise the result is an abstention. Omitting `--qhat` abstains on everything and labels the output `uncalibrated`, because a threshold with no calibration behind it guarantees nothing.
7. Reconcile against the stored record with `scripts/reconcile_record.py`: each agreeing field adds documented bits of evidence, each disagreeing field subtracts them, and the verdict is verified, contradicted, or unverifiable.

## Maintenance Note

The scripts in this skill are self-contained copies of the reference
implementation in the Attest backend (backend/app in the source repository).
They are kept small on purpose so the skill installs with no dependencies on
that repository.

That copy is enforced, not promised. `tests/test_skill_parity.py` in the source
repository runs this skill's extractor and the backend's over the same
transcripts and fails if they disagree on the answer, on the character offsets
of the cited span, or on the cue lexicons themselves. An earlier version of this
note asked a human to re-sync by hand, and the copy drifted anyway: the backend
learned to trust the last cue in a turn and to read "no problem" as agreement
while this script still trusted the first, so a plain "No, we are not" abstained
here and answered there.

## Requirements

| What you are doing | Minimum Python | Dependencies |
|---|---|---|
| Dry run, calibration, extraction, reconciliation, offline tests | **3.9** | Standard library only |
| Creating or polling a live call | **3.11** | Published `calle-ai==1.0.1` and `CALLE_API_KEY` |

`scripts/verify_attestation.py` additionally needs `cryptography`. It is optional and is not part of the verification workflow.

## Quick Start

```bash
python3 -m pip install calle-ai==1.0.1

# 1. Calibrate the gate first. Prints the qhat step 5 needs.
python3 scripts/calibrate.py --data references/sample-scenarios.jsonl --alpha 0.1

# 2. Dry run: prints the task and masked recipient, dials nothing.
python3 scripts/place_verify_call.py \
  --org "Example Counseling Center" \
  --phone "+15550101234" \
  --claim-accepting-new-patients yes \
  --claim-plan "Example Health PPO"

# 3. After authorizing the specific published organizational line, set
#    VERIFY_ORG and VERIFY_PHONE to its actual name and E.164 number.
#    Requires CALLE_API_KEY. Do not dial the fictional dry-run number.
python3 scripts/place_verify_call.py \
  --org "$VERIFY_ORG" --phone "$VERIFY_PHONE" \
  --claim-accepting-new-patients yes --claim-plan "Example Health PPO" \
  --state verify-call.json --live

# 4. Use the API id printed above; wait until result_status is no longer pending.
python3 scripts/poll_result.py --call-id call_abc123 --out result.json

# 5. Extract the span-grounded answer. --org is required: an answer is only
#    evidence about this listing if the respondent confirmed they ARE it.
python3 scripts/extract_answer.py --payload result.json --qhat 0.750 \
  --org "Example Counseling Center"

# 6. Reconcile against the stored record. Same --qhat and --org as step 5:
#    reconciliation runs extraction itself, and without either every field abstains.
python3 scripts/reconcile_record.py --payload result.json --qhat 0.750 \
  --org "Example Counseling Center" \
  --claim-accepting-new-patients yes --claim-plan-accepted yes
```

Steps 5 and 6 run against the bundled `references/sample-call.json` if you want to see real output before placing any call.

All literal sample numbers in this skill are fictional and must not be dialed. Dry runs and steps 1, 5 and 6 using the bundled fixture need no credentials or network. Step 4 uses the live API and credentials but places no call.

The first live run saves the original request and idempotency key to `--state` **before** sending it, then adds the API Call ID after acceptance. Retry with the same arguments and state file, including after a timeout or across a UTC-date boundary. Keep the request unchanged; the script refuses a state file belonging to different input. For an intentionally new call, use a different state path and a fresh `--idempotency-key`; the default key deduplicates identical same-day requests. The state file includes the unmasked phone number and is written mode 0600.

Run the offline migration checks with `python3 scripts/test_calls_v2.py`.

**These conditions make a claim abstain no matter how clearly it was answered**:

1. **No calibrated threshold** (`--qhat` missing). There is no coverage guarantee to answer behind.
2. **Identity not positively confirmed.** Absence of a denial is not confirmation. Wrong numbers, answering services and reassigned lines all produce cooperative respondents who are not the listing.
3. **Both questions asked in one turn.** A single "Yes" cannot be split between two claims after the fact, so it is attributed to neither. The call script asks one question at a time to avoid this.
4. **A V2 transcript contains an unknown speaker.** An unattributed turn may be the agent rather than the respondent. The entire call abstains until speaker attribution is reliable; the saved transcript is retained unchanged.

## What The Output Looks Like

`extract_answer.py` emits one JSON object per claim:

```json
{
  "claim": "accepting_new_patients",
  "answer": "yes",
  "trust_score": 0.9,
  "hedged": false,
  "span": {"turn": 6, "text": "Yep.", "char_start": 0, "char_end": 3},
  "abstain": false,
  "gate": "conformal(qhat=0.750)"
}
```

An abstention keeps the same shape with `"abstain": true`, either because the calibrated prediction set held more than one label or because the extractor found no answer at all (`"answer": "unknown"`). The `gate` field names the threshold that made the decision, and reads `uncalibrated` when no `--qhat` was supplied, which is the one case where every claim abstains regardless of what was said. `reconcile_record.py` adds the match-weight arithmetic and a verdict. No field ever appears without either a supporting span or an explicit abstention.

## Side Effects And Cancellation

- Side effect: at most one new outbound call per `--live` invocation, to the authorized number. Replaying the saved request returns the existing call. Nothing recurs; there is no scheduler in this skill.
- Cost: a new live call can incur CALL-E charges; use Dashboard Billing for actual fees. Dry runs place no call.
- Cancellation: stop before `--live` whenever possible. Calls V2 supports `client.calls.cancel(id)` before provider submission; once submission starts it returns `409 call_cannot_cancel` and cannot hang up an active call. Stopping the polling script does not cancel the call.
- Data: payloads are written to local files the operator names. Phone numbers are masked in console output. Nothing in this skill transmits results anywhere except the CALL-E API itself.

## References

- `references/api-notes.md`: the Calls V2 request, result readiness, transcript, retry and cancellation contract used by this skill.
- `references/verification-protocol.md`: the full disclosure script, the legal posture for outbound verification calls, and why abstention is the core design decision.
- `references/sample-scenarios.jsonl`: labeled fictional scenario data used by `scripts/calibrate.py`, so calibration runs with no credentials and no calls.
