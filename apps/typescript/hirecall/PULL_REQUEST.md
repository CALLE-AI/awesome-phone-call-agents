**Title:** `feat(apps): add hirecall recruiter screening desk`

## Summary

Adds `apps/typescript/hirecall`, a recruiter screening desk for internship / junior hiring. Upload an Excel of candidates, Gemini writes a CALL-E script from each resume, CALL-E dials one person at a time, then Gemini scores the answers before the next queued number is dialed.

A **Judge test** on the home page lets reviewers hear a live call without an Excel: fake resume and fake CALL-E prompt are already filled; the judge types their own E.164 number and clicks Call. Live ringing is **off by default** (`HIRECALL_LIVE_CALLS` is not `true`); Call then completes a local dry-run and does not dial.

## Type

- [ ] New skill
- [x] New runnable app
- [ ] New workflow plugin
- [ ] New provider adapter
- [ ] New scheduler recipe
- [x] README awesome-list entry
- [ ] Safety or documentation update
- [ ] Validation or tooling update

## What it does

- Excel/CSV batches with job role, consent, and resume links. Rows are stored; the file is discarded.
- Prepare resume stores Drive/HTTPS **text only**. Private, loopback, and HTTP resume URLs are refused; redirects are re-checked. Gemini writes the CALL-E `call_prompt` from that resume.
- Live CALL-E with poll status: calling, talking, completed, no answer, failed. Time, duration, and CALL-E id are stored on the candidate and the batch.
- Sequential queue: hang up, Gemini score + summary, then dial the next queued person.
- Scoring criteria per Excel (ticks, notes, pass mark, Gemini auto-mark vs recruiter mark).
- Call-again keeps the same script if nobody answered or they asked to be called later. It rewrites the script only after a completed screen that was unclear.
- Judge test: fake intern resume + matching CALL-E script; any-country phone.

## Judge call and Gemini summary

On **Judge test**, Gemini does **not** write the call script. The fake prompt is already saved so the judge can Call immediately.

On a live call, **CALL-E** speaks that fake script. Gemini is not on the phone.

**After the call ends**, `GEMINI_API_KEY` is required. HireCall stores the structured answers, then Gemini writes the **score (0–10)** and the **summary**. Without that key, Judge test can still run (the fake script is pre-written), but there is no Gemini summary.

Setup for a judge is in `apps/typescript/hirecall/README.md`: copy `.env.example` to `.env`, set **`HIRECALL_LIVE_CALLS=true`**, **`CALLE_API_KEY`** (to dial), and **`GEMINI_API_KEY`** (for the post-call score and summary), `npm install`, `npm run dev`, then Judge test.

## Notes for review

- Credentials from `.env` only. `.env` and SQLite (`data/hirecall.db`) are gitignored.
- Samples use reserved fictional NANP numbers (`+14155550123`, `+14155550124`, `+14155550125`). Judge test stores the number the reviewer types and dials it only when live calls are on.
- `CALLE_BASE_URL` defaults to and accepts only `https://api.heycall-e.com`. The production `CALLE_API_KEY` is not sent to loopback or any other host.
- Resume fetch is public HTTPS only. Private, loopback, and insecure URLs are blocked; each redirect hop is revalidated.
- Deactivate is a soft delete (`active = 0`). Restore from Inactive. No scheduler daemon; the desk only polls while the batch page is open. Deactivate stops HireCall from starting the next call in that Excel. A call CALL-E already started keeps ringing; HireCall cannot hang it up. To try to stop it, use the CALL-E dashboard (https://dashboard.heycall-e.com) with the CALL-E id from Screening. In dry-run there is nothing to cancel on the phone network.
- If CALL-E create or poll is unclear, the queue stops. HireCall does not mark that person failed and does not auto-dial the next number.
- Screening answers are used only when the CALL-E result matches this candidate’s task, phone, and metadata and the call completed. Gemini may score 0–10. Next round and Rejected are saved only when the recruiter clicks.
- The CALL-E idempotency key is hashed from the full create payload (script, phone, schema, metadata, attempt), not from batch/candidate/attempt alone.
- Default path is dry-run: Call does not create a CALL-E task. Live calls require `HIRECALL_LIVE_CALLS=true` and `CALLE_API_KEY`. Without `GEMINI_API_KEY`, post-call scoring uses a fallback instead of a Gemini summary.

## Checklist

- [x] Repository-facing content is written in English.
- [x] Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.
- [x] No secrets, tokens, private phone numbers, call recordings, or private transcripts are included.
- [x] Real-world side effects are clearly described.
- [x] Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.
- [x] Recurring workflows include cancellation behavior.
- [x] Runnable code has a dry-run, fake-server, or no-call path by default.
- [x] `python3 scripts/validate_repository.py` passes.
