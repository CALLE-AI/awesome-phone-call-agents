# Safety Reference

This example is mock-only and places no phone calls. Any real adapter must
require explicit user intent, strict E.164 validation, authorized recipients,
masked phone numbers in user-facing output, trusted credential destinations,
and a clear stop on failed, unanswered, or ambiguous outcomes.

Keep structured answers advisory unless a human has reviewed the result and
the downstream action is explicitly authorized. Do not use this pattern to
automatically perform medical, legal, financial, employment, or emergency
actions from an unverified transcript.
