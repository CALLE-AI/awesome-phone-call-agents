# Closeout Workflow API

## Status

The authenticated workflow HTTP API is implemented through result retrieval,
human-task creation, and the final role-gated human-disposition command.

All routes run on the Node.js runtime and require a valid Better Auth server-side session. An unauthenticated request receives the same bounded response before path, query, or body data is parsed:

```json
{
  "error": {
    "code": "authentication_required"
  }
}
```

## Configuration

Case creation, preview, approval, and execution require two different canonical base64-encoded 32-byte keys:

```text
FIELDCLOSE_DATA_KEY
FIELDCLOSE_LOOKUP_KEY
FIELDCLOSE_PHONE_KEY_VERSION
```

The first key encrypts E.164 values with AES-256-GCM. The second produces HMAC lookup tokens. Partial, malformed, or reused key configuration fails closed with a bounded `503` response.

Request bodies are limited to 32 KiB and must contain valid JSON. Zod validates route parameters, workspace identifiers, scenario identifiers, approval inputs, and case inputs at runtime.

## Routes

### List cases

```http
GET /api/cases?workspaceId=<uuid>
```

Returns at most 100 cases from the authenticated membership scope. Each item contains only masked contact presentation data and bounded attempt status.

### Create a fictional demo case

```http
POST /api/cases
Content-Type: application/json
```

```json
{
  "workspaceId": "10000000-0000-4000-8000-000000000001",
  "case": {
    "workOrderRef": "WO-DEMO-1042",
    "contractorDisplayName": "Example HVAC",
    "siteLabel": "Fictional North Store",
    "timezone": "America/Chicago",
    "contact": {
      "displayName": null,
      "role": "site_manager",
      "phoneE164": "+12025550142"
    },
    "requestedFields": [
      "observed_operating_status",
      "unresolved_issue",
      "return_visit_request"
    ],
    "visitContext": {
      "serviceDate": "2026-07-27",
      "equipmentLabel": "Rooftop unit RTU-2",
      "technicianCompletionNote": "Filter replaced and unit restarted",
      "allowedReferenceText": "A fictional technician visited to service rooftop unit RTU-2."
    }
  }
}
```

The canonical example number is from the fictional North American `555-01xx` range. The response contains its masked presentation value, never the canonical number or encrypted fields.

### Read one case

```http
GET /api/cases/<caseId>?workspaceId=<uuid>
```

Returns the masked case and contact view, current attempt and approval, latest normalized result, follow-up tasks, and redacted audit history. Every related query is rooted in a case already verified against the authenticated workspace.

### Cancel a protected case before provider creation

```http
DELETE /api/cases/<caseId>?workspaceId=<uuid>
```

An authenticated owner or operator may cancel a protected case while it is
still `draft` or `approved`. Cancellation invalidates any bound approval in the
same transaction and prevents later execution. This safety action remains
available while live-call creation is disabled or the kill switch is paused.
Once the case is `calling`,
completed, or otherwise beyond local pre-creation state, the route returns
`case_cancellation_not_safe`; it never claims that an accepted provider call was
cancelled. Provider-side cancellation remains unsupported until a verified
capability is implemented.

### Preview the exact fake brief

```http
GET /api/cases/<caseId>/preview?workspaceId=<uuid>
```

Returns the human-readable fake-mode brief, masked number, current case version, and server-calculated approval digest.

### Approve one fake attempt

```http
POST /api/cases/<caseId>/approve
Content-Type: application/json
```

```json
{
  "workspaceId": "10000000-0000-4000-8000-000000000001",
  "approval": {
    "expectedCaseVersion": 1,
    "expectedBriefHash": "<64-character server preview digest>",
    "callingWindow": {
      "timezone": "America/Chicago",
      "startLocal": "2026-07-28T09:00:00",
      "endLocal": "2026-07-28T17:00:00",
      "evaluatedAt": "2026-07-28T08:55:00Z"
    },
    "operatorAttestations": [
      "contact_authorized",
      "brief_reviewed",
      "fictional_demo_only"
    ]
  }
}
```

The API does not accept `liveCallApproved`, attempt identifiers, idempotency keys, or provider state from the browser. Repeating the unchanged approval returns the existing attempt and approval.

## Protected live mode

The same case, preview, approval, and execution routes accept explicit `mode: "live"` only for an authenticated protected CALL-E workspace. Live case input additionally requires a non-demo contact authorization basis and note. Live preview uses `?mode=live`; live approval requires the four attestations documented in [CALL-E Integration](call-e-integration.md); live execution accepts no scenario selector.

The browser can request live mode but cannot make it effective by itself. The server independently enforces the environment flag, credentials, protected workspace, workspace permission, operator role, durable kill switch, contact authorization, do-not-call state, approval digest, request fingerprint, and exact local calling window. The public demo workspace fails these gates.

Successful live execution returns `in_progress` after CALL-E accepts the
idempotent asynchronous request. The active workbench then calls
`POST /api/attempts/:attemptId/refresh` with `{ workspaceId }` every five
seconds. The authenticated server route queries only the existing provider call,
never redials, and stops automatic refresh after a terminal result or explicit
reconciliation. If the provider accepted the request but the local acceptance
write did not complete, repeating execution reuses the original attempt and
stable provider idempotency key to recover the same call ID.

### Refresh an accepted live attempt

```http
POST /api/attempts/<attemptId>/refresh
Content-Type: application/json
```

```json
{
  "workspaceId": "10000000-0000-4000-8000-000000000002"
}
```

The body is strict and accepts no creation or retry fields. The response reuses `{ "execution": ... }`. The server rejects unauthenticated callers, cross-workspace attempts, auditors, malformed identifiers, and attempts without a stored CALL-E call ID before provider lookup. A durable `lastCheckedAt` claim limits concurrent tabs to one provider request per attempt every five seconds.

### Execute an approved fake attempt

```http
POST /api/attempts/<attemptId>/execute
Content-Type: application/json
```

```json
{
  "workspaceId": "10000000-0000-4000-8000-000000000001",
  "scenarioId": "resolved_clear"
}
```

The scenario must be one of the deterministic identifiers documented in [Fake Provider and Closeout Workflow](fake-provider-and-workflow.md). The route always constructs `FakeCallProvider`; it has no parameter that can select CALL-E. The application service independently rejects a provider labelled for live calls in a demo workspace.

### Record the final human disposition

```http
POST /api/cases/<caseId>/disposition
Content-Type: application/json
```

```json
{
  "workspaceId": "10000000-0000-4000-8000-000000000001",
  "expectedCaseVersion": 1,
  "taskId": "30000000-0000-4000-8000-000000000001",
  "outcome": "closeout_accepted",
  "resolutionNote": null
}
```

The request is strict. It accepts no actor identifier, external work-order
state, appointment, invoice, price, or technical decision. The authenticated
session supplies the actor.

The server atomically:

1. verify owner or operator membership in the case workspace;
2. lock and validate the current case, result, and open task;
3. verify the expected case version and route-appropriate outcome;
4. insert one `HumanDisposition` record;
5. resolve or cancel the referenced task with the bounded note;
6. move the FieldClose case to `closed` and increment its version;
7. append `case.human_disposition_recorded` with redacted metadata.

Repeating the exact request returns the existing disposition and current case.
A stale version, already conflicting disposition, mismatched task, or outcome
that is not permitted for the normalized route returns `409` without mutation.
The response returns the bounded disposition, final case view, resolved task,
and new audit event.

## Error contract

Expected failures return only a machine-readable code and, for runtime validation errors, bounded field issues. Internal exception messages are not copied into responses.

| Status | Meaning |
| --- | --- |
| `400` | Invalid JSON, identifier, case input, approval input, disposition input, or scenario |
| `401` | No valid server-side session |
| `403` | Workspace or role does not authorize the operation |
| `404` | Case or attempt is not visible in the authenticated scope |
| `409` | Stale approval or disposition, do-not-call block, unsafe local cancellation, existing attempt, or invalid workflow transition |
| `413` | JSON body exceeds 32 KiB |
| `503` | Phone protection is absent or invalid |

Unexpected failures return `request_failed` with status `500`. Secrets, canonical phone values, and raw internal error messages are never included.
