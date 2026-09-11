# Examples

`fictional_structured_result.json` is a complete terminal call task as returned
by `GET /v1/calls/{call_id}` and carried in a `call.completed` webhook `data`
object.

Everything in it is fictional: the names are placeholders and the phone number
is in the reserved `+1 555 01xx` range. It is generated from the fixture the
webhook tests run against, so it stays in step with the code. Its `answers`
object uses the four-question fixture template rather than a shipped one — a
real result carries whichever question ids the chosen template defines.
