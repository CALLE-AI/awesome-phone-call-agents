# PawPassage safety contract

## Authority

PawPassage gathers evidence. A recipient's words and CALL-E's structured result
do not authorize the application to book transport, pay money, accept terms,
certify health, interpret law, or declare a journey permitted. The strongest
automated output is `EVIDENCE_PACKET_READY`, which means only that three frozen
propositions were confirmed and a written reference was offered.

## Before any real call

The operator must provide and review:

1. one exact E.164 recipient from an official source or a consenting test
   recipient;
2. a documented CALL-E region and locale whose published country calling code
   matches the exact number; unsupported or conflicting pairs fail closed;
3. a purpose-bound authorization note;
4. three exact operational propositions;
5. the complete generated task and closed result schema;
6. a matching preview digest;
7. a fresh live approval, exact allowlist match, enabled kill switch, and
   current call window no longer than four hours.

The live adapter accepts only the official CALL-E API origin. The fake adapter
accepts only loopback hosts. Credentials are read only after every earlier live
gate passes.

## During the call

Before any question, the task requires the agent to identify itself as an AI
voice assistant, state that the call may be recorded, transcribed, summarized,
analyzed, stored, and shared with CALL-E service providers to operate the
service, and ask whether the recipient consents to continue. The agent may
proceed only after a clear yes. Refusal, silence, withdrawal, or a request to
stop ends the call and produces the closed `DO_NOT_CONTACT` result.

The task also forbids:

- booking, payment, negotiation, reservation, or contractual acceptance;
- health certification, medical advice, or legal interpretation;
- names, addresses, passport or microchip numbers, medical records, bank or
  payment data, passwords, and security codes;
- collecting a URL or email address spoken by the recipient;
- retrying or redialing; and
- guessing when a proposition is not established.

A request to stop automated calls becomes `DO_NOT_CONTACT`. The workflow does
not place another call for the same approved intent.

## Duplicate and ambiguity policy

The exact preview and approval produce one stable idempotency key. The app
commits a `RESERVED` ledger record before the SDK create request. Any repeat
with the same key returns the stored record and never invokes CALL-E.

If submission might have crossed the network boundary but no authoritative call
ID is known, the state becomes `SUBMISSION_UNKNOWN`. That state cannot transition
to a new call. If a call ID is known, only read/reconcile operations are allowed.
Failed/canceled provider statuses are not interpreted as no-answer because the
public Calls contract does not enumerate those failure-code semantics.

## Result trust

PawPassage requires exact task, metadata, recipient, phone, and one-attempt
binding. The local result validator rejects missing or extra fields, unknown
enums, factual answers from an unreached or wrong-role recipient, incomplete
written-reference status, and completion/failure contradictions.

Malformed or ambiguous results contain no actionable facts in the local
report. They route to human review and never cause another call.

## High-stakes boundaries

- **Animal health:** Ask only whether an administrative service exists. A
  veterinarian must make clinical decisions and issue any health document.
- **Law and border requirements:** Ask whether fixed propositions are confirmed
  and whether a written reference exists. Use the competent authority's current
  written rules and qualified advice for any legal conclusion.
- **Emergency or animal distress:** Do not use this workflow. Contact an
  appropriate veterinarian or emergency service directly.
- **Money and contracts:** The application cannot accept a quote, pay a fee, or
  reserve capacity. Any such request stops at a human.

## Retention

Reports contain masked numbers, opaque identifiers, hashes, closed structured
answers, and reason codes. They omit transcripts, recordings, full numbers,
credentials, names, addresses, identity documents, and clinical records. A
deployer must define retention and access rules before using non-fictional data.

Deleting a local ledger erases the duplicate guard but cannot undo a phone call.
Retain it until the call and provider retry horizons have safely elapsed.
