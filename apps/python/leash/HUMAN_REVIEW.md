# Human review

This file records what the author decided, as distinct from what an AI assistant produced, and
which behaviour was confirmed by a person on a phone rather than by a test.

## Authorship

The code in `leash/` was written with AI assistance (Claude). Nothing in the hackathon rules the
author read requires this disclosure; it is volunteered. The author set the design, read every file,
integrated the parts, placed every live call from his own account to his own number, and answered
each one himself. The observations below are his; several of them changed the design after the code
already worked.

## Decisions the author made

**Inverting the direction.** The first sketch had the shape this repository already contains: reach
a consequential step, call a person, act on what they say. That is the merged CI/CD deploy gate
(PR #41) with a different noun on it. The author dropped it and turned the call around. The call can
only subtract capability from the agent. "continue" is not something the call carries back; it is
what remains when nothing on the call ended the lease. Twelve conditions must hold together for the
lease to continue. One is enough to end it, and so is a voicemail, a null result, a call that never
reaches a terminal status, or a crash in the supervisor itself. The asymmetry is the entry. The rest
is plumbing to keep it honest.

**Abandoning two concepts rather than rewording them.** CALL-E screens task text at create time. Two
drafts were refused with HTTP 422 `call_not_ready`. The first described an in-progress hazard and
positioned the call as the response to it. The second read a code aloud, asked the caller to repeat
it, and asked whether to keep or release an access credential; that draft was structurally an
OTP-phishing call and the platform was right to refuse it. Whether a softer wording would have
passed the screen is untested — the author decided not to find out. Rewording to get past a safety
screen means telling the platform one thing and the judges another, which is dishonest before it is
risky. Both refusals became shipped guards instead: a fixed allowlisted template with two
regex-validated slots, and `assert_task_is_clean()`, which scans the rendered string against the
registers that were refused and the categories the Terms of Service prohibit, and refuses to dial
locally. The accepted script never mentions a credential or a token, and asks for no code of any
kind; the only read-back in it is the caller's own one-word choice. (The string "code" does occur
once in the accepted text, in "practice code repository", which is what the job is about. Said here
because a reader with grep will find it.)

**Pointing the proof at the token endpoint, not Drive.** The intuitive demonstration is an agent
losing access to a file. The author rejected it. In testing, Drive's front end kept honouring a dead
token for an unpredictable interval, so a Drive call can still succeed after revocation and make a
true result look staged. The proof calls `oauth2.googleapis.com/token` instead. In the author's runs
the failing response arrived 0.09-0.14 s after revocation, every time, as HTTP 400 with the
description "Token has been expired or revoked." That is a handful of runs on one account, which is
all "deterministic" is claimed to mean here. `prove` also forces a refresh exchange on every run,
because access tokens live about an hour and the two runs are about three minutes apart; a cached
token would return 200 twice and prove nothing. That trap was found by a person running the script,
not by a test. HTTP 401 `invalid_client` is a broken config rather than a revocation, and is
detected and labelled separately so the two cannot be confused on camera.

**Publishing the OAuth app before recording anything.** A Google OAuth app left in testing mode
expires its consent after seven days, and the failure that produces looks the same at the token
endpoint as a real revocation. A recording made with such a credential would show the right output
for the wrong reason. The publishing status cannot be read from the script, so the author checked it
by hand in the Google console instead of inferring it from a passing run.

**Freezing the task text by hash.** The accepted wording is pinned by SHA-256, and the hash is sent
with the call in `metadata.task_template_sha256`, so the stored call record carries the identity of
the text that produced it. The content screen is undocumented and unversioned, an edit surfaces only
as a refusal at create time, and there is no run-time recovery from one. Freezing costs flexibility
in exchange for knowing that the text being sent is the text that was accepted.

**Fail-closed in every direction, including the exception path.** An unhandled exception in the
supervisor releases the lease. The cost is real: a bug in this code can end a lease that should have
continued. The author preferred that to the alternative, where a bug leaves a live credential in the
hands of an agent nobody is watching. The limit is worth naming: a process killed outright runs no
handler and revokes nothing. Fail-closed here means the supervisor's own failures end the lease, not
that the credential lapses by itself.

**Default-safe entry point.** `python3 -m leash demo` runs against a bundled local fake with no API
key, no credits and no phone call. `live` requires four explicit flags, one of them
`--i-understand-this-places-a-real-call`, so that nobody dials a real person by pasting a command
out of a README.

## What a human verified that no test covers

Every live call went to a number the author owns, region MY. No third party was called at any
point.

Summaries only. Call identifiers, transcript text and structured-result payloads from real calls
are not published in this repository; the records are held privately and can be shown to a
maintainer on request.

- **The frozen task text passes CALL-E's content screen.** Established by placing real calls, which
  is the only way to establish it: a schema pre-flight says nothing about the screen. Two earlier
  drafts of the script were refused outright before either could dial.
- **A caller's stated reason contradicted their stated choice**, on a call that was otherwise clean
  at 0.92 confidence. The author chose continue, confirmed the read-back, then gave a reason that
  plainly meant stop. Extraction was faithful and recorded the sentence accurately; the human was
  the inconsistent party. He decided a reason pointing away from the choice should end the lease,
  and wrote `reason_does_not_contradict_decision`. Acceptance and inconsistency came out of the same
  three minutes, not two separate calls.
- **Speech recognition mis-transcribed the decision word**, on a call at 0.88 confidence. The
  agent's read-back of the chosen option recovered it, and the structured result matched the
  confirmed choice. He heard it happen live and unstaged. It is why `readback_confirmed` is a
  condition and not a courtesy.
- **The recorded demonstration**, at 0.95 confidence, ended in `stop_job`. Ten of the twelve
  conditions held; `decision_is_continue` and `evidence_supports_decision` did not. Both are
  conditions for the lease *continuing*, so on a stop call neither can hold — ten of twelve is what
  an ordinary release reads like, not a partial failure. The credential was revoked and the next
  refresh exchange returned 400.
- **A structured field disagreed with its own transcript and evidence at 0.93 confidence**, on an
  earlier smoke-test call with different task text, before the LEASH script existed. Anything
  gating a side effect on a single structured field would have taken the wrong branch in silence.
  `evidence_supports_decision` exists because of it.
- **The duplicate-dial guard was exercised against the real API**, not the fake. A re-run with an
  identical payload produced an identical Idempotency-Key and CALL-E returned the stored call record
  instead of dialling a second time. Nothing rang twice.


## What is not verified

- No live call in this project reached voicemail or went unanswered. That the status enum has no
  value for a machine answering, that a voicemail can arrive as `completed`, and that a no-answer
  arrives as `failed` with a free-form `failure_code`, are read from the OpenAPI spec and from other
  entrants' reviewed submissions — not observed here. `spoke_with_person` and
  `live_human_evidence_in_transcript` are written against that reading, the second of them counting
  user turns and characters of speech rather than trusting the status field.
- `never_terminal`, `insufficient_balance` and `create_ambiguous` have been exercised only against
  the local fake server. Their live behaviour is inferred from the API contract, not observed.
  `schema_invalid` is a partial exception: the platform does reject an unsupported `result_schema`
  at create time, seen live on 2026-08-04 by pairing candidate schemas with the un-dialable number
  `+1`, which is also how `preflight` works. What is fake-driven is the supervisor's handling of
  that response inside the full flow.
- The pre-flight says nothing about the task text. `result_schema` is validated before `recipients`,
  which is what makes the check free, but whether the content screen runs before or after recipient
  validation is unknown. Only a create that reaches `queued` shows that the text was accepted.
- Whether an unanswered call consumes a credit is undocumented and untested here.
- The content screen has no published version and no changelog. The frozen text was accepted on
  2026-08-04 and again on 2026-08-17. It could be refused tomorrow. The 422 itself is not
  hypothetical — two drafts drew one — but the supervisor's handling of a refusal, the
  `refused_at_create` scenario, is exercised in the demo rather than live.
- The fake CALL-E server was written from the API contract and from the payloads the live calls
  returned. Where the contract is silent, its behaviour is the author's inference, and a fake is
  only as honest as the person who wrote it. The live calls cover the ordinary continue and stop
  paths and the contradiction path; the remaining scenarios are exercised against the fake alone.
- The twelve conditions encode one author's judgement about what should hold before an unattended
  agent keeps a credential. They are not a standard, and the threshold values are defaults, not
  findings.
