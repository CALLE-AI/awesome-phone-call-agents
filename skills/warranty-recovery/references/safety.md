# Safety

## Explicit intent

A call is placed only for a case a person asked to be resolved. There is no
sweep, no queue that dials on a timer, and no discovery of numbers this
workflow was not given.

## Authorization basis

Every recipient needs a recorded basis before the number is dialled:

| Basis | What it requires |
| --- | --- |
| `OWNED_NUMBER` | The number belongs to the caller's own organization. |
| `WRITTEN_CONSENT` | The recipient agreed in writing to be called about this. |
| `EXISTING_SERVICE_RELATIONSHIP` | A supplier, distributor or manufacturer relationship whose terms cover support contact. |
| `TEST_RECIPIENT_CONSENT` | A person who agreed to receive test calls, for development only. |

The record itself is never stored in this repository. The workflow keeps a
pointer to where it is filed, plus who granted it, when, and when it expires.
An expired basis, a purpose the recipient did not agree to, or a number that is
not on the allowlist each refuse the call before anything is sent.

## Phone numbers

- Numbers are E.164 or they are refused. This workflow uses the stricter of the
  two patterns CALL-E publishes, `^\+[1-9]\d{7,14}$`.
- Every number in a summary, log, report or error message is masked.
- Every number in documentation, tests and fixtures comes from the reserved
  fictional range for the region. For North America that is the 555-0100 to
  555-0199 block. A number outside it is treated as a defect, not a style
  choice.

## Credentials

The API key is read from the environment and never written to a file the
repository can see. The client refuses to send a credential to any origin other
than the official CALL-E API host, so a redirected or mistyped base URL cannot
receive it.

## Recordings, transcripts and real call data

Real transcripts, recordings, call identifiers and raw API responses are not
repository content. They belong in a working directory outside the repository.
A `.gitignore` entry is not sufficient, because it can be overridden and
because a path can be committed before the entry exists.

## No hidden schedules, no duplicate jobs

The provider places exactly one call per authorized case. Recurrence, when a
host needs it, is the host scheduler's job. Duplicate work is prevented by
deriving the idempotency key from the authorization rather than the attempt, so
a retried request returns the original call instead of dialling again.

## Boundaries

This workflow asks about a submitted claim's status. It does not give legal
advice about a contract, does not dispute or negotiate warranty terms, does
not discuss payment instruments, and is not a route to emergency help. A
representative who refers the matter to a person is recorded as
`ACTION_REQUIRED`; the workflow does not press.
