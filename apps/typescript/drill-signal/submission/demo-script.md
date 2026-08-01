# DrillSignal demo video script

**Target length:** 2:40-2:50 (under 3 minutes)
**Scenario:** Simulation preset `primary-unavailable-backup-success`
**Disclosure:** UI timing may be compressed; simulation steps are real. Any live call segment is clearly marked **[PLACEHOLDER - NOT YET RECORDED]** until performed with consent.

## Pre-recording checklist

- [ ] Close unrelated tabs and notifications
- [ ] Use fictional numbers only (`+15550100002`, `+15550100003`)
- [ ] Confirm simulation mode (no network)
- [ ] No copyrighted music
- [ ] No unauthorized third-party logos
- [ ] Obtain call-recording consent from any participant before recording live segments
- [ ] Mask phone numbers in on-screen captions and overlays

## Storyboard

| Time | Visual | Audio / caption |
| --- | --- | --- |
| 0:00-0:15 | Title card: "DrillSignal - consented outage drills by phone" | "Teams need to know on-call roles can answer before the real incident." |
| 0:15-0:35 | Terminal: `npm run dev`, browser opens `127.0.0.1:3847` | "Default mode is simulation - no live calls." |
| 0:35-1:05 | Create Drill form: primary + backup labels, fictional numbers, consent checkboxes, preset **primary-unavailable-backup-success** | "Explicit consent and a locked simulation preset." |
| 1:05-1:25 | Safety Preview: masked numbers, max-call disclosure, attestations | "Safety preview before any side effect." |
| 1:25-1:50 | Mission Control: Launch, event log showing primary no-answer then backup success | "Deterministic escalation when primary is unavailable." |
| 1:50-2:20 | After-Action Report: scores, masked attempts, evidence excerpts | "Evidence-backed readiness report with redacted phones." |
| 2:20-2:40 | Architecture diagram (`public/architecture.svg`) or Docker one-liner | "Portable app: local simulation, fake-server SDK contract, opt-in live CALL-E." |
| 2:40-2:50 | End card: repo path, "No live call in this recording" (simulation path) | "Built for Awesome Phone Call Agents." |

## Live call segment (placeholder)

**[PLACEHOLDER - NOT YET RECORDED]**

If a live segment is added later:

- Separate chapter title: "Optional live verification"
- Show live side-effect acknowledgment in Safety Preview
- Use only authorized numbers you control
- Mask numbers in captions (`+*******000x`)
- State call-recording consent on screen
- Do not include API keys, operator tokens, or transcripts with PII

## Retake checklist

- [ ] Total runtime under 3:00
- [ ] Simulation mode visible in UI during main flow
- [ ] No full E.164 numbers in report or captions
- [ ] Compression disclosure in description or opening caption
- [ ] Live segment clearly labeled or omitted
- [ ] Audio levels balanced; no background music unless licensed
