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
