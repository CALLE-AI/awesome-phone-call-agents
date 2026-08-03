# Access Route Caller

Some organizations still make the phone line the only visible door. That door can be difficult or impossible for somebody who is Deaf or hard of hearing, uses a relay service, needs extra processing time, relies on a support person, or cannot manage an unplanned live call.

Access Route Caller makes one narrow CALL-E call to ask which communication routes the organization supports. It returns the public instructions in writing. It does not conduct the person's underlying business.

## What makes this different

This app does not book, buy, negotiate, access an account, or speak about why somebody needs another route. It asks only how a person can communicate:

- email or secure messaging;
- text messaging;
- a scheduled callback window;
- telecommunications relay support;
- participation by a support person; or
- a slower-paced future conversation.

The useful outcome may be that no alternative exists or that the organization refuses automated callers. The app reports that plainly instead of pretending the access problem was solved.

## Safety model

The workflow has three separate gates:

1. The request must state that the owner authorized the call and must point to the organization's published HTTPS contact page.
2. Preview mode shows the exact CALL-E task, a masked destination, the requested routes, and a SHA-256 receipt. It places no call.
3. Live mode requires the unchanged request, the matching preview receipt, `--execute`, and a separate `--confirm-owner-authorized` flag.

The task explicitly forbids names, disability or health reasons, account access, identity verification, appointments, purchases, fees, commitments, passwords, codes, and medical, legal, or financial facts. Unknown request fields and unsupported route types fail closed.

## Setup

Python 3.11 or later and `uv` are recommended:

```bash
cd apps/python/access-route-caller
uv sync
```

Copy `example_request.json`. Use one organization or public-serving business, an E.164 number it publishes, and the HTTPS page where the number appears. The included number is a fictional reserved example and must not be called.

## Preview without a call

Preview is the default. It needs no account, credential, or network access:

```bash
uv run python access_route.py --request example_request.json
```

The output contains a `receipt` bound to the complete normalized request. Editing the destination or any requested route changes the receipt.

## Run one live call

Use a CALL-E account and a destination you are legally permitted to call. Keep the API key in an environment variable or secret manager, never in the request file:

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"

uv run python access_route.py \
  --request your-authorized-request.json \
  --execute \
  --confirm-owner-authorized \
  --receipt <receipt-from-preview> \
  --output private-result.json
```

Live mode creates exactly one CALL-E call task and waits for its terminal result. The stable `accessroute-<workflow_id>` idempotency key prevents a retry of the same workflow from creating a duplicate call. Use a new `workflow_id` for a materially different authorized call.

## Input contract

- `workflow_id`: stable non-secret identifier.
- `owner_authorized`: must be literal `true`.
- `organization.display_name`: public organization or business name.
- `organization.phone`: one E.164 number.
- `organization.published_source`: public HTTPS page where the contact route is published.
- `requested_routes`: one to six supported route names.
- `locale`: optional locale such as `en-US`.
- `allow_neutral_voicemail`: optional boolean, false by default.

No free-text personal narrative belongs in this request. Unknown fields are rejected so a disability reason, case number, or other detail cannot silently enter the provider task.

## Side effects and boundaries

- Live mode places one outbound call. There is no schedule and no background worker.
- The caller identifies itself as AI in its first sentence.
- The call gathers public communication-access instructions only.
- It is not for emergencies, crisis response, medical advice, legal advice, financial activity, collections, political outreach, marketing, or calls to private individuals.
- It cannot establish that an offered route is legally sufficient, accessible in practice, or available to a specific person or account.
- A result is a report of what was said, not proof that the organization will honor the route later.
- CALL-E and its telephony providers necessarily process the call and may retain audio, transcripts, or metadata under their policies. Review those policies before live use.
- Numbers are masked in previews and phone-like text is removed from returned structured results. A private result can still contain public contact instructions and should not be committed.

## Cancellation and rollback

Preview mode has no side effect. Before execution, cancel by omitting `--execute`, the confirmation flag, or the matching receipt. Once CALL-E accepts the task, this app cannot guarantee cancellation; use CALL-E's dashboard or provider controls if they expose it. The workflow creates no recurring job to remove and makes no external change to roll back.

## Validation

Tests inject a fake CALL-E client and never place a real call:

```bash
python3 -m unittest discover -s tests -v
python3 ../../../scripts/validate_repository.py
```

Live verification is opt-in. Use a number you own or a public organization you are authorized to contact, preserve only a redacted result, and never commit the live request, result, credential, transcript, or recording.
