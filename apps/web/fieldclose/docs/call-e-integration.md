# FieldClose CALL-E Integration

## Implemented boundary

FieldClose pins the official `@call-e/calle` server SDK at `0.6.0`. The SDK is imported and called only from server code.

The provider adapter:

- creates an asynchronous call with `client.calls.create`;
- sends one approved E.164 recipient with `US` and `en-US` routing hints;
- sends the stable server-created attempt idempotency key;
- includes only the reviewed closeout context and question families;
- supplies a strict whole-task JSON Schema;
- includes FieldClose case and attempt identifiers in CALL-E metadata;
- retrieves existing call state with `client.calls.get`;
- maps provider snapshots conservatively;
- freezes creation ambiguity and result timeout for reconciliation;
- never calls `createAndWait` from an HTTP request.

The official CALL-E references used by this implementation are:

- [CALL-E authentication](https://docs.heycall-e.com/authentication)
- [CALL-E calls](https://docs.heycall-e.com/calls)
- [CALL-E SDKs](https://docs.heycall-e.com/sdks)

The five-second interval, 600-second bound, and final lookup follow the public hackathon contribution pattern in [PR #39](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/39/files), [PR #41](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/41), [PR #42](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/42), [PR #43](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/43), and [PR #44](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/44). FieldClose adds persistent server-side throttling, workspace authorization, idempotent normalization, and explicit human reconciliation around that pattern.

## Environment contract

The protected server environment requires only the project API key. The base URL is optional:

```dotenv
CALL_E_API_KEY=<server-only API key>
CALL_E_BASE_URL=https://api.heycall-e.com
```

The API key is never returned by an application route or included in a provider task. No secondary result-delivery credential or public provider callback route is part of this integration.

The initial live integration is intentionally US-only. Protected cases reject
non-`+1` recipients before storage so the explicit phone number cannot disagree
with the adapter's fixed `US` region and `en-US` locale. The fake provider keeps
general fictional E.164 support for safe evaluation.

## Creation-error classification

FieldClose treats `failed_before_acceptance` as a strong claim that CALL-E
rejected the request before creating any external side effect. The adapter makes
that claim only for an explicit allowlist of request, authentication, endpoint,
media-type, and validation rejections: HTTP `400`, `401`, `403`, `404`, `405`,
`413`, `415`, and `422`.

Every other provider API error defaults to
`ambiguous_requires_reconciliation`. This includes HTTP `408`, `409`, `425`,
`429`, all `5xx` responses, connection or timeout failures, missing success
bodies, and unexpected exceptions. These responses do not prove that CALL-E did
not accept the stable idempotency key. FieldClose freezes the attempt and
requires human reconciliation instead of treating the request as safe to repeat.

## Authenticated status refresh

After CALL-E accepts the asynchronous create request, the active workbench refreshes the existing attempt through FieldClose:

```http
POST /api/attempts/<attemptId>/refresh
Content-Type: application/json

{"workspaceId":"<uuid>"}
```

The browser never contacts CALL-E directly. The route authenticates the session and protected workspace membership before any provider lookup. Only owners and operators may refresh a protected CALL-E attempt; auditors cannot.

The server locks and atomically claims `lastCheckedAt` before the provider request. This limits an attempt to one lookup every five seconds across tabs and server instances. The CALL-E network request runs outside the database transaction.

Refresh never creates, retries, or redials a call. Provider state is handled as follows:

| CALL-E state | FieldClose behavior |
| --- | --- |
| `queued` or `in_progress` | Update provider status and `lastCheckedAt`; do not create a result |
| `completed`, `failed`, or `canceled` | Validate the call ID, normalize the structured result, and persist one result and follow-up set |
| Mismatched call ID | Move the case to explicit reconciliation |
| Temporary lookup failure before 600 seconds | Keep the accepted attempt in progress and allow a later lookup |
| Still unresolved at 600 seconds | Perform the final lookup, mark the case `needs_attention`, and create one `provider_reconciliation` task |

The 600-second boundary is calculated from the persisted `acceptedAt` timestamp. Automatic refresh stops at a terminal result, reconciliation, navigation away from the active case, or component unmount. A human may still use `Refresh provider status` after timeout; a late terminal snapshot completes the normal result transaction and resolves the reconciliation task.

### Browser close and reopen boundary

The current MVP has no background worker, service worker, hosted poller, or
server timer that continues CALL-E status lookup after the operator leaves the
case. The five-second timer belongs to the mounted workbench only:

1. Opening a case first loads its persisted detail from FieldClose.
2. If that detail contains a live attempt with a stored provider call ID, no
   result, and no reconciliation state, the workbench schedules its first
   refresh for about five seconds later.
3. Navigating to another case, opening the new-case form, signing out, closing
   the tab, or unloading the workbench clears the browser timer. No CALL-E
   request continues in the background.
4. Reopening the same nonterminal case loads the same attempt from the database
   and starts a new five-second timer. The refresh route looks up the stored
   provider call ID; it does not execute call creation or mint a new attempt or
   idempotency key.
5. Time away from the page still counts toward the 600-second boundary because
   the server compares the current time with persisted `acceptedAt`. If the
   boundary elapsed while the page was closed, the first eligible refresh after
   reopening performs the bounded final lookup. A terminal provider snapshot is
   persisted normally; an unresolved snapshot creates one reconciliation task.

Once the case is already in `needs_attention`, automatic refresh does not
restart on reopen. The operator must use `Refresh provider status` to retrieve a
late terminal snapshot from the same accepted call.

## Protected live path

The authenticated HTTP API supports protected-workspace live mode without changing the fake public-demo default:

```http
POST /api/cases
{"workspaceId":"<uuid>","mode":"live","case":{...}}
```

The live case contact must include a non-demo `authorizationBasis` and a bounded `authorizationNote`.

```http
GET /api/cases/<caseId>/preview?workspaceId=<uuid>&mode=live
```

```http
POST /api/cases/<caseId>/approve
{
  "workspaceId": "<uuid>",
  "mode": "live",
  "approval": {
    "expectedCaseVersion": 1,
    "expectedBriefHash": "<preview hash>",
    "callingWindow": {
      "timezone": "America/Chicago",
      "startLocal": "2026-07-29T09:00:00",
      "endLocal": "2026-07-29T17:00:00",
      "evaluatedAt": "2026-07-29T14:55:00Z"
    },
    "operatorAttestations": [
      "contact_authorized",
      "brief_reviewed",
      "live_call_authorized",
      "recipient_consent_confirmed"
    ]
  }
}
```

```http
POST /api/attempts/<attemptId>/execute
{"workspaceId":"<uuid>","mode":"live"}
```

The execution response is normally `in_progress`. Completion is retrieved through authenticated bounded refresh.

Immediately before creating a call, the server rechecks:

- authenticated owner/operator membership;
- protected workspace kind and CALL-E provider;
- workspace live-call permission;
- environment live flag and API credentials;
- durable global kill switch;
- current case and exact attempt;
- live approval and all attestations;
- case version, brief hash, and provider request fingerprint;
- non-demo contact authorization and do-not-call state;
- exact approved local 08:00-18:00 calling window;
- existing result, provider call id, creation lifecycle state, and ambiguous state.

Those creation gates do not prevent lookup of an already accepted call. Once a
provider call ID is stored, repeated browser execution returns that call and
does not invoke creation again. If CALL-E accepted the stable idempotency key but
the local acceptance write did not complete, the workbench offers an explicit
recovery action after the durable 60-second creation-claim lease. While that
lease is active, concurrent execution returns `in_progress` without invoking
CALL-E again. Recovery reuses the same attempt and idempotency key so CALL-E
returns the same logical call; it never creates a new FieldClose attempt or
changes the approved recipient or brief. A lease recovery can issue another HTTP
request with that same idempotency key, so the guarantee is one logical provider
creation rather than one HTTP request over the entire recovery lifecycle.
Failed-before-acceptance and ambiguous creation outcomes remain frozen.

The SDK adapter, live application path, authenticated status refresh, protected
operator UI, and protected-workspace provisioning boundary are implemented and
covered through the injected HTTP boundary. A maintainer-reported private record
describes one separately authorized local CALL-E task, its terminal result, a
structured-result discrepancy, and a dated operator correction. That record is
redacted and not independently accessible, so it is not public validation or
deployment provenance and does not establish accurate structured answer
capture. The publicly reviewable environment is fake-only. Protected-staging,
SMTP, and live-attempt statements elsewhere in this tree are likewise qualified
as private operational observations unless a public artifact directly supports
them.
