# Workflow examples

Use these fictional examples to apply the state machine consistently. They demonstrate decision boundaries; do not copy details into a real issue unless the reporter supplied them.

## Example 1: one confirmed defect and one feature request

Source feedback:

> CALL-E CLI 0.3.6 returned `unsupported_locale` for `en-US`, although the CLI reference lists `en-US`. It would also be nice if the CLI suggested nearby locales.

Consolidation:

- `I1` is the supported locale rejection. It has observed behavior, a public expectation, and an exact error and version.
- The suggestion for nearby locales is a feature request outside `I1`; keep it as an unnumbered note unless the user separately asks to track it.

Before creation, search the exact error, locale, command surface, and relevant issue comments. Resolve the actor and request confirmation for `I1` only.

## Example 2: insufficient evidence

Source feedback:

> The call failed again. Please file a bug.

This may be a defect, but the expected behavior basis and concrete investigation clues are missing. Classify it as `Suspected defect`; do not create it. One compact question may ask what public surface was used and what visible or audible outcome occurred because those facts could change classification.

## Example 3: reporter-supplied identifier

Source feedback:

> The outbound call connected, but no replies appeared in the conversation. Call ID `reporter-call-1234`; observed at `2026-08-11T09:15:00Z`.

The identifier and timestamp came from the reporter and may be useful investigation clues. Preserve them exactly if they are non-sensitive and list the identifier in `source_evidence_identifiers`. If the value were a phone number, redact it instead.

## Example 4: plausible duplicate

The duplicate helper finds a closed issue whose comments contain the same exact status and activity text, although its title is different. Present the URL and matching observable behavior. Ask whether the new evidence should be added to that issue or tracked separately. Do not create or comment until that choice and the exact content are approved.

## Example 5: confirmation boundaries

An acceptable creation authorization names both actor and stable IDs:

> Confirm @octocat to create I1 and I3.

If `I3` lacks sufficient clues, that sentence authorizes only `I1`. A valid waiver must explicitly acknowledge `I3` and still name the actor:

> I3 lacks sufficient investigation clues; still confirm @octocat to create I3.

The agent must show the final prepared payload and approval fingerprint before this confirmation, then copy that unchanged fingerprint into the confirmed JSON. Creating the issue never authorizes posting the community reply.
