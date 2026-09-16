# Examples

All examples are fictional. Recipient labels are masked and no example places
a call.

## Product choice preview

```json
{
  "mode": "preview",
  "task_title": "Choose the onboarding next step",
  "context": "The agent is finalizing a reversible onboarding sequence.",
  "question": "Should a verified user start a guided test or configure call settings first?",
  "choices": [
    {"id": "guided_test", "label": "Start a guided test"},
    {"id": "configure_first", "label": "Configure call settings first"}
  ],
  "recipient": "Product owner (+1 ****** 0134)",
  "expires_in_seconds": 900,
  "effect": "Update only the onboarding sequence draft.",
  "live_side_effect": "One real phone call after approval"
}
```

## Operations alert preview

```json
{
  "mode": "preview",
  "task_title": "Respond to elevated file-agent errors",
  "context": "The nightly file agent reports an error rate above 20 percent.",
  "question": "What should the agent do next?",
  "choices": [
    {"id": "pause", "label": "Pause inbox processing"},
    {"id": "escalate", "label": "Escalate to operations support"},
    {"id": "monitor", "label": "Continue monitoring without a change"}
  ],
  "recipient": "On-call owner (+1 ****** 0168)",
  "expires_in_seconds": 600,
  "effect": "Select one already documented incident-response branch.",
  "live_side_effect": "One real phone call after approval"
}
```

The preview does not authorize a production change. If the chosen branch can
perform an irreversible action, that action needs its own approval mechanism.

## Completed result

```json
{
  "request_id": "req_example_01",
  "status": "completed",
  "choice": "escalate",
  "rationale": "Keep processing running while operations investigates.",
  "constraints": ["Do not restart workers automatically"],
  "answered_by": "enrolled_human",
  "last_updated_at": "2030-01-15T09:30:00Z",
  "terminal": true
}
```

The agent may select the previewed `escalate` branch and must preserve the
returned constraint. It may not interpret the rationale as permission for any
additional action.

## No-answer result

```json
{
  "request_id": "req_example_02",
  "status": "unanswered",
  "message": "The enrolled human did not answer before the request expired.",
  "last_updated_at": "2030-01-15T09:45:00Z",
  "terminal": true
}
```

The agent remains paused. It does not create a second call automatically.

## Decline result

```json
{
  "request_id": "req_example_03",
  "status": "declined",
  "message": "The enrolled human declined to answer this question.",
  "last_updated_at": "2030-01-15T10:00:00Z",
  "terminal": true
}
```

The decline ends the handoff. Changing the wording or recipient to seek a
different answer is not allowed.
