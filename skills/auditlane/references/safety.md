# Safety notes

AuditLane places real phone calls to real people, and its `telephony-gate`
hook can block real commands from executing. Read this before enabling
either in live mode.

## Dress rehearsal is the default, on purpose

`AUDITLANE_DRESS_REHEARSAL` defaults to `true`. Going live requires
**both** setting it to `false` **and** providing a real `CALLE_API_KEY` —
two explicit, deliberate actions. There is no code path that places a
real call by accident.

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

## `telephony-gate` fails closed on every path, verified not claimed

This isn't a design intent taken on faith — it's covered by a dedicated
stress-test suite
([`tests/test_hook_robustness.py`](https://github.com/soujasK/AuditLane/blob/main/tests/test_hook_robustness.py),
18 cases) that found and fixed two real crash bugs during development
(a list-shaped hook payload, a non-string command field — both now
permanently regression-tested so they can't silently return).

Every one of these denies, none of them allow-by-default:

| Condition | Result |
|---|---|
| No `AUDITLANE_HOOK_AUTHORIZER` configured | deny |
| Authorizer has no phone number on file | deny |
| Authorizer unreachable | deny |
| CALL-E itself errors (balance, network, auth) | deny |
| Hook input isn't valid JSON, or isn't the expected shape | deny, never a crash |
| Any unforeseen internal error | deny, via a top-level catch-all |

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
CALL-E's own account balance — a retry loop, a misconfigured automation,
or a `telephony-gate` false-positive storm can't silently run up real
charges or turn into repeated unwanted calls to the same person. Raise
the limit explicitly, or delete the ledger file, when you actually mean
to place more.

## No secrets or personal data

- `phonebook.example.json` contains fabricated example numbers only.
- `auditlane/calle_client.py`'s fixture bank (`default_mock_responses`)
  is fictional demo data — no real names, no real statements from real
  people.
- `.env.example` documents required variables but ships no real values.
- `.gitignore` excludes `.env`, `phonebook.json`, and the local
  call-budget/ledger files so real credentials and a real org directory
  are never committed by accident.

## Fail-closed is the whole safety model

Every uncertain outcome for `audit_pr` — unreachable person, no phone on
file, a hedge, an ambiguous statement, a chain of claims too long to
fully resolve — routes to `NEEDS_HUMAN_REVIEW`, never to a silent pass.
The only way to get a `VERIFIED` result is for every hop in the chain to
be both a clear "yes" from the person and a confident textual match to
the claim. See
[`auditlane/verifier.py`](https://github.com/soujasK/AuditLane/blob/main/auditlane/verifier.py)
for the exact decision logic.

## Cancellation / rollback

Both capabilities are stateless per invocation — neither has a recurring
job to cancel.

- **`audit_pr`**: removing the CI step (or the GitHub Actions workflow
  file) stops all behavior immediately. A `BLOCKED`/`NEEDS_HUMAN_REVIEW`
  status is only a commit status / PR comment — it carries no merge
  authority of its own and can always be overridden by a human with
  normal repository permissions.
- **`telephony-gate`**: deleting the hook entry from your project's
  `.claude/settings.json`, or setting `AUDITLANE_DRESS_REHEARSAL=true`
  to force every match into the free offline mock path, disables it
  immediately. A gated command simply hasn't run yet when you do either
  — there's nothing in flight to roll back.
