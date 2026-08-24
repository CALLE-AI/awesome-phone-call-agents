## Summary

Adds `apps/typescript/hirecall`, a recruiter screening desk for internship / junior hiring. Upload an Excel of candidates, Gemini writes a CALL-E script from each resume, CALL-E dials one person at a time, then Gemini scores the answers before the next queued number is dialed.

A **Judge test** on the home page lets reviewers hear a live call without an Excel: fake resume and fake CALL-E prompt are already filled; the judge types their own E.164 number and clicks Call.

## Type

- [ ] New skill
- [x] New runnable app
- [ ] New workflow plugin
- [ ] New provider adapter
- [ ] New scheduler recipe
- [ ] README awesome-list entry
- [ ] Safety or documentation update
- [ ] Validation or tooling update

## What it does

- Excel/CSV batches with job role, consent, and resume links. Rows are stored; the file is discarded.
- Prepare resume stores Drive/HTTP **text only**. Gemini writes the CALL-E `call_prompt` from that resume.
- Live CALL-E with poll status: calling, talking, completed, no answer, failed. Time, duration, and CALL-E id are stored on the candidate and the batch.
- Sequential queue: hang up, Gemini score + summary, then dial the next queued person.
- Scoring criteria per Excel (ticks, notes, pass mark, Gemini auto-mark vs recruiter mark).
- Call-again keeps the same script if nobody answered or they asked to be called later. It rewrites the script only after a completed screen that was unclear.
- Judge test: fake intern resume + matching CALL-E script; any-country phone.

## Judge call and Gemini summary

On **Judge test**, Gemini does **not** write the call script. The fake prompt is already saved so the judge can Call immediately.

On the live call, **CALL-E** speaks that fake script. Gemini is not on the phone.

**After the call ends**, `GEMINI_API_KEY` is required. HireCall stores the structured answers, then Gemini writes the **score (0–10)** and the **summary**. Without that key, Judge test can still ring (the fake script is pre-written), but there is no Gemini summary.

Setup for a judge is in `apps/typescript/hirecall/README.md`: copy `.env.example` to `.env`, set **both** `CALLE_API_KEY` (to dial) and `GEMINI_API_KEY` (for the post-call score and summary), `npm install`, `npm run dev`, then Judge test.

## Notes for review

- Credentials from `.env` only. `.env` and SQLite (`data/hirecall.db`) are gitignored.
- Samples use fictional numbers. Judge test dials the number the reviewer types.
- `CALLE_BASE_URL` defaults to the official CALL-E HTTPS API.
- Deactivate is a soft delete (`active = 0`). Restore from Inactive. No scheduler daemon; the desk only polls while the batch page is open.
- Without `CALLE_API_KEY`, Call does not dial. Without `GEMINI_API_KEY`, Judge test still calls (script is pre-written); post-call scoring uses a fallback instead of a Gemini summary.

## Checklist

- [x] Repository-facing content is written in English.
- [x] Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.
- [x] No secrets, tokens, private phone numbers, call recordings, or private transcripts are included.
- [x] Real-world side effects are clearly described.
- [x] Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.
- [x] Recurring workflows include cancellation behavior.
- [x] Runnable code has a dry-run, fake-server, or no-call path by default.
- [ ] `python3 scripts/validate_repository.py` passes.
