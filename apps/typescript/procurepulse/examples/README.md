# Examples

Everything here is fictional. Phone numbers use the reserved `555-01xx` range, which never
reaches a real line; businesses and people are invented.

| File | Used by |
| --- | --- |
| `request.json` | `preview`, `demo`, and the live `start` command (replace the numbers with suppliers who agreed to be called, and allowlist them). |
| `fake-outcomes.json` | `demo` and the tests: what each fictional supplier "says" to the loopback fake CALL-E server, keyed by `<vendor_id>:<purpose>`. One exact quote, one named substitute with a fee, one vague answer, and a hold. |
| `fictional_completed_call.json` | `replay`: a terminal `GET /v1/calls/{id}` snapshot in the documented shape, validated and analyzed offline. |
