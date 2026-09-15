# Safety notes

AuditLane places real phone calls to real people, and its `telephony-gate`
hook can block real commands from executing. Read this before enabling
either in live mode.

## Host integration boundary

The linked adapter uses Claude Code's `PreToolUse` stdin/stdout JSON contract
and the configured `Bash` matcher in `.claude/settings.json`. It does not cover
other tools, direct execution outside that hook, or every dangerous command
spelling. The pattern detector and textual entailment checks are experimental
heuristics. Treat this as a supplementary check, not sole authority for real
destructive actions or proof of a person's authorization. Rehearsal fixtures can
produce `allow` without a phone call; never use that response to authorize a real
destructive command. Host permissions and independent human approval remain
necessary.

## Dress rehearsal is the default, on purpose

`AUDITLANE_DRESS_REHEARSAL` defaults to `true`. Going live requires
**both** setting it to `false` **and** providing a real `CALLE_API_KEY` —
two explicit configuration actions. Before each live run, the operator must
approve the bounded questions and attest that each intended recipient has
authorized the call. Configuration alone is not proof of per-run intent.

## What a live call actually does

- Discloses plainly, in the first turn, that it is an automated
  engineering change-control verification call, not a real security
  incident, if the person asks.
- Opens with **free, unprompted recall** ("what did you discuss/approve
  regarding X?") before ever reading back the specific claim — leading
  with "did you approve X, right?" invites a reflexive yes and defeats
  the point of calling at all.
- Is capped at `AUDITLANE_MAX_CALL_SECONDS` (default 180s).
- Never argues with a denial — if the person says they didn't authorize
  something, the call ends. AuditLane does not try to talk anyone into
  confirming something they've denied.
- Never asks for or transmits real credentials, account numbers, or any
  secret. It only asks what the person recalls discussing.

## The directory is never derived from the thing being checked

For `audit_pr`: phone numbers come from a separately maintained
`phonebook.json`, never from names or numbers appearing in the PR text
itself. For `telephony-gate`: the authorizer is a name you configure
(`AUDITLANE_HOOK_AUTHORIZER`), looked up in that same phonebook — never
extracted from the command being gated. If either dialed whatever
name/number appeared in the untrusted input, an attacker (or a
prompt-injected agent) could point the "verification" call at a number
they control and have it self-confirm. The phonebook must come from your
own org directory, kept out of version control.

Validate private destinations as E.164. Use only fictional entries with the
external CLI's unmodified dry-run output, which may expose the request payload.
Before displaying any real preview or summary, mask phone numbers and remove
credentials from display-only copies, including free-text prompts and results.
Keep the exact recipient only in private dispatch state. Do not give credentials
to an arbitrary or insecure provider origin.

## Intended deny paths and finite test coverage

The author reports a dedicated stress-test suite
([`tests/test_hook_robustness.py`](https://github.com/soujasK/AuditLane/blob/main/tests/test_hook_robustness.py),
18 cases) that found and fixed two real crash bugs during development
(a list-shaped hook payload, a non-string command field — both now
covered by regression tests). This is reported coverage, not an exhaustive
guarantee for unexpected inputs or future versions.

For matching commands, the intended outcomes include:

| Condition | Result |
|---|---|
| No `AUDITLANE_HOOK_AUTHORIZER` configured | deny |
| Authorizer has no phone number on file | deny |
| Authorizer unreachable | deny |
| CALL-E itself errors (balance, network, auth) | deny |
| Hook input isn't valid JSON, or isn't the expected shape | deny, never a crash |
| Caught internal error | intended deny via a top-level exception handler |

The pattern detector
([`auditlane/danger_patterns.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/danger_patterns.py))
is deliberately biased toward over-matching: a false positive costs one
phone call, a false negative is the actual failure mode that matters.
See
[`tests/test_danger_patterns.py`](https://github.com/soujasK/AuditLane/blob/main/tests/test_danger_patterns.py)
(85 cases) for the exact commands it does and doesn't flag, including
near-misses chosen specifically to probe for false positives.

## Rate limiting

A local call-budget guard (`AUDITLANE_MAX_LIVE_CALLS`, default **3**)
caps live calls placed per session, tracked on disk independent of
CALL-E's own account balance. This is a local safeguard, not permanent dedupe or
crash-proof enforcement. Preserve the existing intent/provider ID after a timeout
or ambiguous submission, stop automatic redial and conflicting follow-on calls,
and reconcile before authorizing further calls. Do not delete the ledger to bypass
an unknown outcome; a higher budget is not evidence that a prior call failed.

## No secrets or personal data

- `phonebook.example.json` contains fabricated example numbers only.
- `auditlane/calle_client.py`'s fixture bank (`default_mock_responses`)
  is fictional demo data — no real names, no real statements from real
  people.
- `.env.example` documents required variables but ships no real values.
- `.gitignore` excludes `.env`, `phonebook.json`, and local call-budget/ledger
  files. Review tracked files and history as well; ignore rules do not remove
  content already committed.

## Advisory results and human review

Detected uncertainty is intended to route to `NEEDS_HUMAN_REVIEW`. A
`VERIFIED` result means the heuristic accepted the supplied responses; it may
miss a hedge, contradiction, wrong subject, or fabricated rehearsal response.
It is not proof of identity, authority, or safe execution. Keep destructive
execution and merge decisions under independent human authorization. See
[`auditlane/verifier.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/verifier.py)
for the exact decision logic.

## Cancellation / rollback

Neither capability requires provider-side recurrence. The host may still have a
running invocation or an accepted outbound call.

- **`audit_pr`**: removing the CI step (or the GitHub Actions workflow
  file) prevents future invocations. A `BLOCKED`/`NEEDS_HUMAN_REVIEW`
  status is only a commit status / PR comment — it carries no merge
  authority of its own and can always be overridden by a human with
  normal repository permissions.
- **`telephony-gate`**: deleting the hook entry from your project's
  `.claude/settings.json`, or setting `AUDITLANE_DRESS_REHEARSAL=true`
  selects the offline mock path for later invocations; it does not stop an
  already-running call or command and must not bypass real action approval.

Stopping a host process or removing its configuration may leave an accepted call
in flight. Use provider cancellation only if supported, and report its confirmed
result rather than claiming success. Otherwise state that the call may continue.
Recovery from an already-executed command is outside this hook's scope.
