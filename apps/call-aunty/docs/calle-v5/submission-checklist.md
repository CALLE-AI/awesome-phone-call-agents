# Hackathon submission checklist (V5)

## Before you record demo video

- [ ] `pnpm run calle:health` passes
- [ ] App shows **DEMO** indicator on CHW call flow
- [ ] Prepare → confirm works on woman record
- [ ] Command center lists calls after confirm
- [ ] Hero demo runs (`calle.heroDemo` or UI button)

## Security & honesty

- [ ] No `CALLE_API_KEY` in client, screenshots, or README
- [ ] No Bangla/Bangladesh spoken-call claims
- [ ] Synthetic numbers only (`+1555555…`)
- [ ] Urgent triage demo beneficiary (`demo-ben-010`) denies honestly

## Docs & contribution

- [ ] `docs/calle-v5/FINAL-READY.md` reviewed
- [ ] `docs/calle-v5/judge-demo-script.md` rehearsed
- [ ] `contrib/awesome-phone-call-agents/README.md` ready for PR to CALL-E awesome list
- [ ] Architecture diagram/source: `docs/calle-v5/architecture.md`

## Optional live coda

- [ ] `CALLE_DEMO_MODE=false` + `CALLE_LIVE_CALLS=true` + server key
- [ ] One supported-region test call documented in evidence pack
- [ ] Kill switch tested

## PR / submission links

- [ ] GitHub repo URL
- [ ] Demo video URL
- [ ] CALL-E awesome-phone-call-agents PR (draft)
