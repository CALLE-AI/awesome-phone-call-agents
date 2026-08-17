# LEASH

An unattended agent holds a Google credential **on a lease**. When the lease runs out, a supervisor places one real phone call to the account owner. On that call the owner has exactly one power: **end the lease**. Not extend it, not widen it, not restore it. End it.

The apps in this repository that gate a consequential action share one shape: place a call, take a decision, hand it to a person to carry out. LEASH runs the other direction. **The call cannot add capability.** There is no answer the person can give, and no field the platform can extract, that leaves the agent holding more than it held before the phone rang. The only thing the call can produce is subtraction.

"stop" revokes the credential at Google, and the agent cannot mint another without a human at a browser. "continue" is not an instruction to do anything — it is the *absence* of a release, and it survives only if **twelve independent conditions hold at once**. A release needs one. A machine answering is a release. A null result is a release. A structured result that disagrees with its own transcript is a release. A call that never reaches terminal is a release. An unhandled exception in the supervisor is a release.

In a gate that hands out capability, a failed call is a no-op: nothing happens and everyone waits. Here, **a failed call is the loudest outcome in the system.** It is a revocation.

---

## What a reviewer should run first

```bash
cd apps/python/leash
python3 -m leash demo
```

No API key. No credits. No phone call. `demo` runs the supervisor against a bundled local fake CALL-E server and walks 16 scenarios, including the ones we could not reproduce on a real phone line. Then:

```bash
python3 -m pytest        # 70 passing
```

---

## Safety and side effects — read before running `live`

- **This app revokes a real Google OAuth credential.** That is the product, not a side effect. `POST https://oauth2.googleapis.com/revoke` is irreversible from code; recovering requires a human at a browser re-running the consent flow.
- **Deleting a local token file is not revocation.** The consent still exists at Google and any copy of the token still works. LEASH's release is a request to Google's revoke endpoint, and the evidence for it is a `400 invalid_grant` from Google's token endpoint — not the absence of a file on disk.
- **Google records consent per Cloud project.** Ending it ends access for every client id in that project, not just the one that made the call. This is why the demo runs in a **throwaway Google Cloud project** with a **single scope** (`drive.file`) and a Desktop client that exists for nothing else. We did not test this with a second client id in the same project; we took the coarse reading and made the project disposable. Do not point LEASH at a project you care about.
- `live` places a real phone call to a real person and consumes a CALL-E credit. It refuses to run without four explicit flags, one of which is `--i-understand-this-places-a-real-call`.
- Every live call in this document was placed to a number the author owns (`+60*******22`), region `MY`, locale `en-US`. Phone numbers are masked everywhere in this repo; example numbers are fictional (`+1 555 01xx`).
- Revocation happens entirely on our side of the wire. **CALL-E is never asked to handle a credential, a token, or a code.**

---

## Credential handling

The CALL-E bearer key and the Google lease are the two secrets this app touches, and neither is
allowed to move.

**The key has exactly one destination.** `CALLE_ORIGIN` in `leash/supervisor.py` is an allowlist,
not a default, and `Supervisor.__init__` refuses to construct against anything else. `live` and
`preflight` take no base-URL option at all, so there is no operator-supplied string anywhere on the
path that carries the key. The offline `demo` is the one caller that may point at a local fake
server, it has to ask for that explicitly with `allow_loopback=True`, and the key it carries is a
placeholder. A plaintext downgrade of the real host is refused along with everything else.

The reasoning is that a default and an allowlist behave identically until something goes wrong. A
default is a suggestion: any flag, environment variable, config file or wrapper script able to
influence it redirects a live credential to a host of someone else's choosing, and the request still
looks perfectly ordinary in a log. Pinning removes that class of mistake rather than documenting it.

**The key is never rendered.** `Supervisor.__repr__` prints `api_key=<redacted>`, and no code path
writes it to the journal, to stdout, or into an exception message.

**The lease file is never echoed.** `leash/revoke.py` reads `client_id`, `client_secret` and
`refresh_token` from a JSON file and reports them only as a client-id suffix and a hash prefix.
Errors name the file and the missing key, never a value.

**Destinations are strict E.164.** `+`, a non-zero country code, then eight to fifteen digits. An
earlier revision admitted seven, which is shorter than any real international number and is the
shape a typo takes rather than a subscriber. The floor exists because the cost of being wrong is a
phone call to a stranger. The pre-flight sentinel `+1` is deliberately un-dialable and is rejected
by the same rule.

## What actually happens

1. **Mint the lease.** A human consents once at a browser. Google issues a refresh token carrying exactly one scope. That token, plus an expiry, is the lease. Nothing else in the system can create one.
2. **The agent works.** It exchanges the refresh token for access tokens and does real work under that single scope.
3. **The lease expires.** The supervisor does not ask itself whether to continue. It dials.
4. **Pre-flight, locally.** The task string is rendered from a fixed allowlisted template with two regex-validated slots. `assert_task_is_clean()` then scans the **rendered** string and refuses to dial locally if it carries a banned register. An `Idempotency-Key` is derived from the payload.
5. **One call.** `POST /v1/calls` with a flat `result_schema` and one recipient. If the create response is lost or ambiguous, the supervisor **halts and reconciles** — it never dials a second time.
6. **Terminal state is fetched, not trusted.** Webhooks from CALL-E are unsigned; the platform docs prescribe re-fetching `GET /v1/calls/{id}` before a sensitive side effect, and the supervisor acts only on that re-fetched snapshot.
7. **Twelve conditions are evaluated** against that snapshot. All twelve hold → the lease continues, exit `0`. Any single one fails, or anything at all goes wrong → **release**.
8. **Release is verified, not assumed.** After `POST /revoke`, the supervisor forces a refresh exchange and requires HTTP `400 invalid_grant`. Exit `2`.

The release path is the default. An unhandled exception in the supervisor is caught at the top level and releases the lease before exiting. Exit code `1` is deliberately unused, so a Python traceback can never be mistaken for a decision.

That top-level handler is the limit of the claim: revocation requires a running process, so a `SIGKILL`, a power cut, or a machine that never wakes up cannot release anything. LEASH fails closed against exceptions, not against the host.

---

## The twelve conditions

Order matters, and a test asserts the count is exactly twelve. All twelve are requirements for the lease to **continue**; every one of them defaults to release.

| # | Condition | What it defends against |
|---|---|---|
| 1 | `reached_terminal` | A call still `queued`/`in_progress` when the deadline passes. Unknown is not continuation. |
| 2 | `status_completed` | `failed` or `canceled`. A no-answer arrives as `failed` with a **free-form** `failure_code` — no enum, so nothing switches on its value. |
| 3 | `task_completed_true` | The platform's own verdict that the goal was not met, on a call that still reports `completed`. |
| 4 | `confidence_at_or_above_threshold` | A weak extraction that is nonetheless well-formed. |
| 5 | `confidence_label_not_low` | Score and label are separate signals; a `low` label releases even if the score squeaks past. |
| 6 | `structured_result_present` | Silent, total extraction failure — `structured_result` goes `null` for the **whole object**, not one field. |
| 7 | `decision_is_continue` | The person said stop. The only condition carrying their literal word. |
| 8 | `readback_confirmed` | A misheard decision word. See regression A: the caller's decision word was mis-transcribed as a different single word |
| 9 | `spoke_with_person` | The platform's own read on whether a human was on the line. |
| 10 | `live_human_evidence_in_transcript` | **Voicemail arriving as `status: "completed"`.** This condition counts user turns and characters of speech instead of trusting the status field. |
| 11 | `evidence_supports_decision` | A structured field that contradicts the platform's own `evidence[]`. See regression B. |
| 12 | `reason_does_not_contradict_decision` | A person whose stated reason means the opposite of their stated choice. See regression C. |

---

## Three regressions, each taken from a real call

**A — Speech recognition misheard the decision word.** **call B**, 2026-08-17, `status: completed`, `task_completed: true`, confidence 0.88. Verbatim from `transcript_turns`, with offsets and the platform's own double spacing:

```
45  bot  : Should the job continue,  or should it stop?
    (caller speech withheld under the repository privacy rule)
53  bot  : In one sentence,  why?
    (caller speech withheld under the repository privacy rule)
62  bot  : You said stop.  Is that correct?
    (caller speech withheld under the repository privacy rule)
```

The caller said the stop word; the transcript recorded a different single word in its place. The read-back recovered it, and `structured_result.job_decision` came back `stop_job`, matching the confirmed choice. Unstaged, and the exact failure condition 8 exists for. **Cost without it:** a credential that should have been revoked stays live because one syllable was misheard.

Two further things are visible in those six lines. The agent asked "why" *before* the read-back, reordering the script the task text lays out — so the conditions read fields and turn content, never a position in the script. And its read-back wording was its own; across our three calls it said `"You said stop.  Is that correct?"`, `"Stop.  Is that correct?"` and `"Just to confirm,  should the job continue?"`. The task text fixes intent, not phrasing.

**B — A structured field contradicted its own transcript and evidence, at high confidence.** **call D**, 2026-08-04, `status: completed`, `task_completed: true`, confidence 0.93. This was an earlier probe call on the same account and the same day — a different task, not LEASH's script — which is why it does not appear in the live-verification table below.

```
    (agent speech withheld under the repository privacy rule)
user: yes.
```

`evidence[]` agreed that the caller had acknowledged and had given an ETA `structured_result.acknowledged` came back `"no"` on a `yes/no/unknown` enum. **Cost without it:** anything gating a real side effect on one structured field takes the wrong branch, silently, with a high-confidence call record that looks perfect in the log. This is condition 11.

**C — A caller's stated reason contradicted their stated choice.** **call A**, 2026-08-04, `status: completed`, `task_completed: true`, confidence 0.92.

```
    (caller speech withheld under the repository privacy rule)
45  bot  : Okay, continuing.  Should the job continue, or should it stop?
    (caller speech withheld under the repository privacy rule)
57  bot  : Just to confirm,  should the job continue?
    (caller speech withheld under the repository privacy rule)
66  bot  : In one sentence,  why?
    (caller speech withheld under the repository privacy rule)
```

```json
{"job_decision": "continue_job", "reason_sentence": "<withheld>",
 "spoke_with_person": "yes", "choice_readback_confirmed": "yes"}
```

They said "continue" twice and confirmed it, then gave a reason that means stop. Extraction was faithful — `evidence[]` reads *"The person selected continue_job and confirmed that choice."* — and every field agrees with every other field. The human was inconsistent. **Cost without it:** the system keeps a live credential against the caller's actual intent, and the record looks clean. This is condition 12, and it is the only condition that exists because a person, not a machine, was unreliable.

**Also observed live: the duplicate-dial guard fired against the real API.** A re-run with an identical payload produced an identical `Idempotency-Key`, and CALL-E returned the stored call record instead of dialling the human a second time. Observed, not theorised.

---

## Why the call script is frozen

CALL-E screens `task` text at **create** time and can refuse with HTTP `422 call_not_ready`. Two of our drafts were refused.

**Refusal A.** An earlier concept — a lone-worker check-in — whose task text described an in-progress hazard and positioned the call as the response path to it. Refused, verbatim:

> "…revise the request so it is clearly non-emergency and does not rely on this call for urgent safety response."

That concept was abandoned rather than reworded. Rewording it would have meant telling the platform the product was not a safety net while presenting it to judges as one.

**Refusal B.** LEASH v1, which read a confirmation code aloud, asked the caller to repeat it back, and asked whether to keep or release an access credential. Refused, verbatim:

> "I can't place a call that involves confirmation-code readback or decisions about keeping or releasing an access credential. Please revise the call goal to remove any verification-code, OTP, password, PIN, or credential-access steps."

Both refusals are correct platform behaviour. Draft B was, structurally, an OTP-phishing call: the machine speaks a code and the human repeats it. We say that plainly because it is the reason the shipped script looks the way it does. v2 removed exactly what the refusal named, and it was accepted.

The accepted wording is pinned by SHA-256:

```
4e971382408307404e8938186b01f2d50f98dac2abb56cee0eeade1c2b7dfce8
```

The screen is undocumented and unversioned. An edit surfaces only as a refusal at create time, and there is no run-time recovery — the call simply does not exist. So the template is frozen and hashed, and slot **values** (job id, minutes) are the only things that vary. The hash covers the template, not the rendered string.

That distinction has already paid once. The agent spells the job id out character by character before anything else happens: `LEASH-0001` became *"capitalized L, capitalized E, capitalized A, capitalized S, capitalized H, dash, zero, zero, zero, one"* and the opening ran 20 seconds. Changing the slot value to `tidy-b612` shortened it without touching the template or the hash.

**Both refusals became shipped guards:**

- A fixed allowlisted template with two regex-validated slots. No caller-, agent-, or config-supplied free text ever reaches the task string.
- `assert_task_is_clean()`, which scans the **rendered** string against the registers that were refused plus the categories CALL-E's Terms of Service prohibit (emergency, safety-critical, critical infrastructure, high-risk financial), and refuses to dial locally before a request is made.

---

## What the call never says

The accepted script never mentions a credential, a token, or a code. It asks one question about a background job:

```
"The job has paused before its final step, and it has changed nothing so far. Its final
 step would rewrite the history of its own practice code repository, and that step cannot
 be undone afterwards."

"Should the job continue, or should it stop?"

"In one sentence, why?"
```

The template also instructs the agent to repeat the choice back and ask for confirmation, giving *"So the job should stop. Is that correct?"* as an example; the wording the agent actually used varied per call, as regression A shows.

Revocation is the supervisor's own response to "stop". It happens on our side of the wire, after the call is over. `tests/test_templates.py` asserts the rendered task carries none of the credential, code, OTP, PIN or password register — that test fails the build, not the call.

The result schema is flat scalars only, string enums rather than booleans, each with an in-band value for "no clear answer". CALL-E's schema subset has no nullable type — `["string","null"]` is rejected at create time as an unsupported JSON Schema type, and so is `oneOf`, both verified live for zero credits. Anything that survives create but fails extraction nulls the entire result object rather than one field, which is why nothing load-bearing is nested.

---

## How to run it

```bash
# 1. Default-safe. Bundled fake CALL-E server. No key, no credits, no call.
python3 -m leash demo
python3 -m leash demo --scenario voicemail_as_completed

# 2. Free schema pre-flight against the real API. Zero credits: result_schema is
#    validated BEFORE recipients, so pairing it with the un-dialable number "+1"
#    answers "is this schema supported?" without dialling anyone.
python3 -m leash preflight

# 3. Real phone call. Four explicit flags, no defaults, no shortcut.
python3 -m leash live \
  --to +15550142 \
  --lease ~/leash/lease.json \
  --job-id tidy-b612 \
  --i-understand-this-places-a-real-call

# 4. The on-camera proof: force a refresh exchange and print the HTTP status.
python3 -m leash prove --lease ~/leash/lease.json
```

Abridged output from the recorded live run (**call C**):

```
condition  7 decision_is_continue ............ FAIL  (stop_job)
condition 11 evidence_supports_decision ...... FAIL
10 of 12 held — the lease requires 12
RELEASING: POST https://oauth2.googleapis.com/revoke -> 200
verifying: refresh exchange -> 400 invalid_grant
exit 2
```

Both failures come from one fact: the caller chose stop, and the platform's own `evidence[]` corroborated stop. Neither the decision condition nor the evidence condition can hold on a call that ends in a release. Every line above is from that live run; `demo` drives the same evaluation from the fake server and spends nothing.

| Exit | Meaning |
|---|---|
| `0` | Lease continues. All twelve conditions held. |
| `2` | Lease released. The credential is dead and the death was verified. |
| `3` | Operator error — bad flags, unreadable lease file, or a token endpoint answering `401 invalid_client`. In this state the supervisor makes **no claim** that a revocation happened. |
| `1` | Deliberately unused. |

`401 invalid_client` means a broken client configuration, not a revocation. It is detected and labelled separately, because reading it as success would make the proof worthless.

### Why `prove` forces a refresh exchange

Google access tokens live about 3600 s, and two proof runs are roughly 180 s apart, so a cached access token would return 200 on both runs and prove nothing. `prove` forces a **refresh exchange** every run: byte-identical request body, 200 before the call — returning a fresh access token with `"expires_in": 3599`, which is the point — and `400 invalid_grant` after. And the proof never touches Drive: Drive's front end keeps honouring a dead token for an unpredictable interval. The token endpoint does not.

---

## Scenarios in `demo`

`continue_clean` · `stop_plain` · `no_answer` · `voicemail_as_completed` · `null_extraction` · `low_confidence` · `contradiction` · `evidence_absent` · `readback_denied` · `unclear_answer` · `never_terminal` · `canceled` · `refused_at_create` · `schema_invalid` · `insufficient_balance` · `create_ambiguous`

`continue_clean` is the only one that ends with the lease alive. `create_ambiguous` is the reconcile-never-re-dial path. `refused_at_create` replays the 422 content refusal that produced the local guard.

---

## Live verification

All calls placed from a real CALL-E account to a number the author owns, `+60*******22`, region `MY`, locale `en-US`.

| Call id | Date | Result | What it establishes |
|---|---|---|---|
| **call A** | 2026-08-04 | `completed`, `task_completed: true`, 0.92 `high`, `continue_job` | The frozen task text passes the content screen. Also the source of condition 12 (regression C). |
| **call B** | 2026-08-17 | `completed`, `task_completed: true`, 0.88 `high`, `stop_job` | Read-back recovering a misheard decision word (regression A). Template still accepted 13 days later, unchanged, and `stop_job` extracts correctly. |
| **call C** | 2026-08-17 | `completed`, `task_completed: true`, 0.95 `high`, `stop_job` | The recorded demonstration. Created `02:31:42Z`, completed `02:34:59Z`. Ten of twelve conditions held; `decision_is_continue` and `evidence_supports_decision` reported false; the credential was revoked and the token endpoint then returned `400 invalid_grant`. |

The recorded demonstration's structured result, in full:

```json
{"job_decision": "stop_job", "reason_sentence": "<withheld>",
 "spoke_with_person": "yes", "choice_readback_confirmed": "yes"}
```

Timing, computed from `created_at` and `completed_at` in the three saved call records: 179 s, 197 s and 225 s to terminal. The conversation itself is much shorter — 66 s on the recorded run — so plan around three minutes per call end to end, not one.

Two details from those records that shaped the code. `structured_result` was populated at the top level of all three call objects and `null` on every recipient object, so the supervisor reads the top-level field. And all three returned `completion_confidence.label: "high"` — meaning condition 5 has never fired on real platform data, only against the fake server.

Revocation is deterministic: `POST /revoke` returns 200 with an empty body, and the following refresh exchange returns `400 invalid_grant` in 0.09–0.14 s, measured across runs on one machine and one network.

### What was **not** tested live

Stated plainly, because the boundary matters more than the table above:

- **Only conditions 7 and 11 have ever fired on real platform data**, on the recorded run. Every other condition has been exercised against the fake server only.
- **No-answer, voicemail, `canceled`, never-reaching-terminal, null extraction, and insufficient balance were never observed on a real call.** They are modelled in the fake server from the OpenAPI spec, the platform docs, and measured behaviour of adjacent cases. Condition 10 exists because the spec and platform notes say a voicemail can arrive as `completed` — we did not let a voicemail answer to confirm it.
- **Webhook delivery was never exercised end to end.** Live runs polled. The supervisor's rule — never act on a webhook payload, re-fetch `GET /v1/calls/{id}` first — is implemented and covered in `demo`, but no real webhook was received.
- **One number, one region, one locale, one carrier.** No second recipient, no non-MY region, no non-English locale.
- **One Google Cloud project, one scope (`drive.file`), one Desktop client.** Revocation behaviour for other client types is untested.
- Credit balance could not be checked programmatically: CALL-E exposes no balance endpoint (`/v1/account`, `/v1/balance`, `/v1/credits`, `/v1/usage`, `/v1/me` all 404).

---

## Limitations, and what is deliberately not built

- **Revocation kills the refresh path immediately; it does not recall an access token already issued.** Google front ends may keep honouring a live access token for an unpredictable interval after the revoke returns 200. LEASH's proof therefore measures the token endpoint, which is immediate and deterministic. If your threat model needs the *data plane* to stop within a bounded time, LEASH alone does not give you that.
- **LEASH takes away a credential. It does not stop a process.** If the agent's dangerous action needs no Google credential, ending the lease does not prevent it.
- **One revocation ends the whole Cloud project's consent**, not one client. That coarseness is Google's, not ours, and it is why the demo project is disposable.
- **There is no retry.** A lost or ambiguous create halts and reconciles; the human is never dialled twice for one lease. That is a stated preference for a missed call over a duplicate call, and a missed call ends the lease.
- **There is no cancel path at the platform level.** `canceled` is in CALL-E's status enum, but we found no endpoint that produces it. A no-answer is assumed to consume a credit; the platform does not document whether it does.
- **"continue" adds nothing.** It leaves the credential exactly as it was — same token, same single scope. No code path in LEASH mints, widens, or re-scopes anything; only a human at a browser can. What a continue outcome does buy is time: the agent keeps running under the credential it already had. That is the whole of it, and it is why continue is the expensive branch — twelve conditions to buy more time, one to end it.
- **Not built on purpose:** SMS or email fallback (a second channel is a second thing to misread), a retry ladder, multi-recipient escalation, a "are you sure?" second call, and any mechanism by which the phone call could restore a credential it just ended.

---

## Layout

```
leash/
  templates.py   frozen task template, slot regexes, assert_task_is_clean()
  outcomes.py    terminal-snapshot parsing; survives structured_result == null
  policy.py      the twelve conditions, in order
  supervisor.py  dial, re-fetch, evaluate, release, verify
  revoke.py      Google revoke + forced refresh exchange + invalid_client detection
  fakecalle.py   local fake CALL-E server, 16 scenarios
  __main__.py    demo | live | prove | preflight
tests/
  test_templates.py   the script never mentions a credential, token or code
  test_policy.py      the count is twelve, and each one releases on its own
```

70 tests, `pytest`. Built and verified against a local fake CALL-E server, with the real calls listed above spent on the content screen, the two decision branches, and the recorded demonstration.
