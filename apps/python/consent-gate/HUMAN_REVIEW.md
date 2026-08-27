# Human design review

## 2026-07-29

The entrant reviewed the ConsentGate proposal and required this concrete
behavior:

> After a call is rejected, do not call that user again within 24 hours.

Implementation decision:

- A rejection event is stored with only a redacted phone fingerprint, outcome,
  and timezone-aware timestamp.
- Validation and live execution both block the same recipient for 24 hours.
- The error reports the earliest permitted retry time.
- At exactly 24 hours, another attempt may be considered, subject to all other
  consent and retry controls.

The entrant also confirmed that this is a personal entry, uses no employer
code, data, devices, or identity, and does not violate the entrant's employer
policy.

## 2026-08-03 clarification

The 24-hour rule applies only to a temporary rejection. A corroborated request
never to call again creates a permanent do-not-call record. It may be cleared
only after a new, independently verified opt-in; merely waiting 24 hours is not
sufficient.

A temporary request such as “end this call”, “hang up”, or “call me later” is
accepted only when high-confidence task evidence is corroborated by the
recipient transcript. It is persisted as `rejected` and starts the same 24-hour
cooldown. Ambiguous extraction fails closed for reconciliation.

The entrant also confirmed that ConsentGate will not accept medical, legal,
financial, or emergency content and will not create recurring or hidden
schedules. An accepted call can be ended verbally by the recipient; the pinned
provider SDK has no operator-side cancellation endpoint, so live use is
inappropriate when such a kill switch is required.

Live tasks do not interpolate freeform purpose text. Version 0.1 allowlists
only the fixed `accessibility_test` template; any new purpose kind requires a
reviewed code change and regression coverage.

The same rule applies to the opening disclosure: version 0.1 uses one fixed
disclosure for `accessibility_test`, and live task construction reads the
allowlist rather than caller-supplied prose. Durable attempt numbers are bound
into provider idempotency keys so reconciliation remains same-key while an
authorized second attempt after a terminal first result has a distinct key.
