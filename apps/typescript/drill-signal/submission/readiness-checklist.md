# DrillSignal submission readiness checklist

Requirements were verified on **2026-07-31** against the [CALL-E Devpost overview](https://call-e.devpost.com/) and [Official Rules](https://call-e.devpost.com/rules).

## Deadline conflict

The Official Rules say the Submission Period ends **2026-09-14 at 11:45 AM SGT**, while the Devpost overview displays **11:45 PM SGT**. The Official Rules control. Submit well before the earlier time and recheck both pages immediately before submission.

## Official requirements

| Requirement | Status | Evidence or action |
| --- | --- | --- |
| Functional app using CALL-E SDK, API, MCP, CLI, or SKILL | Required | `../README.md` documents the `@call-e/calle` SDK integration; `../src/` and `../test/` contain the runtime adapter, fake CALL-E contract, and end-to-end coverage. |
| Public PR to `https://github.com/CALLE-AI/awesome-phone-call-agents` | Required | Publish the prepared contribution; paste its public PR URL into Devpost. |
| English text description | Required | `devpost.md` provides copy-ready English project, feature, implementation, safety, and impact text. |
| Public product demo on YouTube or Vimeo, under 3 minutes, showing the app working | Required | Local narrated video is complete; a public YouTube/Vimeo URL is still required. |
| CALL-E account email | Required | Enter the account email directly in Devpost; do not commit it. |
| Hosted functional demo URL | Optional | Not required. If published, verify access through the end of judging before adding the URL. |
| Original, IP-compliant content | Required | Confirm ownership and licenses; remove unlicensed music, trademarks, copyrighted media, personal data, or other third-party material from the submission and video. |

## Honest status

| Item | Status | Notes |
| --- | --- | --- |
| App, tests, Docker | Complete | `npm run verify` passes locally; multi-stage Docker image and health check documented in `../README.md`. |
| Local narrated video | Complete | See local video metadata below; public upload still pending. |
| Upstream PR | Complete | Draft opened: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/56 |
| Public video URL | Pending upload | Upload `drillsignal-demo-final-hd.mp4` to YouTube or Vimeo. |
| CALL-E account email | Ready for form | Supply only in the Devpost form; never commit it. |
| Hosted URL (optional) | Pending | Optional; add only if a reliable hosted demo is available. |
| Live CALL-E runtime path | Complete | Verified separately with an authorized destination. No credential, full phone number, call ID, or transcript is committed. |

## Local video metadata

External handoff artifact (not stored in this repository):

- Name: `drillsignal-demo-final-hd.mp4`
- Duration: `2:55.91` (under the three-minute limit)
- Frame size: `1440x810`, 30 fps
- Codecs: `H.264 High, yuv420p / AAC LC, 48 kHz mono`; fast-start enabled
- Narration: Microsoft David Desktop male voice, synthesized at normal speed and rendered at `1.2x`
- Captions: burned-in English captions; no background music
- SHA-256: `C184B9F848D3EC9859292DCFAA7F00E1BBFFE0F30089385A79A4E58A695B7BB5`

## Equally weighted judging matrix

| Criterion | Weight | Existing DrillSignal evidence |
| --- | ---: | --- |
| Real World Impact | 25% | `../README.md` defines the on-call readiness problem and safety boundary; `devpost.md` states user value and path beyond the hackathon; the recorded local demo shows the readiness workflow. |
| Quality of Idea | 25% | `devpost.md` presents consented continuity drills, deterministic escalation, and masked audit evidence as a scoped reusable app; `judge-guide.md` gives a credentialless evaluation path. |
| Technical Implementation | 25% | `../README.md` documents CALL-E SDK modes, idempotency, cancellation, privacy, durable provider-call checkpoints, conservative reconciliation, Docker, and limitations; `../src/` and `../test/` provide 89 source tests plus 2 compiled-production tests. The authorized live runtime path was verified separately without publishing private call data. |
| Product Experience & Demo | 25% | `judge-guide.md` covers create, safety preview, launch, mission control, and after-action report; the recorded 2:55.91 demo shows the functioning product with male narration at 1.2x and burned-in captions. Public video upload remains pending. |

## Award positioning

- Primary target: **Most Practical Use Case** — lead with the concrete on-call readiness workflow, explicit consent, deterministic escalation, and auditable results.
- Secondary target: **Most Innovative Use Case** — emphasize proactive phone-based continuity drills and reusable safety patterns.
- Treat these as positioning targets only; make no claim or implication of winning.

## Final submission sequence

1. Recheck the [overview](https://call-e.devpost.com/) and [Official Rules](https://call-e.devpost.com/rules); plan around the **11:45 AM SGT** rules deadline.
2. Keep the already completed live verification private; do not publish the credential, destination, call ID, or transcript.
3. Move PR #56 to ready for review after its reviewer fixes and upstream reconciliation pass, retaining its URL: https://github.com/CALLE-AI/awesome-phone-call-agents/pull/56.
4. Upload `drillsignal-demo-final-hd.mp4` publicly to YouTube or Vimeo; verify playback, visibility, English presentation, functionality footage, duration under 3 minutes, and IP compliance.
5. Complete Devpost with `devpost.md`, the PR URL, public video URL, and CALL-E account email; add a hosted URL only if reliable.
6. Preview every field and link, submit well before the earlier deadline, and retain confirmation evidence.
7. Optional prize action: complete the **Feedback Form** linked from the Devpost overview during the Feedback Period with actionable CALL-E feedback; one feedback submission per entrant.
