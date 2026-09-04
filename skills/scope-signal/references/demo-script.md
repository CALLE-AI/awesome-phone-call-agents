# ScopeSignal — Demo Script

Target length: 2 minutes 35 seconds. Record at 1920×1080. Use a terminal with large text and keep the recipient masked.

## 0:00–0:18 — The expensive ambiguity

**Visual:** Title card, then the GO input fixture fields: authority, deposit, scope, payment timing, deadline.

**Voiceover:**

“A project can sound valuable and still be impossible to collect on. The caller may not control the decision, the deposit may only be promised, and the delivery boundary may still be moving. ScopeSignal verifies those facts before a freelancer commits work.”

## 0:18–0:43 — Authorization and frozen preview

**Visual:** Run:

```bash
python3 skills/scope-signal/scripts/scope_signal.py preview \
  --input skills/scope-signal/assets/go-input.json
```

Highlight `call_placed: false`, masked phone, authorization summary, digest, `attempt_limit: 1`, `automatic_retries: false`, and `recurring: false`.

**Voiceover:**

“The default path is offline. ScopeSignal requires a recent, purpose-bound authorization record and freezes the recipient, project, task, result schema, and one-call controls into one approval digest. Public, scraped, implied, expired, or unrelated contact data is rejected.”

## 0:43–1:00 — CALL-E boundary

**Visual:** Open `references/calle-workflow.md`; highlight `plan_call`, `run_call`, `get_call_run`. Then show the handoff command without executing a live call.

**Voiceover:**

“A CALL-E host follows one explicit sequence: plan, run once, then poll the returned run ID. There is no automatic retry or recurrence. The unmasked provider payload is never printed; it can only be written through a separate explicit command to a permission-0600 file.”

## 1:00–1:30 — Transcript-grounded reconciliation

**Visual:** Run:

```bash
python3 skills/scope-signal/scripts/scope_signal.py reconcile \
  --input skills/scope-signal/assets/go-input.json \
  --fixture skills/scope-signal/assets/go-result.json
```

Highlight complete-sentence quotes, normalized `SELF_FINAL`, `FUNDED`, `NONE`, and recommendation `GO`.

**Voiceover:**

“A completed call is not automatically evidence. Every field must come from one substantive complete sentence spoken by the callee. ScopeSignal derives authority, funding, risk, and the other project facts from those quotes instead of trusting generated fields.”

## 1:30–1:58 — Fail-closed attacks

**Visual:** Show test names for budget-only authority, conditional funding, broad false-context, contradictory values, agent-only quotes, and PII redaction. Run:

```bash
python3 -m unittest discover -s skills/scope-signal/tests -v
```

**Voiceover:**

“Budget authority alone is not final authority. Pending or conditional funding cannot become GO. Agent speech cannot ground a fact. Duplicate, negated, contradictory, or ambiguous evidence is rejected. Human-facing output masks phone numbers, emails, and account-like identifiers.”

## 1:58–2:20 — Three honest outcomes

**Visual:** Show the three fictional fixture results in sequence: GO, CAUTION, NO-GO.

**Voiceover:**

“GO means the verification record is complete, not that the project has been accepted. CAUTION means a required fact is unresolved. NO-GO means the call failed, the callee refused, identity is missing, or final authority was not established.”

## 2:20–2:35 — Human decision and proof

**Visual:** Show `final_decision_owner: human`, then PR 276 and validator success.

**Voiceover:**

“ScopeSignal gives a one-person business an auditable pre-engagement checkpoint while negotiation and acceptance remain human. The project is open source, validated, and submitted through the official CALL-E community repository.”

## Capture checklist

- Never display a full real phone number, CALL-E key, email, or handoff file.
- State clearly that fixtures are fictional and no live call is claimed.
- Show PR: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/276
- Show `26 tests` and `Repository validation passed` in the final frame.
- Export H.264 MP4, 1080p, under 3 minutes; upload publicly to YouTube or Vimeo.
