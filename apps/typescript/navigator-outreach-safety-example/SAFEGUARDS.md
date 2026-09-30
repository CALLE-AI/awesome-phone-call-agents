# Use case and safeguards

## Use case

The example demonstrates a narrow engineering pattern: dependency/runtime verification for an external communications SDK while a project remains in a no-call test posture. A fictional mock result can be used to validate guard behavior without handling a person’s phone number or communicating with an external service.

## Non-negotiable lock

The runtime accepts only this state:

| Control | Required value |
| --- | --- |
| Execution | disabled |
| GO | disabled |
| Maximum calls | 0 |
| Shutdown | active |

The package rejects changed values and rejects any supplied `CALLE_API_KEY`. The public package has no network transport or dispatch function; its mock guard always reports `externalConnectionUsed: false` and `telephoneCallAttempted: false`.

## Data minimization

Public tests use a fictional identifier only. The package deliberately excludes phone numbers, credentials, contact records, authorization material, and operational documentation.
