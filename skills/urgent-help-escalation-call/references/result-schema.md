# Structured Result

Declare this as `recipient_result_schema` on the call, so CALL-E returns it
validated instead of you inferring an outcome from a transcript.

```json
{
  "type": "object",
  "required": ["reached"],
  "properties": {
    "reached": {
      "type": "string",
      "enum": ["caregiver", "someone_else", "voicemail", "no_answer"],
      "description": "Who the message actually reached."
    },
    "acknowledged": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Did they confirm they heard and are going to the subject?"
    }
  }
}
```

Two fields. An escalation call has exactly two questions, and adding a third
invites the model to editorialise about a situation it cannot see.

## `reached` is not `acknowledged`

The distinction is the whole point of the schema, and it is what drives the
[escalation ladder](escalation-ladder.md):

| `reached` | `acknowledged` | What actually happened |
| --- | --- | --- |
| `caregiver` | `yes` | Someone is going. Stop. |
| `caregiver` | `no` / `unknown` | A person heard it. Nobody promised anything. |
| `voicemail` | — | A message exists. Nobody has heard it. **Keep going.** |
| `someone_else` | — | A stranger has your message. Treat as not delivered. |
| `no_answer` | — | Nothing landed. **Keep going.** |

Treating voicemail as success is the most tempting mistake here, and the one
that leaves somebody waiting.

## Rules

**Never put the subject's condition in the result.** The readout is about the
*call*, not the person. Anything clinical that appears in it will end up in logs
and notifications that were never scoped for it.

**Mask the number** in the result, the logs, and any error message —
`+1555***4567`, not the whole thing.

**Record the outcome where a human will see it.** An escalation whose result is
only in a server log has told nobody anything.

**Keep the call id.** It is how you check status later, and how you tell a
support conversation what actually happened at 03:14.
