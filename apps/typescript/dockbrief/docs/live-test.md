# Live integration test: official CALL-E hotline

**A real CALL-E telephone connection was completed on September 11, 2026. The receiving questionnaire remained incomplete.** This test contacted the organizer's official US integration hotline with a fictional shipment. It did not contact a customer, receiving warehouse or equipment operator, and it did not verify a real unloading site.

## Authorized test destination

CALL-E collaborator `JJasonSun` published the hotline for outbound hackathon integration tests on September 7, 2026 at 10:35:40 UTC. See the [official source comment](https://github.com/CALLE-AI/call-e-integrations/issues/102#issuecomment-5569338723) and its linked announcement. The masked destination was **`+1******9632`**, with region `US` and locale `en-US`.

The app's live start command used one explicit operator-authorized test, the published `@call-e/calle@0.7.0` SDK and the normal production CALL-E API. The fixture transport was not used for this run. Only the sanitized summary below is published; credentials, raw private state, the full telephone number and provider telephony identifiers are excluded.

## Timeline and result

| Evidence | Recorded value |
|---|---|
| CALL-E call ID | `call_GkF-eB8CYO4AxyLUEGqFXg` |
| API call record created | `2026-09-11T21:31:48.473032Z` |
| Telephone attempt began | `2026-09-11T21:32:44Z` |
| Telephone attempt ended | `2026-09-11T21:34:14Z` |
| Local time of telephone attempt | September 11, 2026, 16:32:44–16:34:14, Bogotá (UTC−05:00) |
| Provider call record completed | `2026-09-11T21:35:09.827945Z` |
| Saved result retrieved | `2026-09-11T21:36:59.666Z` |
| Recorded recipient attempts | `1` |
| Provider call / recipient status | `completed` / `completed` |
| Provider `taskCompleted` | `true` |
| Requested `questionnaireOutcome` | `incomplete` |
| DockBrief report verdict | `needs_verification` / “Needs confirmation” |
| Required checks supported by usable values | `0 of 5` |

DockBrief asked for forklift capacity and doorway dimensions. The hotline did not have these facts and then ended the conversation. These short excerpts are from the actual returned recipient-side transcript:

| Offset from attempt start | Recipient excerpt |
|---|---|
| 46 seconds | “I don't have that information.” |
| 62 seconds | “I don't have that measurement.” |
| 79 seconds | “this test hotline can't complete the questionnaire.” |

The full 79-second turn says it cannot help further and ends with goodbye. The calling assistant thanked the recipient and said goodbye. The result contains one attempt, with no subsequent attempt in the saved record.

## Why this result matters

The provider's call lifecycle and `taskCompleted` flag are different from completion of the receiving questionnaire. Despite `taskCompleted: true`, the custom questionnaire result was `incomplete`. Forklift capacity, doorway width, doorway height, dock availability and receiving-staff availability all stayed unknown in DockBrief's five-check dock-mode report. Ground unloading was also unknown in the extraction, but is not a required check for the selected dock mode. No receiving condition was promoted to a match and no dispatch approval was produced.

The SDK labels receiving-side speech as `user`; that role does **not** establish that a human answered. Report labels therefore say “recipient,” and the evidence is described as an official hotline response. It is not testimony from a warehouse employee.

This run demonstrates authenticated SDK creation, an actual outbound connection, returned conversation/extraction, GET-only result retrieval and the incomplete-result path. It does not establish real-customer usefulness, measurement accuracy, handling safety, uptime or a successfully completed receiving questionnaire. The fitting and insufficient-forklift examples remain explicitly synthetic offline fixtures.
