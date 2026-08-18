# RingMyHuman MCP Reference

RingMyHuman is one implementation of the portable human-context-handoff
workflow. The generic skill does not require it.

## Connection

Add this remote MCP endpoint to a compatible client:

```text
https://mcp.ringmyhuman.com/mcp
```

Compatible clients open a user sign-in and request the required scopes. Do not
paste passwords or tokens into agent prompts or configuration files.

## Useful tools

- `check_ringmyhuman_status`: confirm the service is reachable, authenticated,
  and ready before a live handoff.
- `list_ringflows`: identify an enabled calling policy and its remaining daily
  capacity.
- `request_human_help`: durably store and queue one bounded request, returning a
  request ID quickly.
- `get_human_help_status`: poll milestones and the terminal structured result.
- `cancel_human_help`: request cancellation where the current lifecycle state
  permits it.

Ringflow-management tools may also list, create, edit, enable, or disable the
user's reusable call policies. Management does not place a call.

## No-call preparation

Before `request_human_help`, prepare and show the skill preview locally. Status,
Ringflow listing, and local preview steps do not create a telephone call.

## Live example

Use fictional or masked values in documentation. The real recipient is selected
from the signed-in account's verified contacts.

```json
{
  "task_title": "Choose the onboarding next step",
  "task_summary": "Select one reversible onboarding sequence.",
  "reason": "The agent needs the product owner's preference before updating the draft.",
  "question": "Should a verified user start a guided test or configure call settings first?",
  "recommended_action": "Start a guided test",
  "alternatives": ["Start a guided test", "Configure call settings first"],
  "urgency": "normal",
  "client_request_id": "onboarding-choice-example-v1",
  "ringflow_id": "flow_default",
  "response_deadline": "2030-01-15T09:45:00Z"
}
```

`client_request_id` is the stable idempotency identity for this logical
question. If submission or polling becomes ambiguous, reconcile the existing
request instead of changing that value and trying again.

The MCP request returns promptly after durable acceptance. Progress
notifications, when supported by both the client and server, apply only while a
single MCP operation remains active. The complete telephone lifecycle uses the
durable request ID and status polling.

## Mapping to the portable contract

RingMyHuman implements the acknowledgement, polling, and terminal rules in
[`result-contract.md`](result-contract.md), but names some fields differently
and nests the decision. Adapters should map them as follows.

### Acknowledgement

| Portable contract | RingMyHuman |
| --- | --- |
| `request_id` | `request_id` |
| `status` | `status` (`queued`) |
| `poll_after_seconds` | `poll_after_seconds` |
| `status_operation` | `status_tool` (`get_human_help_status`) |

### Terminal result

RingMyHuman returns the outcome under a nested `decision` object:

```json
{
  "request_id": "req_example_01",
  "status": "completed",
  "terminal": true,
  "last_updated_at": "2030-01-15T09:30:00Z",
  "decision": {
    "decision": "approved",
    "selected_action": "Escalate to Ops support.",
    "instructions": "Keep inbox services running while Ops investigates.",
    "summary": "The human chose escalation and asked that processing continue.",
    "answered_by": "connected_human",
    "decided_at": "2030-01-15T09:29:51Z",
    "unanswered_follow_up_questions": []
  }
}
```

| Portable contract | RingMyHuman |
| --- | --- |
| `choice` | `decision.selected_action` (see note) |
| `rationale` | `decision.summary` |
| `constraints` | `decision.instructions` |
| `answered_by` | `decision.answered_by` |
| `last_updated_at` | `last_updated_at` |
| `terminal` | `terminal` |

**Note on choice IDs.** RingMyHuman accepts `recommended_action` and
`alternatives` as human-readable strings and returns `selected_action` as
prose, not as a stable ID. A host using this skill must match the returned text
back to one previewed choice and fail closed when the match is not unambiguous.
Do not infer a branch from a partial or fuzzy match.
