# LostLine Coordinator

LostLine is a consent-first, multi-location lost-property coordinator. It works through an ordered route of human-verified public facility contacts, creates at most one CALL-E task per planned destination, validates structured evidence locally, and stops before later calls when two disclosed distinctive features support a credible candidate.

The default command is a fully inspectable preview. It does not import the CALL-E SDK, contact a network, or place a call. Live mode requires the preview's exact request-bound receipt, two explicit execution flags, a fresh approved UTC call window, recently verified public contacts, a new private output path, and a server-side API key.

## Why this workflow

A lost item often could be at any stop on a route. A person must find the right public desks, repeat the same description, handle refusal or voicemail, and reconcile inconsistent answers. LostLine makes that bounded phone work inspectable while keeping ownership claims and proof with the person.

The coordinator:

1. validates an opaque search ID, owner authorization recorded within 24 hours, a separately withheld claim detail, a bounded route, and a one-hour-or-shorter call window;
2. refuses unknown fields, control/bidirectional characters, common secrets/contact data, prompt-like instructions, private source URLs, duplicate destinations or normalized features, and sensitive item categories;
3. shows every disclosed fact, the exact outbound task text, masked destinations, verification timestamps, call cap, and content-bound receipt;
4. creates ordered, independently idempotent CALL-E tasks and durably checkpoints each accepted public call ID before polling;
5. accepts evidence only from a completed task with exactly one completed recipient, one exact phone match, and structured confirmation that the recipient explicitly agreed after the complete processing/transcription/possible-recording disclosure, computes confidence from distinct feature IDs, and stops on a strong match, invalid output, or provider terminal failure; and
6. writes only locally generated evidence text and safe enums to a new mode-`0600` report.

It never claims, reserves, collects, buys, pays for, or arranges delivery of an item.

## Try it without an account

Node 20 or later:

```bash
cd apps/typescript/lost-line-coordinator
npm install
npm run check
npm test
npm run demo
```

`npm run demo` uses an in-process fake port. It creates no network connection and no phone call. The first fictional desk reports no match, the second confirms two disclosed features, and the coordinator avoids the third planned task. The test suite also drives the real `@call-e/calle` adapter through an in-memory `fetch` fake, so POST serialization, the idempotency header, polling, and camelCase result conversion are exercised without a socket or credential.

## Preview

Create the ignored private directory, copy the sample, then replace every fictional value. The sample timestamps are intentionally historical and must be refreshed before any live test.

```bash
mkdir -p private
cp examples/search.example.json private/search.json
npm run lost-line -- preview --request private/search.json
```

Before setting `published_contact_confirmed`, a person must compare the full E.164 number in the private request with the location's official public HTTPS page. Before setting `calling_hours_confirmed`, they must also confirm that the approved live window is within published calling hours. The app deliberately does not fetch untrusted source pages. The preview masks phone numbers but shows each source, recent verification time, and the confirmations. Any change to the item, ordered route, window, cap, or confirmation changes the receipt.

## Run one controlled live search

Live mode can create real outbound phone tasks. For testing, use only numbers owned by or expressly authorized by the test participants. Do not call uninvolved businesses with a fictional lost-item story, and never execute the reserved `555-01xx` sample numbers.

Store the API key in the environment on the machine running the command; never place it in a file or paste it into chat.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"

npm run lost-line -- run \
  --request private/search.json \
  --live \
  --confirm-authorized \
  --receipt <RECEIPT_FROM_PREVIEW> \
  --output private/report.json
```

The report path is exclusively reserved with mode `0600` before the SDK is created. Before each provider create, the file records the side-effect-derived idempotency key; after acceptance it records the CALL-E call ID. Each file replacement and its parent-directory entry are synced before execution continues. If polling fails, the checkpoint remains and says not to retry automatically. Reconcile that call ID and key in the official dashboard first.

The API key may be sent only to the exact origin `https://api.heycall-e.com`. HTTP, loopback, alternate hosts, URL credentials, paths, query strings, and fragments are refused. Tests inject a fake `fetch`; the live CLI has no fake-base-URL escape hatch.

## Input boundary

The request requires:

- an opaque ID matching `search-[a-f0-9]{12}`;
- literal owner authorization, its UTC recording time no more than 24 hours before the window ends, and a UTC expiry covering the live window;
- `claim_verification_detail_withheld: true`, confirming that a separate proof detail is absent from the request;
- an ASCII-English category, color, optional brand, two to five normalized-distinct non-secret observable features, and a UTC loss window;
- one to six unique E.164 destinations, each with a credential-free public-DNS HTTPS source, explicit contact and calling-hours confirmation, a verification timestamp no older than 24 hours at execution, region, and locale; and
- a cap from one through the route length, an approved UTC call window no longer than 60 minutes with at least ten minutes remaining before each new task, voicemail disabled, and strong-match early stopping enabled.

The parser is defense in depth, not a universal PII detector. All item descriptors are intentionally limited to short, hand-authored ASCII-English noun phrases because the safety classifier is not multilingual. Do not include any person's name, email, callback number, street address, account/payment data, identity or health information, credential, or proof secret. The preview prints the exact task so a person can inspect what will be disclosed.

Live input must be hand-authored and fully reviewed by the operator. Do not pipe model-generated, scraped, emailed, or otherwise untrusted prose into the request: a finite instruction filter cannot prove that arbitrary natural language is a safe physical description.

Medical, financial, identity-document, emergency, weapon, controlled-substance, missing-person, legal, and law-enforcement use cases are outside scope.

## Evidence-derived results

CALL-E is asked for strict per-recipient fields with `additionalProperties: false`: whether the recipient explicitly agreed to continue after the complete disclosure, desk status, whether an item was logged, matched and contradicted feature IDs, a short non-sensitive reference token, a safe retrieval-mode enum, and human-follow-up status. LostLine rejects unknown keys, invalid enums, duplicate/unknown feature IDs, overlap between matched and contradicted IDs, reference codes without a letter or with more than six digits, and any item evidence returned without structured agreement.

`strong` is computed locally only when the top-level task is completed, its sole recipient has the exact planned phone and completed status, structured agreement is true, and a reached desk reports an item with at least two explicitly matched distinct features and no contradiction. One match or an otherwise plausible agreed result is `possible`; a clear agreed negative is `none`; malformed, missing, no-agreement, ambiguous, closed, refused, voicemail, or unresolved output is `unknown`. All results remain unverified. Provider free-form summaries, transcripts, recordings, URLs, addresses, and payment instructions are not copied into the report.

## Side effects and trust

- Preview, tests, and demo create no CALL-E task and need no credential.
- Live mode creates sequential one-recipient CALL-E tasks up to `max_calls`; provider/carrier attempt behavior is outside this app's hard cap and must be checked in CALL-E.
- The task begins by disclosing that it is an AI call processed and transcribed by CALL-E and that audio may be recorded where enabled, requires explicit agreement after that complete disclosure and before the item inquiry, never leaves voicemail, and ends without persuasion when consent or an automated caller is refused.
- Failed, canceled, non-terminal, mismatched-ID, or locally invalid results stop the route before another destination.
- No recurring job or schedule is created.
- The app never stores SDK transcripts or recordings. That does not control CALL-E's provider-side processing or retention; confirm official terms and applicable recipient-consent requirements before any non-test use.
- Request files, checkpoints, and reports remain private even though minimized. App-local ignore rules cover the documented filenames, but always inspect `git status` before committing.

## Cancellation and recovery

Preview has no side effect. Before live execution, omit either live flag, do not supply the matching receipt, use an expired/out-of-window request, or do not provide a fresh output path.

After a create is accepted, the installed TypeScript SDK version does not expose a cancellation method. Use the official CALL-E dashboard or support controls if available. If the process fails, use the private checkpoint's call ID and idempotency key to reconcile provider state; do not make a new request or change the key merely to retry. This reference app intentionally has no automatic resume/fetch command after a timeout; recovery is a manual dashboard reconciliation before any separately reviewed continuation. Each poll is capped at eight minutes, and the approved live window is checked again before each later destination.

## Validation

```bash
npm run check
npm test
npm run demo
python3 ../../../scripts/validate_repository.py
```

This is a bounded reference app, not a supported lost-property service or a substitute for the location's human claim process.
