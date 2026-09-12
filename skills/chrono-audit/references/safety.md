# Safety Reference

Phone calls to engineers and colleagues represent real-world side effects. `chrono-audit` enforces strict governance controls, anti-spoofing constraints, and a fail-closed policy.

## 1. Dress Rehearsal Default

`CHRONO_AUDIT_DRESS_REHEARSAL` defaults to `true`. Leaving dress rehearsal mode requires two explicit, deliberate steps:
1. Setting `CHRONO_AUDIT_DRESS_REHEARSAL=false`
2. Supplying a valid `CALLE_API_KEY`

There is no automated path that dials phone calls unintentionally.

## 2. Anti-Spoofing Directory Model

`chrono-audit` strictly resolves phone numbers from a pre-configured organization directory (`phonebook.json`), never from names or phone numbers embedded inside the pull request text.
- If phone numbers in the audited PR body were dialed, an adversarial agent or contributor could inject an external phone number they control to self-authorize arbitrary code changes.
- Unknown contacts immediately evaluate to `NEEDS_HUMAN_REVIEW` without dialing.

## 3. Interview Protocol Safety

- The prompt clearly informs the receiver in the opening turn that the call is a routine engineering change-control audit, not a security incident.
- Calls are strictly capped by `CHRONO_AUDIT_MAX_CALL_SECONDS` (default 180s).
- The system never negotiates or attempts to persuade a colleague after a denial; an authorizer denial terminates the call and locks the merge gate.
- No passwords, tokens, API keys, or confidential secrets are requested or transferred during the call.

## 4. Fail-Closed Decision Policy

Every ambiguous or uncertain outcome fails closed:
- Authorizer unreachable $\rightarrow$ `NEEDS_HUMAN_REVIEW`
- Authorizer not registered in directory $\rightarrow$ `NEEDS_HUMAN_REVIEW`
- Statement hedges or yields low entailment confidence $\rightarrow$ `NEEDS_HUMAN_REVIEW`
- Delegation chain exceeds maximum hops $\rightarrow$ `NEEDS_HUMAN_REVIEW`
- Authorizer denies authorization $\rightarrow$ `BLOCKED`

Only unequivocal verbal confirmation with verified entailment yields `VERIFIED`.
